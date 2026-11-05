"""Pinned local multi-label emotion inference and an explicit avatar adapter."""
import json,math,time
from copy import deepcopy
from pathlib import Path
import torch
from transformers import AutoModelForSequenceClassification,AutoTokenizer
from common import ROOT,sha

GROUPS={
 'happy':['admiration','amusement','approval','caring','desire','excitement','gratitude','joy','love','optimism','pride','relief'],
 'angry':['anger','annoyance','disapproval','disgust'],
 'shy':['embarrassment','nervousness'],
 'sad':['sadness','disappointment','grief','remorse'],
 'surprised':['surprise','realization','fear'],
 'confused':['confusion','curiosity'],
}
LABEL_EMOTION={label:emotion for emotion,labels in GROUPS.items() for label in labels}
FACES=['黑脸','流泪','脸红','加载','兔牙','流冷汗']
# Guilt is a subdued concerned tone for this avatar, not a full crying reaction.
# Keep its classifier probability intact; this gain only controls expression.
EXPRESSION_EVIDENCE_GAIN={'remorse':.25}

def curve_evidence(scores,thresholds):
    """Continuous expression targets, never a calibrated measure of felt intensity.

    Keep independent sigmoid scores intact; max within a group avoids giving the
    12-label happy group an artificial advantage over the two-label shy group.
    """
    def evidence(label):
        threshold=thresholds[label]
        return EXPRESSION_EVIDENCE_GAIN.get(label,1.)*.9*math.sqrt(max(0.,(scores.get(label,0.)-threshold)/max(.001,1-threshold)))
    weights={emotion:max(evidence(label) for label in labels) for emotion,labels in GROUPS.items()}
    scale=max(1.,sum(weights.values()))
    return dict(weights={key:value/scale for key,value in weights.items()},tension=max(evidence('fear'),evidence('nervousness'))/scale)

def emotion_spans(text):
    """Phrase observations only: no extra TTS or action plans.

    Protect quoted speech and its following attribution. Long unpunctuated text
    receives bounded windows, except inside a quote whose scope must stay whole.
    Offsets are Unicode code points, as in the rest of the worker contract.
    """
    pairs={'“':'”','‘':'’','「':'」','『':'』','"':'"','（':'）','(':')'}
    spans=[];start=0;stack=[];quoted=False
    for i,char in enumerate(text):
        if stack and char==stack[-1]:stack.pop()
        elif char in pairs:stack.append(pairs[char]);quoted=True
        if stack:continue
        end=i+1
        sentence=char in '。！？!?；;\n'
        phrase=char in '，,、' and not quoted and end-start>=6
        window=end-start>=64 and not quoted
        if sentence or phrase or window:
            spans.append(dict(text=text[start:end].strip(),start=start,end=end));start=end;quoted=False
    if start<len(text):spans.append(dict(text=text[start:].strip(),start=start,end=len(text)))
    # Whitespace is retained in the surrounding interval, never an empty model input.
    result=[]
    for span in spans:
        if not span['text'] and result:result[-1]['end']=span['end']
        elif span['text']:
            if not result:span['start']=0
            result.append(span)
    return result

def emotion_inputs(text,observations,previous=''):
    """Causal local context disambiguates e.g. bashfulness versus an apology.

    Only already preceding words are included. Never use a later phrase to make
    the current face anticipate an emotion that has not been spoken yet.
    """
    prior=emotion_spans(previous)
    return [text[observations[i-1]['start']:span['end']].strip() if i else
            '\n'.join([prior[-1]['text'] if prior else '',span['text']]).strip()
            for i,span in enumerate(observations)]

def speaker_text(text):
    """Quoted material does not automatically become the avatar's own affect."""
    pairs={'“':'”','‘':'’','「':'」','『':'』','"':'"'};stack=[];out=[]
    for char in text:
        if stack:
            if char==stack[-1]:stack.pop()
            elif char in pairs and char!='"':stack.append(pairs[char])
        elif char in pairs:stack.append(pairs[char])
        else:out.append(char)
    return ''.join(out).strip()

