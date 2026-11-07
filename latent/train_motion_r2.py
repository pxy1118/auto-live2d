"""Train the existing-action event head on causal native-28 playback states.

No new motion assets, emotion labels, or large-model weights are trained.
The r1 continuous head is copied byte-for-byte and keeps its own contract.
"""
import argparse,copy,hashlib,importlib.util,json,random,shutil,time
from pathlib import Path
import numpy as np
import torch
from torch.nn import functional as F
from common import ROOT,sha
from catalog_contract import ACTION_BY_ID,MODEL_ACTION_IDS,catalog_sha256
from emotion import EmotionClassifier,emotion_spans,emotion_inputs,build_timeline
from emotion_config import LABELS,THRESHOLDS,AFFECT_DIM,build_affect_vector,emotion_config_sha256,thresholds_sha256
from emotion_curve import CurveSimulator
from emotion_event import EventExpert,project_target,values_target,save_event,load_event
from motion_history import authored_history,state_vector,STATE_DIM

OUT=ROOT/'experiments/vtuber-v6-native28-motion-r2'
R1=ROOT/'experiments/vtuber-v6-emotion-catalog-r1'
CACHE=ROOT/'datasets/emotion-catalog-v1/affect-cache.pt'
RECORDS=ROOT/'datasets/vtuber-v4-planner-v2/records.jsonl'
FEATURES=ROOT/'datasets/native28-motion-r2'
VERSION='v6.1.0-native28-motion'

