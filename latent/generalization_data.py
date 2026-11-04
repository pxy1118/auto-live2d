import json
from pathlib import Path
import torch
from planner_contract import ARMS,BODIES,EMOTIONS,EYES,target_values
from semantic_tokens import representation,pad_features

CHOICES={'arm':ARMS,'body':BODIES,'emotion':EMOTIONS,'eye':EYES,'arm_variant':list(range(3)),'body_variant':list(range(3))}

def read_rows(folder,split):
    if split not in ['train','validation','test']:raise ValueError('Unknown split')
    return [json.loads(line) for line in (Path(folder)/f'{split}.jsonl').read_text(encoding='utf-8').splitlines()]

def key(row):return json.dumps([row['text'],row['context']],ensure_ascii=False,separators=(',',':'))

def batch(rows,features,indices,mode,device):
    rr=[rows[i] for i in indices]
    x,mask=pad_features([representation(features[key(r)],mode) if mode else features[key(r)] for r in rr],device)
    state=torch.tensor([r['state_vector'] for r in rr],device=device)
    labels={k:torch.tensor([choices.index(r['target'][k]) for r in rr],device=device) for k,choices in CHOICES.items()}
    values=torch.tensor([target_values(r['target']) for r in rr],device=device).clamp(0,1)
    return x,mask,state,labels,values

def metrics(output,rows,thresholds=None):
    thresholds=thresholds or {};result={};active_fpr=[]
    for k,choices in list(CHOICES.items())[:4]:
        y=torch.tensor([choices.index(r['target'][k]) for r in rows],device=output[k].device)
        probabilities=output[k].float().softmax(-1);confidence,idx=probabilities.max(-1)
        gate=torch.full_like(confidence,thresholds.get(k,0.))
        if k=='arm' and thresholds:gate=torch.where(idx==ARMS.index('grass'),torch.maximum(gate,gate.new_tensor(.95)),gate)
        pred=torch.where((idx>0)&(confidence<gate),0,idx)
        f1=[]
        for i in range(len(choices)):
            tp=((pred==i)&(y==i)).sum();fp=((pred==i)&(y!=i)).sum();fn=((pred!=i)&(y==i)).sum()
            if (y==i).any():f1.append(float(2*tp/(2*tp+fp+fn).clamp_min(1)))
        positive=y>0;negative=~positive
        fpr=float(((pred>0)&negative).sum()/negative.sum().clamp_min(1));active_fpr.append(fpr)
        result[k]={'accuracy':float((pred==y).float().mean()),'macro_f1':sum(f1)/len(f1),
                   'correct_active_recall':float(((pred==y)&positive).sum()/positive.sum().clamp_min(1)),
                   'false_positive_rate':fpr,'active_samples':int(positive.sum()),'threshold':thresholds.get(k,0.)}
    target=torch.tensor([target_values(r['target']) for r in rows],device=output['values'].device).clamp(0,1)
    error=(output['values'].float()-target).abs();active=target[:,1:7]>.05
    result['regression_mae']=float(error.mean());result['active_face_mae']=float(error[:,1:7][active].mean()) if active.any() else 0.
    result['mean_macro_f1']=sum(result[k]['macro_f1'] for k in ['arm','body','emotion','eye'])/4
    result['mean_false_positive_rate']=sum(active_fpr)/4
    return result

def predict_all(model,rows,features,mode,device='cuda'):
    model.eval();chunks=[]
    with torch.inference_mode():
        for start in range(0,len(rows),64):
            x,mask,state,_,_=batch(rows,features,list(range(start,min(start+64,len(rows)))),mode,device)
            chunks.append({k:v.float().cpu() for k,v in model(x,mask,state).items()})
    return {k:torch.cat([c[k] for c in chunks]) for k in chunks[0]}

def subset(output,indices):return {k:v[indices] for k,v in output.items()}
