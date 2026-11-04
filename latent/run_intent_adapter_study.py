"""Adaptive development follow-up: frozen final heads versus body attention adaptation."""
import json
import time
from pathlib import Path
import torch
from torch.nn import functional as F
from common import ROOT,sha
from semantic_tokens import TokenPerformancePlanner,pad_features
from intent_study import BodyProbe,labels,type_strength_loss,decide,metrics,necessity_metrics
from cache_intent_features import read_dataset
from cache_intent_tokens import key
from run_intent_study import write,calibrate,family_intervals,paired_intervals,mean_std,RATE_KEYS,tensor_input

OUT=ROOT/'experiments/vtuber-v4-intent-r2';DATA=ROOT/'datasets/vtuber-v4-intent-v1'
PROTOCOL=ROOT/'research/vtuber-v4-intent-study/adapter-protocol.json'

class BodyAdapter(torch.nn.Module):
    def __init__(self,saved):
        super().__init__();self.shared=TokenPerformancePlanner(saved['input_dim'],saved['width'])
        self.shared.load_state_dict(saved['state_dict']);self.shared.requires_grad_(False)
        for layer in [self.shared.projection,self.shared.history,self.shared.attention,self.shared.mix]:layer.requires_grad_(True)
        self.shared.query.requires_grad_(True)
        self.head=BodyProbe();self.head.initialize(saved['state_dict'])
    def forward(self,tokens,mask,state):
        memory=self.shared.projection(tokens);query=self.shared.query[None]+self.shared.history(state)[:,None]
        attended,_=self.shared.attention(query,memory,memory,key_padding_mask=mask,need_weights=False)
        h=self.shared.mix(query+attended)
        return self.head(h[:,1],h.mean(1))

def adapter_input(rows,features):
    x,mask=pad_features([features[key(r)] for r in rows],'cuda')
    state=torch.tensor([r['state_vector'] for r in rows],device='cuda')
    return x,mask,state

@torch.inference_mode()
def predict(model,rows,features,records,method):
    model.eval();chunks=[]
    for start in range(0,len(rows),32):
        rr=rows[start:start+32]
        output=model(*adapter_input(rr,features)) if method=='joint_body_adapter' else model(*[t.cuda() for t in tensor_input(rr,records)])
        chunks.append({k:v.float().cpu() for k,v in output.items()})
    return {k:torch.cat([o[k] for o in chunks]) for k in chunks[0]}

