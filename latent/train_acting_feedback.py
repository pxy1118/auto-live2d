"""Train the small r3 action/variant/phrase-anchor head on frozen features.

The 28-label classifier, semantic encoder, TTS and continuous motion checkpoint
are not trained. Selection uses validation only. Interpreted feedback phrases
are train-only supervision and replay checks, not a blind test. Raw user files
remain immutable.
"""
import argparse
import json
import os
import shutil
import time
from pathlib import Path

import numpy as np
import torch
from torch.nn import functional as F

from common import ROOT,sha
from encoder import SemanticEncoder
from emotion import EmotionClassifier,emotion_spans,emotion_inputs,build_timeline
from emotion_config import LABELS,THRESHOLDS,build_affect_vector,emotion_config_sha256
from emotion_curve import CurveSimulator
from emotion_event import EventExpert,values_target,save_event,load_event
from catalog_contract import MODEL_ACTION_IDS,ACTION_BY_ID,catalog_sha256
from motion_history import STATE_DIM,state_vector
from build_acting_feedback import build,OUT as DATA

PARENT=ROOT/'experiments/vtuber-v6-native28-motion-r2'
OUT=ROOT/'experiments/vtuber-v6-acting-feedback-r3-final'
VERSION='v6.4.0-acting-feedback'
def read(p):return json.loads(p.read_text(encoding='utf-8-sig'))
def atomic(path,writer):
    temp=path.with_name(path.name+'.partial')
    for attempt in range(10):
        try:writer(temp);os.replace(temp,path);return
        except OSError:
            if attempt==9:raise
            time.sleep(.1*(attempt+1))