def avatar_affect(scores,thresholds):
    """Scores stay probabilities; rendering strength is an independent policy."""
    active=[label for label,value in scores.items() if label!='neutral' and value>=thresholds[label]]
    label=max(active,key=lambda key:scores[key]) if active else 'neutral'
    if scores.get('neutral',0)>scores.get(label,0) and scores.get('neutral',0)>=thresholds['neutral']:label='neutral'
    emotion=LABEL_EMOTION.get(label,'neutral');probability=float(scores.get(label,0))
    threshold=float(thresholds[label]) if emotion!='neutral' else 0.
    margin=max(0.,(probability-threshold)/max(.001,1-threshold))
    strength=round(min(.9,.35+.6*margin),4) if emotion!='neutral' else 0.
    faces=dict.fromkeys(FACES,0.)
    if emotion=='angry':faces['黑脸']=strength
    elif emotion=='sad':faces['流泪']=strength
    elif emotion=='shy':faces['脸红']=strength
    if label in ['fear','nervousness']:faces['流冷汗']=strength*.6
    return dict(emotion=emotion,label=label,probability=probability,threshold=threshold,strength=strength,expressions=faces,active_labels=active)

class EmotionClassifier:
    def __init__(self,source,device='cuda'):
        self.source=json.loads(Path(source).read_text(encoding='utf-8-sig'));self.device=device
        folder=ROOT/self.source['local_path']
        for name,expected in self.source['files'].items():
            if not (folder/name).is_file() or sha(folder/name)!=expected:raise ValueError('情感模型文件缺失或校验失败：'+name)
        self.tokenizer=AutoTokenizer.from_pretrained(folder,local_files_only=True,trust_remote_code=False)
        self.model=AutoModelForSequenceClassification.from_pretrained(folder,local_files_only=True,trust_remote_code=False,attn_implementation='sdpa',dtype=torch.float32).to(device).eval()
        self.model.requires_grad_(False);self.thresholds=json.loads((folder/'thresholds.json').read_text(encoding='utf-8'))
        self.cache={};self.last_timing={};self.parameters=sum(p.numel() for p in self.model.parameters())
        self.classify_many(['你好。','我很开心。','这个数字还没有填。'])
    @torch.inference_mode()
    def classify_many(self,texts):
        begin=time.perf_counter();missing=list(dict.fromkeys(text for text in texts if text not in self.cache))
        inputs=[speaker_text(text) for text in missing]
        if missing:
            nonempty=[value for value in inputs if value]
            rows=[]
            if nonempty:
                encoded=self.tokenizer(nonempty,return_tensors='pt',padding=True,truncation=True,max_length=256).to(self.device)
                rows=self.model(**encoded).logits.sigmoid().float().cpu().tolist()
            predictions=iter(rows)
            for original,filtered in zip(missing,inputs):
                if filtered:
                    row=next(predictions);scores={self.model.config.id2label[i]:float(value) for i,value in enumerate(row)}
                    result=avatar_affect(scores,self.thresholds);tokens=len(self.tokenizer(filtered,add_special_tokens=True)['input_ids'])
                    result.update(scores=scores,policy_default=False,tokens=tokens,truncated=tokens>256,**curve_evidence(scores,self.thresholds))
                else:
                    # No speaker-owned words: use the neutral policy without inventing
                    # a classifier posterior of 1.0 for text that was never classified.
                    result=dict(emotion='neutral',label='neutral',probability=0.,threshold=0.,strength=0.,expressions=dict.fromkeys(FACES,0.),active_labels=[],scores={},policy_default=True,tokens=0,truncated=False,weights=dict.fromkeys(GROUPS,0.),tension=0.)
                result['quoted_text_excluded']=filtered!=original.strip();self.cache[original]=result
        results=[deepcopy(self.cache[text]) for text in texts]
        while len(self.cache)>256:self.cache.pop(next(iter(self.cache)))
        self.last_timing={'total_ms':(time.perf_counter()-begin)*1000,'batch_size':len(texts),'uncached':len(missing)}
        return results

    def info(self):return {'model':self.source['repo_id'],'revision':self.source['revision'],'parameters':self.parameters,'device':self.device,'multi_label':True,'threshold_source':'published per-label validation thresholds','max_tokens':256}