def main():
    if (OUT/'results.json').exists():raise RuntimeError('Completed study is immutable')
    torch.set_num_threads(3);protocol=json.loads(PROTOCOL.read_text());r1_protocol=json.loads((ROOT/'research/vtuber-v4-intent-study/protocol.json').read_text())
    cache_meta=json.loads((OUT/'cache.json').read_text());assert cache_meta['fingerprint']['protocol_sha256']==sha(PROTOCOL)
    assert sha(OUT/'tokens.pt')==cache_meta['cache_sha256'] and cache_meta['fingerprint']['dataset_sha256']==sha(DATA/'manifest.json')
    cache=torch.load(OUT/'tokens.pt',map_location='cpu',weights_only=True);features={k:v.cuda() for k,v in cache['features'].items()}
    frozen=torch.load(ROOT/'experiments/vtuber-v4-intent-r1/features/body-features.pt',map_location='cpu',weights_only=True)
    records=frozen['records'];rows=read_dataset(DATA);saved=torch.load(ROOT/protocol['base'],map_location='cpu',weights_only=True)
    assert sha(ROOT/protocol['base'])==protocol['base_sha256']
    train=[r for r in rows if r['split']=='train'];target=labels(train)
    dev=[r for r in rows if r['split']=='development' and r['history_variant']=='canonical']
    cal=[r for r in rows if r['split']=='calibration' and r['history_variant']=='canonical']
    dev_all=[r for r in rows if r['split']=='development'];runs={m:[] for m in protocol['methods']};entries=[]
    for seed in protocol['seeds']:
        for method in protocol['methods']:
            torch.manual_seed(seed);generator=torch.Generator().manual_seed(seed);recipe=protocol['optimizer']
            if method=='joint_body_adapter':
                model=BodyAdapter(saved).cuda()
                groups=[dict(params=[p for p in model.shared.parameters() if p.requires_grad],lr=recipe['body_adapter_lr']),dict(params=model.head.parameters(),lr=recipe['head_lr'])]
            else:
                model=BodyProbe().cuda();model.initialize(saved['state_dict']);groups=[dict(params=model.parameters(),lr=recipe['head_lr'])]
            optimizer=torch.optim.AdamW(groups,weight_decay=recipe['weight_decay']);trace=[];begin=time.perf_counter()
            for step in range(recipe['steps']):
                model.train();idx=torch.randint(len(train),(recipe['batch_size'],),generator=generator).tolist();rr=[train[i] for i in idx]
                if method=='joint_body_adapter':output=model(*adapter_input(rr,features))
                else:output=model(*[t.cuda() for t in tensor_input(rr,records)])
                y={k:v[idx].cuda() for k,v in target.items()};cost=type_strength_loss(output,y,'acceptable')+F.cross_entropy(output['necessity'],y['necessity'])
                optimizer.zero_grad();cost.backward();torch.nn.utils.clip_grad_norm_(model.parameters(),2.);optimizer.step()
                if (step+1)%200==0:
                    trace.append(dict(step=step+1,loss=float(cost.detach())));print(json.dumps(dict(method=method,seed=seed,**trace[-1])),flush=True)
            calibration=predict(model,cal,features,records,method);calibrated=calibrate(calibration,cal,'necessity',r1_protocol)
            output=predict(model,dev,features,records,method);config=calibrated['config']
            pred,amp=decide(output['logits'],output['strength'],necessity=output['necessity'],**config)
            raw,raw_amp=decide(output['logits'],output['strength'])
            all_output=predict(model,dev_all,features,records,method)
            all_pred,all_amp=decide(all_output['logits'],all_output['strength'],necessity=all_output['necessity'],**config)
            train_canonical=[r for r in train if r['history_variant']=='canonical'];train_output=predict(model,train_canonical,features,records,method)
            train_pred,train_amp=decide(train_output['logits'],train_output['strength'],necessity=train_output['necessity'],**config)
            runs[method].append(dict(pred=pred,amplitude=amp))
            entry=dict(method=method,seed=seed,development=metrics(dev,pred,amp),development_raw=metrics(dev,raw,raw_amp),
                development_all_histories=metrics(dev_all,all_pred,all_amp),train=metrics(train_canonical,train_pred,train_amp),
                necessity_development_before=necessity_metrics(output['necessity'],dev),
                necessity_development_after=necessity_metrics(output['necessity'],dev,config['temperature']),
                calibrated=calibrated,trainable_parameters=sum(p.numel() for p in model.parameters() if p.requires_grad),
                trace=trace,elapsed_s=round(time.perf_counter()-begin,2))
            checkpoint=OUT/f'{method}-{seed}.pt';torch.save(dict(state_dict=model.state_dict(),config=config,method=method,
                dataset_sha256=sha(DATA/'manifest.json'),protocol_sha256=sha(PROTOCOL),base_sha256=protocol['base_sha256']),checkpoint)
            entry['checkpoint_sha256']=sha(checkpoint);entries.append(entry)
            decisions=[dict(id=r['id'],text=r['text'],annotation=r['body_annotation'],body=int(p),amplitude=float(a),
                            body_probabilities=probs.tolist(),necessity_probabilities=intent.tolist())
                       for r,p,a,probs,intent in zip(dev,pred,amp,output['logits'].softmax(-1),(output['necessity']/config['temperature']).softmax(-1))]
            write(OUT/f'{method}-{seed}-decisions.json',decisions)
            print(json.dumps(dict(method=method,seed=seed,development=entry['development'])),flush=True)
            del model,optimizer;torch.cuda.empty_cache()
    summary={}
    for method,rr in runs.items():
        mm=[metrics(dev,r['pred'],r['amplitude']) for r in rr]
        summary[method]=dict(seeds=len(rr),metrics={k:mean_std([m[k] for m in mm]) for k in RATE_KEYS},family_bootstrap_95=family_intervals(dev,rr))
    write(OUT/'results.json',dict(schema='intent-adapter-study.v1',status='adaptive_development_only',promoted=False,
        dataset_sha256=sha(DATA/'manifest.json'),protocol_sha256=sha(PROTOCOL),tokens_sha256=cache_meta['cache_sha256'],runs=entries,summary=summary,
        adapter_minus_heads_paired_family_95=paired_intervals(dev,runs['joint_body_adapter'],runs['joint_heads_only']),
        old_test_loaded=False,new_final_test_created=False,
        caveats=['Same development set inspected in r1; no independent final test','Only draft assistant labels',
                 'Body-only copied branch; arms, faces, appearance and runtime default unchanged','No runtime stability, latency or rendered naturalness acceptance']))
    print(json.dumps(dict(complete=True,output=str(OUT/'results.json'))),flush=True)
if __name__=='__main__':main()