def write(p,v):atomic(p,lambda temp:temp.write_text(json.dumps(v,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf-8'))
def lines(p):return [json.loads(x) for x in p.read_text(encoding='utf-8-sig').splitlines()]

def prepare(data_dir):
    build(data_dir);rows=lines(data_dir/'records.jsonl');acceptance=lines(data_dir/'acceptance.jsonl')
    frozen=read(data_dir/'manifest.json');fingerprint={**frozen['artifacts'],'encoder':sha(ROOT/'latent/encoder-source.json'),'classifier':sha(ROOT/'latent/emotion-source.json'),'preparation':'r3-native28-real-scores-v1'}
    path=data_dir/'features.pt'
    if path.exists():
        data=torch.load(path,map_location='cpu',weights_only=True)
        if data['fingerprint']!=fingerprint:raise RuntimeError('Features have another fingerprint')
        return rows,acceptance,data
    parent=torch.load(ROOT/'datasets/native28-motion-r2/features.pt',map_location='cpu',weights_only=True)
    if parent['fingerprint']['records']!=frozen['fingerprint']['base']:raise ValueError('Base features do not match frozen records')
    extra=[r for r in rows if r['source']!='authored_legacy']+acceptance
    texts=sorted({r['text'] for r in extra});classifier=EmotionClassifier(device='cuda');scores={}
    windows=sorted({w for text in texts for w in emotion_inputs(text,emotion_spans(text))})
    for i in range(0,len(windows),24):scores.update(zip(windows[i:i+24],classifier.classify_many(windows[i:i+24])))
    del classifier;torch.cuda.empty_cache();encoder=SemanticEncoder('cuda');pooled={}
    keys=sorted({(r['text'],r['context']) for r in extra})
    for i,(text,context) in enumerate(keys):
        feature,mask,_=encoder.encode(text,context,'natural');w=(~mask).float();pooled[(text,context)]=((feature*w[:,None]).sum(0)/w.sum().clamp_min(1)).cpu().float()
        if i%40==0:print(json.dumps({'stage':'encode','done':i+1,'total':len(keys)}),flush=True)
    del encoder;torch.cuda.empty_cache()
    def affect(text,ms):
        spans=emotion_spans(text);windows=emotion_inputs(text,spans)
        t=build_timeline(text,spans,windows,[scores[w] for w in windows],THRESHOLDS)
        sim=CurveSimulator(t,max(1000,len(text)*170),THRESHOLDS);sim.advance_to(ms);s=sim.sample()
        return build_affect_vector(dict(zip(LABELS,s['response'])),dict(zip(LABELS,s['mood'])),s['tension'],s['vad'],s['intensity'],'lively')
    def tensors(items):
        x=[];a=[];h=[]
        for i,r in enumerate(items):
            if r.get('source')=='authored_legacy':
                ix=r['base_index'];x.append(parent['semantic'][ix]);a.append(parent['affect'][ix])
            else:
                x.append(pooled[(r['text'],r['context'])]);a.append(torch.tensor(affect(r['text'],[0,150,400,800,1200][i%5])))
            h.append(state_vector(r.get('history')))
        return {'semantic':torch.stack(x).float(),'affect':torch.stack(a).float(),'history':torch.tensor(h).float()}
    data={**tensors(rows),'fingerprint':fingerprint,'acceptance':tensors(acceptance),
          'actions':torch.tensor([MODEL_ACTION_IDS.index(r['target']['id']) for r in rows]),
          'variants':torch.tensor([r['target']['variant'] for r in rows]),'values':torch.tensor([values_target(r['target']) for r in rows]),
          'weights':torch.tensor([r['weight'] for r in rows]),'variant_weights':torch.tensor([r['variant_weight'] for r in rows]),
          'feedback':torch.tensor([r['source']!='authored_legacy' for r in rows])}
    torch.save(data,path);write(data_dir/'features-manifest.json',{'fingerprint':fingerprint,'sha256':sha(path),'rows':len(rows),'acceptance':len(acceptance),
       'actual_classifier_scores':True,'scenario_labels_in_affect':False,'encoder_trained':False,'classifier_trained':False})
    return rows,acceptance,data

def metrics(p,y,actions=MODEL_ACTION_IDS):
    p=np.asarray(p);y=np.asarray(y);f={}
    for i,name in enumerate(actions):
        tp=((p==i)&(y==i)).sum();fp=((p==i)&(y!=i)).sum();fn=((p!=i)&(y==i)).sum();f[name]=float(2*tp/max(1,2*tp+fp+fn))
    none=y==0;thanks=MODEL_ACTION_IDS.index('thanks');nonthanks=y!=thanks
    return {'macro_f1':float(np.mean(list(f.values()))),'accuracy':float((p==y).mean()),'false_trigger_rate':float((p[none]!=0).mean()) if none.any() else 0.,
            'thanks_false_positive_rate':float((p[nonthanks]==thanks).mean()) if nonthanks.any() else 0.,'per_action_f1':f,'samples':len(y)}

def parent_model():
    saved=torch.load(PARENT/'event.pt',map_location='cpu',weights_only=True);m=EventExpert(saved['classes'],saved['width'],history_dim=saved['history_dim']);m.load_state_dict(saved['state_dict']);return m.cuda().eval(),saved

def old_history(h):
    old=read(ROOT/'research/acting-feedback-r3/r2-motion-history.json');new=read(ROOT/'contracts/motion-history.json');ix={n:i for i,n in enumerate(new['actions'])}
    columns=[h[:,ix[name]] for name in old['actions'][:-1]]
    columns.append(sum(h[:,i] for name,i in ix.items() if name not in old['actions'][:-1]))
    return torch.cat([torch.stack(columns,1),h[:,len(new['actions']):]],1)

@torch.inference_mode()
def predict(model,t,threshold=0.,parent=False):
    outputs=[]
    for i in range(0,len(t['semantic']),512):
        h=t['history'][i:i+512];outputs.append(model(t['semantic'][i:i+512],t['affect'][i:i+512],old_history(h) if parent else h))
    out={k:torch.cat([o[k] for o in outputs]) for k in outputs[0]};confidence,index=out['action'].softmax(-1).max(-1)
    index=index.masked_fill((index>0)&(confidence<threshold),0);return index,out,confidence

def report(index,out,t,parent=False):
    result=metrics(index.cpu().tolist(),t['actions'].cpu().tolist());fb=t['feedback'];result['feedback_authored']=metrics(index[fb].cpu().tolist(),t['actions'][fb].cpu().tolist())
    result['legacy']=metrics(index[~fb].cpu().tolist(),t['actions'][~fb].cpu().tolist(),MODEL_ACTION_IDS[:14])
    positive=t['actions']!=0;correct=positive&(index==t['actions']);result['variant_accuracy_correct_action']=float((out['variant'].argmax(-1)[correct]==t['variants'][correct]).float().mean()) if correct.any() else 0.
    prediction=(40+out['values'][:,2]*760)/(t['duration_ms']) if parent else out['values'][:,2]*.95
    result['anchor_fraction_mae']=float((prediction[positive]-t['values'][positive,2]*.95).abs().mean()) if positive.any() else 0.
    return result

def warm_start(seed):
    torch.manual_seed(seed);m=EventExpert(len(MODEL_ACTION_IDS)).cuda();p,s=parent_model();old=p.state_dict();new=m.state_dict()
    for k,v in old.items():
        if k not in ('action.weight','action.bias','history.weight'):new[k]=v
    new['action.weight'][:s['classes']]=old['action.weight'];new['action.bias'][:s['classes']]=old['action.bias']
    oldc=read(ROOT/'research/acting-feedback-r3/r2-motion-history.json');newc=read(ROOT/'contracts/motion-history.json')
    for i,name in enumerate(oldc['actions']):new['history.weight'][:,newc['actions'].index(name)]=old['history.weight'][:,i]
    new['history.weight'][:,len(newc['actions']):]=old['history.weight'][:,len(oldc['actions']):]
    new['values.weight'][2].zero_();new['values.bias'][2]=-1.7;m.load_state_dict(new);del p;return m

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--steps',type=int,default=2400);parser.add_argument('--seeds',type=int,nargs='+',default=[24041,7137,42]);parser.add_argument('--out',type=Path,default=OUT);args=parser.parse_args()
    out=args.out
    if (out/'run.json').exists():raise RuntimeError('Refusing to overwrite a completed experiment')
    if not torch.cuda.is_available():raise RuntimeError('GPU training required')
    torch.set_num_threads(4);start=time.perf_counter();rows,acceptance,data=prepare(DATA);out.mkdir(parents=True,exist_ok=True)
    tensors={}
    for split in ['train','validation','test']:
        ix=[i for i,r in enumerate(rows) if r['split']==split];tensors[split]={k:v[ix].cuda() for k,v in data.items() if isinstance(v,torch.Tensor)}
        tensors[split]['duration_ms']=torch.tensor([max(1000,len(rows[i]['text'])*170) for i in ix],device='cuda')
    parent,saved=parent_model();base={}
    for split in ['validation','test']:
        ix,raw,_=predict(parent,tensors[split],saved['threshold'],True);base[split]=report(ix,raw,tensors[split],True)
    train=tensors['train'];counts=torch.bincount(train['actions'],minlength=len(MODEL_ACTION_IDS)).clamp_min(1).float();class_weight=(len(train['actions'])/counts).pow(.55);class_weight/=class_weight.mean()
    best=None;logs=[];val=tensors['validation']
    for seed in args.seeds:
        model=warm_start(seed);optimizer=torch.optim.AdamW(model.parameters(),lr=2.5e-4,weight_decay=.025)
        for step in range(1,args.steps+1):
            model.train();j=torch.randint(len(train['actions']),(192,),device='cuda');raw=model(train['semantic'][j],train['affect'][j],train['history'][j]);positive=train['actions'][j]!=0;w=train['weights'][j]
            loss=(F.cross_entropy(raw['action'],train['actions'][j],weight=class_weight,reduction='none',label_smoothing=.02)*w).sum()/w.sum()
            if positive.any():
                vw=train['variant_weights'][j][positive]*w[positive];loss+=.5*(F.cross_entropy(raw['variant'][positive],train['variants'][j][positive],reduction='none')*vw).sum()/vw.sum()
                values=F.smooth_l1_loss(raw['values'][positive],train['values'][j][positive],reduction='none');loss+=3*(values*w[positive,None]).sum()/w[positive].sum()/3
            optimizer.zero_grad();loss.backward();torch.nn.utils.clip_grad_norm_(model.parameters(),2);optimizer.step()
            if step%200==0:
                model.eval();index,raw,confidence=predict(model,val);options=[]
                for threshold in np.arange(0,.86,.05):
                    p=index.masked_fill((index>0)&(confidence<float(threshold)),0);r=report(p,raw,val)
                    if r['false_trigger_rate']<=base['validation']['false_trigger_rate']+.015 and r['legacy']['false_trigger_rate']<=base['validation']['legacy']['false_trigger_rate']+.01:
                        score=.5*r['macro_f1']+.5*r['feedback_authored']['macro_f1']-.2*r['false_trigger_rate']-.1*r['anchor_fraction_mae'];options.append((score,float(threshold),r))
                if options:
                    score,threshold,result=max(options,key=lambda x:x[0]);entry={'seed':seed,'step':step,'score':score,'threshold':threshold,'metrics':result};logs.append(entry)
                    if best is None or score>best['score']:
                        best=entry;atomic(out/'event.pt',lambda path:save_event(path,model,{'action_ids':MODEL_ACTION_IDS,'threshold':threshold,'plan_schema':'performance.plan.v4','selected_seed':seed,'selected_step':step,'catalog_sha256':catalog_sha256(),'history_sha256':sha(ROOT/'contracts/motion-history.json'),'dataset_sha256':sha(DATA/'records.jsonl'),'features_sha256':sha(DATA/'features.pt')}))
                    write(out/'training-progress.json',{'seed':seed,'step':step,'best':best,'elapsed_s':time.perf_counter()-start});write(out/'training-log.json',logs)
                    print(json.dumps({'stage':'train','seed':seed,'step':step,'score':score,'best':best['score']}),flush=True)
        del model;torch.cuda.empty_cache()
    if best is None:raise RuntimeError('No validation checkpoint passed false-trigger constraint')
    model,saved=load_event(out/'event.pt','cuda');index,raw,_=predict(model,tensors['test'],saved['threshold']);test=report(index,raw,tensors['test'])
    ac={k:v.cuda() for k,v in data['acceptance'].items()};pi,_,_=predict(parent,ac,read(PARENT/'run.json')['models']['event']['threshold'],True);ci,co,_=predict(model,ac,saved['threshold'])
    acceptance_report=[]
    for i,r in enumerate(acceptance):acceptance_report.append({**r,'baseline_action':MODEL_ACTION_IDS[int(pi[i])],'candidate_action':MODEL_ACTION_IDS[int(ci[i])],'variant':int(co['variant'][i].argmax()),'predicted_anchor_fraction':float(co['values'][i,2]*.95),'pass':MODEL_ACTION_IDS[int(ci[i])] in r['allowed_actions']})
    source=read(PARENT/'run.json');continuous=source['models']['continuous'];shutil.copyfile(PARENT/continuous['checkpoint'],out/'continuous.pt')
    gate={'overall_f1':test['macro_f1']>=base['test']['macro_f1']-.04,'feedback_f1':test['feedback_authored']['macro_f1']>=base['test']['feedback_authored']['macro_f1']+.12,
          'false_triggers':test['false_trigger_rate']<=base['test']['false_trigger_rate']+.015,'thanks_false_positives':test['thanks_false_positive_rate']<=base['test']['thanks_false_positive_rate']+.005,
          'legacy_false_triggers':test['legacy']['false_trigger_rate']<=base['test']['legacy']['false_trigger_rate']+.015,
          'anchor_error':test['anchor_fraction_mae']<=.12,'continuous_identical':sha(out/'continuous.pt')==sha(PARENT/'continuous.pt')};gate['passed']=all(gate.values())
    run={'schema':'vtuber.v6.native28_motion','runtime_version':VERSION,'stage':'acting_feedback_r3','promoted':False,'catalog_sha256':catalog_sha256(),'history_sha256':sha(ROOT/'contracts/motion-history.json'),
         'emotion_config_sha256':emotion_config_sha256(),'profile_sha256':source['profile_sha256'],'models':{'continuous':{**continuous,'reused_from':str(PARENT.relative_to(ROOT))},
         'event':{'checkpoint':'event.pt','sha256':sha(out/'event.pt'),'action_ids':MODEL_ACTION_IDS,'history_dim':STATE_DIM,'parameters':sum(p.numel() for p in model.parameters()),'threshold':saved['threshold'],'selected_seed':saved['selected_seed'],'selected_step':saved['selected_step'],'plan_schema':'performance.plan.v4'}},
         'gate':gate,'validation':best,'evaluation':{'baseline_r2':base['test'],'candidate':test,'training_replay':{'passed':sum(r['pass'] for r in acceptance_report),'total':len(acceptance_report),'selection_use':False,'independent_test':False}},
         'dataset':read(DATA/'manifest.json'),'features_sha256':sha(DATA/'features.pt'),'elapsed_s':time.perf_counter()-start,'training':{'seeds':args.seeds,'steps_per_seed':args.steps,'trained_components':['event_head'],'frozen':['emotion_classifier','semantic_encoder','continuous','tts']}}
    write(out/'training-replay.json',acceptance_report);write(out/'run.json',run);print(json.dumps({'stage':'complete','gate':gate,'test':test,'elapsed_s':run['elapsed_s']}),flush=True)
    if not gate['passed']:raise RuntimeError('Candidate failed gates; do not promote')

if __name__=='__main__':main()
