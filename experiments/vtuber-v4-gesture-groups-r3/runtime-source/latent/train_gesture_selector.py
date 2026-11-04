"""Learn action-group selection from frozen semantics; no runtime keyword matching."""
import argparse,hashlib,json,random
from pathlib import Path
import numpy as np
import torch
from torch.nn import functional as F
from encoder import SemanticEncoder
from gesture_selector import GestureSelector,LABELS
ROOT=Path(__file__).resolve().parents[1];DATA=ROOT/'datasets/vtuber-v4-native'
def read(p):return json.loads(p.read_text(encoding='utf-8'))
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,required=True);args=parser.parse_args();out=args.output.resolve();out.mkdir(exist_ok=True)
    if (out/'gesture-selector.pt').exists():raise RuntimeError('Refusing to overwrite selector')
    torch.set_num_threads(3);torch.manual_seed(6051);random.seed(6051)
    cache=torch.load(ROOT/'experiments/vtuber-v4-native-r3/semantic-cache.pt',weights_only=True)['features'];items=read(DATA/'manifest.json')['items'];labels={};splits={};ambiguous=set()
    for i in items:
        text=i['text'];label='none'
        if i['id'].startswith('body-'):
            label=i['intent'];number=int(i['id'].split('-')[2])
            if label=='chest' and number in [5,6,7,9]:label='thanks'
        else:
            # Deliberate labels from the authored semantic scenarios, not procedural arm variants.
            index=int(i['id'][1:4]);label={7:'explain',8:'thanks',9:'refuse',11:'wave',15:'point',36:'wave',43:'cheer'}.get(index%1000,'none')
            if text in labels and labels[text]!='none':label=labels[text]
        if text not in labels or label!='none':labels[text]=label
        splits[text]=i['split']
    for i in items:
        if not i['id'].startswith('body-'):continue
        import re
        prefix=re.split('[，。！？!?]',i['text'])[0]
        if len(prefix)<3:continue
        if prefix in splits and splits[prefix]!=i['split']:ambiguous.add(prefix)
        else:labels[prefix]=labels[i['text']];splits[prefix]=i['split']
    records={key:(splits[key.split('\n',1)[0]],labels[key.split('\n',1)[0]]) for key in cache if key.split('\n',1)[0] in labels and key.split('\n',1)[0] not in ambiguous}
    extra={
      'grass':['给你看看这根狗尾草。','我拿了一根小草，想给你看看。','这根狗尾草看起来软软的。','来，看看我手里的小草。','我要把狗尾草拿到身前展示。','你看这根小草像不像尾巴？','我来轻轻晃一晃这根草。','让我展示一下手中的狗尾草。','这是一根刚拿到的狗尾草。','我想用这根草逗你一下。','看，我手里有一根小草。','先把这根狗尾草拿起来吧。'],
      'none':['我只是引用他说的打招呼，没有要挥手。','我没有让你拿出狗尾草。','他刚刚说要庆祝，我只是在转述。','我今天没有特别开心，先安静聊一会。','不用表演动作，听我读一下这条消息。','今天的天气和昨天差不多。','我们接着聊下一件事情。','我还没想好该怎么回答。','这句话没有特别的情绪。','我说的谢谢只是一段引文。','我没有在庆祝，这只是反话。','抚胸只是他描述的动作，和我无关。']}
    encoder=None
    for label,texts in extra.items():
        for i,text in enumerate(texts):
            split='validation' if i==0 else 'test' if i==1 else 'train'
            for context in ['','和观众自然聊天。','配合台词的意思表达，动作不频繁。']:
                key=text+'\n'+context
                if key not in cache:
                    if encoder is None:encoder=SemanticEncoder('cuda')
                    h,m,_=encoder.encode(text,context,'natural');cache[key]=(h.cpu(),m.cpu())
                records[key]=(split,label)
    del encoder;torch.cuda.empty_cache();rows=[]
    for key,(split,label) in records.items():h,m=cache[key];rows.append((h,m,split,LABELS.index(label),key))
    tensors={}
    for split in ['train','validation','test']:
        a=[r for r in rows if r[2]==split];tensors[split]=(torch.stack([r[0] for r in a]).cuda(),torch.stack([r[1] for r in a]).cuda(),torch.tensor([r[3] for r in a],device='cuda'))
    model=GestureSelector().cuda();x,m,y=tensors['train'];weights=(~m).float();pooled=(x*weights[:,:,None]).sum(1)/weights.sum(1,keepdim=True);model.mean.copy_(pooled.mean(0));model.scale.copy_(pooled.std(0).clamp_min(.05));optimizer=torch.optim.AdamW(model.parameters(),lr=3e-4,weight_decay=.02);best=float('inf');logs=[]
    class_weights=(len(y)/torch.bincount(y,minlength=len(LABELS)).clamp_min(1)).sqrt();class_weights[0]*=1.3
    for step in range(2000):
        j=torch.randint(len(x),(96,),device='cuda');loss=F.cross_entropy(model(x[j],m[j]),y[j],weight=class_weights);optimizer.zero_grad();loss.backward();optimizer.step()
        if (step+1)%100==0:
            model.eval()
            with torch.inference_mode():a,b,c=tensors['validation'];score=F.cross_entropy(model(a,b),c).item()
            logs.append({'step':step+1,'validation_ce':score})
            if score<best:best=score;torch.save(model.state_dict(),out/'gesture-selector.pt')
            model.train()
    model.load_state_dict(torch.load(out/'gesture-selector.pt',weights_only=True));model.eval()
    def evaluate(split,threshold):
        a,b,c=tensors[split]
        with torch.inference_mode():p=model(a,b).softmax(-1);confidence,label=p.max(-1);active=(label>0)&(confidence>=threshold)
        negative=c==0;positive=~negative
        return {'samples':len(c),'accuracy':float((label==c).float().mean()),'false_positive_rate':float((active&negative).sum()/negative.sum().clamp_min(1)),'correct_action_recall':float((active&positive&(label==c)).sum()/positive.sum().clamp_min(1)),'threshold':threshold}
    options=[evaluate('validation',t) for t in [.65,.75,.8,.85,.9,.95]];valid=[r for r in options if r['false_positive_rate']<=.03];selected=max(valid or options,key=lambda r:(r['correct_action_recall'],-r['false_positive_rate'],r['threshold']))
    result={'checkpoint':'gesture-selector.pt','sha256':hashlib.sha256((out/'gesture-selector.pt').read_bytes()).hexdigest(),'labels':LABELS,'threshold':selected['threshold'],'validation':selected,'test':evaluate('test',selected['threshold']),'training_log':logs,'source':'synthetic semantic labels and frozen Qwen features; not human preference scores'}
    (out/'gesture-selector.json').write_text(json.dumps(result,indent=2));(out/'selector-examples.json').write_text(json.dumps([{'text_context':r[4],'split':r[2],'label':LABELS[r[3]]} for r in rows],ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(result))
if __name__=='__main__':main()