def write(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(value,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf-8')

def timeline(text,lookup,previous=''):
    spans=emotion_spans(text);windows=emotion_inputs(text,spans,previous)
    return build_timeline(text,spans,windows,[lookup[w] for w in windows],THRESHOLDS)

def prepare(rows,cache):
    fingerprint={'records':sha(RECORDS),'scores_cache':sha(CACHE),'emotion_config':emotion_config_sha256(),'history':sha(ROOT/'contracts/motion-history.json'),'preparation':'causal-predecessor-v1'}
    saved=FEATURES/'features.pt'
    if saved.exists():
        value=torch.load(saved,map_location='cpu',weights_only=True)
        if value.get('fingerprint')==fingerprint:return value
        raise RuntimeError('Existing r2 feature cache has another fingerprint')
    pools={}
    for i,row in enumerate(rows):pools.setdefault((row['split'],project_target(row['target'])['id']),[]).append(i)
    prefixes=[];missing=set();lookup=dict(cache['scores']);rng=random.Random(24041)
    for i,row in enumerate(rows):
        history=authored_history(row['state']);pool=pools.get((row['split'],history['last_action']),[])
        predecessor=rows[rng.choice(pool)] if pool else None
        previous=predecessor['text'] if predecessor and predecessor['id']!=row['id'] else ''
        prefixes.append((previous,predecessor['id'] if previous else None))
        for text,prior in [(row['text'],previous),(previous,'')]:
            if text:
                for window in emotion_inputs(text,emotion_spans(text),prior):
                    if window not in lookup:missing.add(window)
    classifier=None;missing=sorted(missing)
    if missing:
        classifier=EmotionClassifier(device='cuda')
        for start in range(0,len(missing),16):
            batch=missing[start:start+16];lookup.update(zip(batch,classifier.classify_many(batch)))
            if start%256==0:print(json.dumps({'stage':'classify_causal_windows','done':min(start+16,len(missing)),'total':len(missing)}),flush=True)
        del classifier;torch.cuda.empty_cache()
    x=[];affect=[];history_rows=[];targets=[];variants=[];values=[];provenance=[]
    carry_fields=['response','mood','response_velocity','mood_velocity','response_tension','mood_tension','response_tension_velocity','mood_tension_velocity']
    for i,row in enumerate(rows):
        previous,predecessor=prefixes[i]
        sim=CurveSimulator(timeline(row['text'],lookup,previous),max(1000,len(row['text'])*170),THRESHOLDS)
        if previous:
            duration=max(1000,len(previous)*170);prior=CurveSimulator(timeline(previous,lookup),duration,THRESHOLDS);prior.advance_to(duration)
            for name in carry_fields:setattr(sim,name,copy.deepcopy(getattr(prior,name)))
        offset=[0.,80.,200.,500.,1000.][int(hashlib.sha256(row['id'].encode()).hexdigest()[:8],16)%5]
        sim.advance_to(offset);sample=sim.sample();style=['restrained','natural','lively'][i%3]
        vector=build_affect_vector(dict(zip(LABELS,sample['response'])),dict(zip(LABELS,sample['mood'])),sample['tension'],sample['vad'],sample['intensity'],style)
        target=project_target(row['target']);x.append(cache['pooled'][row['text']+'\n'+row['context']])
        affect.append(vector);history_rows.append(state_vector(authored_history(row['state'])))
        targets.append(MODEL_ACTION_IDS.index(target['id']));variants.append(target['variant']%ACTION_BY_ID[target['id']]['variants']);values.append(values_target(target))
        provenance.append({'id':row['id'],'split':row['split'],'predecessor':predecessor,'sample_ms':offset,'style':style})
    data={'fingerprint':fingerprint,'semantic':torch.stack(x).float(),'affect':torch.tensor(affect),'history':torch.tensor(history_rows),'actions':torch.tensor(targets),'variants':torch.tensor(variants),'values':torch.tensor(values),'provenance':provenance}
    FEATURES.mkdir(parents=True,exist_ok=True);torch.save(data,saved)
    write(FEATURES/'manifest.json',{'schema':'native28.motion.features.v1','records':len(rows),'fingerprint':fingerprint,'history_dim':STATE_DIM,'affect_dim':AFFECT_DIM,'new_assets':0,'segment_records':0,'conditions':'actual classifier scores; causal predecessor and playback-state simulation; no legacy emotion/face inputs','source':'existing authored synthetic action supervision, no new human ratings','features_sha256':sha(saved)})
    return data

def metrics(predicted,truth):
    p=np.asarray(predicted);y=np.asarray(truth);f=[]
    for c in range(len(MODEL_ACTION_IDS)):
        tp=((p==c)&(y==c)).sum();fp=((p==c)&(y!=c)).sum();fn=((p!=c)&(y==c)).sum();f.append(float(2*tp/max(1,2*tp+fp+fn)))
    neutral=y==0
    return {'macro_f1':float(np.mean(f)),'false_trigger_rate':float((p[neutral]!=0).mean()) if neutral.any() else 0.,'accuracy':float((p==y).mean()),'per_action_f1':dict(zip(MODEL_ACTION_IDS,f))}

def baseline(rows,data,split):
    path=ROOT/'research/emotion-catalog-r1-archive/event_r1.py'
    spec=importlib.util.spec_from_file_location('baseline_event_r1',path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    model,saved=module.load_event(R1/'event.pt','cuda');indices=[i for i,row in enumerate(rows) if row['split']==split];result=[]
    with torch.inference_mode():
        for start in range(0,len(indices),256):
            j=indices[start:start+256];output=model(data['semantic'][j].cuda(),data['affect'][j].cuda(),torch.tensor([rows[i]['state_vector'] for i in j],device='cuda'))
            arms=output['arm'].argmax(-1).tolist();bodies=output['body'].argmax(-1).tolist()
            for arm,body in zip(arms,bodies):
                name=saved['arm_ids'][arm] if arm else saved['body_ids'][body]
                result.append(MODEL_ACTION_IDS.index(name) if name in MODEL_ACTION_IDS else -1)
    del model;torch.cuda.empty_cache()
    return metrics(result,data['actions'][indices].tolist())

def evaluate(model,tensors,threshold=0.):
    with torch.inference_mode():output=model(tensors['semantic'],tensors['affect'],tensors['history'])
    confidence,index=output['action'].softmax(-1).max(-1);index=index.masked_fill((index>0)&(confidence<threshold),0)
    result=metrics(index.cpu().tolist(),tensors['actions'].cpu().tolist())
    result['values_mae']=float((output['values']-tensors['values']).abs().mean());result['threshold']=threshold
    return result,output

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--steps',type=int,default=4000);args=parser.parse_args()
    if (OUT/'event.pt').exists():raise RuntimeError('Refusing to overwrite trained r2 checkpoint')
    torch.set_num_threads(4);started=time.perf_counter();rows=[json.loads(line) for line in RECORDS.read_text(encoding='utf-8-sig').splitlines()]
    cache=torch.load(CACHE,map_location='cpu',weights_only=True);data=prepare(rows,cache);del cache
    parent={split:baseline(rows,data,split) for split in ['validation','test']}
    tensors={}
    for split in ['train','validation','test']:
        indices=[i for i,row in enumerate(rows) if row['split']==split]
        tensors[split]={key:data[key][indices].cuda() for key in ['semantic','affect','history','actions','variants','values']}
    train=tensors['train'];counts=torch.bincount(train['actions'],minlength=len(MODEL_ACTION_IDS)).clamp_min(1).float()
    class_weight=(len(train['actions'])/counts).pow(.7);class_weight/=class_weight.mean()
    OUT.mkdir(parents=True,exist_ok=True);best=None;logs=[]
    for seed in [7137,24041,42]:
        torch.manual_seed(seed);model=EventExpert(len(MODEL_ACTION_IDS)).cuda();optimizer=torch.optim.AdamW(model.parameters(),lr=4e-4,weight_decay=.025)
        for step in range(1,args.steps+1):
            model.train();j=torch.randint(len(train['actions']),(128,),device='cuda');h=train['history'][j].clone()
            # A future registered director action can be executable before the
            # selector learns its ID; its history has an explicit unknown slot.
            replace=torch.rand(len(j),device='cuda')<.08;h[replace,:len(MODEL_ACTION_IDS)+1]=0;h[replace,len(MODEL_ACTION_IDS)]=1
            output=model(train['semantic'][j],train['affect'][j],h);mask=train['actions'][j]!=0
            loss=F.cross_entropy(output['action'],train['actions'][j],weight=class_weight)
            if mask.any():loss=loss+.3*F.cross_entropy(output['variant'][mask],train['variants'][j][mask])+2*F.smooth_l1_loss(output['values'][mask],train['values'][j][mask])
            optimizer.zero_grad();loss.backward();torch.nn.utils.clip_grad_norm_(model.parameters(),2);optimizer.step()
            if step%200==0:
                model.eval();result,output=evaluate(model,tensors['validation']);options=[]
                confidence,index=output['action'].softmax(-1).max(-1)
                for threshold in np.arange(0,.91,.05):
                    predicted=index.masked_fill((index>0)&(confidence<float(threshold)),0);m=metrics(predicted.cpu().tolist(),tensors['validation']['actions'].cpu().tolist())
                    if m['false_trigger_rate']<=parent['validation']['false_trigger_rate']+.01:options.append((m['macro_f1']-.2*m['false_trigger_rate'],float(threshold),m))
                if not options:continue
                score,threshold,validation=max(options,key=lambda option:option[0]);log={'seed':seed,'step':step,'score':score,'threshold':threshold,**validation};logs.append(log)
                if best is None or score>best['score']:
                    best=log;save_event(OUT/'event.pt',model,{'action_ids':MODEL_ACTION_IDS,'catalog_sha256':catalog_sha256(),'emotion_config_sha256':emotion_config_sha256(),'history_sha256':sha(ROOT/'contracts/motion-history.json'),'features_sha256':sha(FEATURES/'features.pt'),'selected_seed':seed,'selected_step':step,'threshold':threshold})
                if step%1000==0:print(json.dumps({'stage':'train','seed':seed,'step':step,'validation_macro_f1':validation['macro_f1'],'best':best['score']}),flush=True)
        del model;torch.cuda.empty_cache()
    model,saved=load_event(OUT/'event.pt','cuda');test,_=evaluate(model,tensors['test'],saved['threshold']);del model
    source=json.loads((R1/'run.json').read_text(encoding='utf-8-sig'));continuous=source['models']['continuous'];shutil.copyfile(R1/continuous['checkpoint'],OUT/'continuous.pt')
    gate={'macro_f1_pass':test['macro_f1']>=parent['test']['macro_f1']-.02,'false_trigger_pass':test['false_trigger_rate']<=parent['test']['false_trigger_rate']+.01,'continuous_pass':sha(OUT/'continuous.pt')==sha(R1/continuous['checkpoint'])}
    gate['passed']=all(gate.values())
    run={'schema':'vtuber.v6.native28_motion','runtime_version':VERSION,'stage':'native28_motion_r2','promoted':False,'catalog_sha256':catalog_sha256(),'emotion_config_sha256':emotion_config_sha256(),'history_sha256':sha(ROOT/'contracts/motion-history.json'),'profile_sha256':source.get('profile_sha256',json.loads((ROOT/'latent/runtime-profile.json').read_text())['sha256']),
         'models':{'continuous':{**continuous,'sha256':sha(OUT/'continuous.pt'),'reused_from':'experiments/vtuber-v6-emotion-catalog-r1'},'event':{'checkpoint':'event.pt','sha256':sha(OUT/'event.pt'),'parameters':sum(p.numel() for p in EventExpert(len(MODEL_ACTION_IDS)).parameters()),'history_dim':STATE_DIM,'action_ids':MODEL_ACTION_IDS,'threshold':saved['threshold'],'selected_seed':saved['selected_seed'],'selected_step':saved['selected_step']}},
         'gate':gate,'evaluation':{'event':{'ours':test,'baseline_r1':parent['test']},'continuous':{'ratio_to_r1':1.,'inherited_ratio_to_v5':source['gate']['continuous_ratio'],'source_report':'experiments/vtuber-v6-emotion-catalog-r1/REPORT.md','new_training':False}},'validation':best,'training_log':logs,'source_records_sha256':sha(RECORDS),'features_sha256':sha(FEATURES/'features.pt'),'new_actions':0,'uses_4b':False,'elapsed_s':time.perf_counter()-started}
    write(OUT/'run.json',run);print(json.dumps({'stage':'complete','gate':gate,'event':test,'baseline':parent['test'],'elapsed_s':run['elapsed_s']}),flush=True)
    if not gate['passed']:raise RuntimeError('Candidate failed evaluation gates; default pointer not changed')

if __name__=='__main__':main()
