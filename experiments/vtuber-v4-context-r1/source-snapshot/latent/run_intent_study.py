"""Matched fixed-budget body probes. Old final test is never opened."""
import collections
import copy
import itertools
import json
import random
import time
from pathlib import Path
import numpy as np
import torch
from torch.nn import functional as F
from common import ROOT,sha
from intent_study import BodyProbe,labels,type_strength_loss,decide,metrics,calibration_objective,necessity_metrics
from cache_intent_features import read_dataset

DATA=ROOT/'datasets/vtuber-v4-intent-v1';OUT=ROOT/'experiments/vtuber-v4-intent-r1'
PROTOCOL=ROOT/'research/vtuber-v4-intent-study/protocol.json'
RATE_KEYS=['forbidden_activation','required_success','required_any_activity','acceptable_rate','preferred_match',
           'optional_activity','optional_unacceptable','active_amplitude_outside','accepted_active_amplitude_outside']

def write(path,value):path.write_text(json.dumps(value,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf-8')

def tensor_input(rows,records):
    return [torch.stack([records[r['id']][k] for r in rows]) for k in ['body_h','pooled_h']]

@torch.inference_mode()
def predict(model,rows,records):return model(*tensor_input(rows,records))

def fit(train,records,base,method,seed,recipe,parent=None):
    torch.manual_seed(seed);generator=torch.Generator().manual_seed(seed)
    model=BodyProbe();model.initialize(base);x,z=tensor_input(train,records);y=labels(train)
    if parent is not None:
        model.kind.load_state_dict(parent.kind.state_dict());model.strength.load_state_dict(parent.strength.state_dict())
        model.kind.requires_grad_(False);model.strength.requires_grad_(False);parameters=model.necessity.parameters()
    else:
        model.necessity.requires_grad_(False);parameters=itertools.chain(model.kind.parameters(),model.strength.parameters())
    optimizer=torch.optim.AdamW(parameters,lr=recipe['lr'],weight_decay=recipe['weight_decay']);trace=[];begin=time.perf_counter()
    for step in range(recipe['steps']):
        idx=torch.randint(len(train),(recipe['batch_size'],),generator=generator);output=model(x[idx],z[idx])
        target={k:v[idx] for k,v in y.items()}
        cost=F.cross_entropy(output['necessity'],target['necessity']) if method=='necessity' else type_strength_loss(output,target,method)
        optimizer.zero_grad();cost.backward();optimizer.step()
        if (step+1)%200==0:trace.append(dict(step=step+1,loss=float(cost.detach())))
    return model.eval(),dict(trace=trace,elapsed_s=round(time.perf_counter()-begin,3))

def calibrate(output,rows,method,protocol):
    temperature=1.
    if method=='necessity':
        temperature=min(protocol['temperature_candidates'],key=lambda t:necessity_metrics(output['necessity'],rows,t)['nll'])
    grid=protocol['threshold_grid'];best_key=None;best=None
    candidates=itertools.product(grid['active'],grid['forbidden'],grid['required']) if method=='necessity' else ((a,None,None) for a in grid['active'])
    for a,f,r in candidates:
        config=dict(active_threshold=a)
        if method=='necessity':config.update(temperature=temperature,forbidden_threshold=f,required_threshold=r)
        pred,amp=decide(output['logits'],output['strength'],necessity=output['necessity'] if method=='necessity' else None,**config)
        m=metrics(rows,pred,amp);rank=(round(calibration_objective(m),10),m['required_success'],a)
        if best_key is None or rank>best_key:best_key=rank;best=dict(config=config,calibration=m,score=rank[0])
    return best

def family_intervals(rows,runs,draws=1000):
    # Cluster bootstrap keeps all clauses, paired stories and history variants together.
    families=sorted({r['family'] for r in rows});groups={f:[i for i,r in enumerate(rows) if r['family']==f] for f in families}
    generator=np.random.default_rng(8813);samples={k:[] for k in RATE_KEYS}
    for _ in range(draws):
        indices=[i for f in generator.choice(families,size=len(families),replace=True) for i in groups[f]]
        subset=[rows[i] for i in indices];mm=[metrics(subset,r['pred'][indices],r['amplitude'][indices]) for r in runs]
        for key in RATE_KEYS:
            values=[m[key] for m in mm if m[key] is not None]
            if values:samples[key].append(float(np.mean(values)))
    return {k:[float(np.percentile(v,2.5)),float(np.percentile(v,97.5))] for k,v in samples.items() if v}

def paired_intervals(rows,a,b,draws=1000):
    families=sorted({r['family'] for r in rows});groups={f:[i for i,r in enumerate(rows) if r['family']==f] for f in families}
    generator=np.random.default_rng(8813);samples={k:[] for k in RATE_KEYS}
    for _ in range(draws):
        indices=[i for f in generator.choice(families,size=len(families),replace=True) for i in groups[f]]
        subset=[rows[i] for i in indices]
        aa=[metrics(subset,r['pred'][indices],r['amplitude'][indices]) for r in a]
        bb=[metrics(subset,r['pred'][indices],r['amplitude'][indices]) for r in b]
        for key in RATE_KEYS:
            va=[m[key] for m in aa if m[key] is not None];vb=[m[key] for m in bb if m[key] is not None]
            if va and vb:samples[key].append(float(np.mean(va)-np.mean(vb)))
    return {k:[float(np.percentile(v,2.5)),float(np.percentile(v,97.5))] for k,v in samples.items() if v}

def mean_std(values):
    values=[v for v in values if v is not None]
    return dict(mean=float(np.mean(values)) if values else None,std=float(np.std(values)) if values else None)

def main():
    OUT.mkdir(parents=True,exist_ok=True)
    if (OUT/'results.json').exists():raise RuntimeError('Completed study is immutable; use a new experiment version')
    torch.set_num_threads(3);protocol=json.loads(PROTOCOL.read_text());rows=read_dataset(DATA)
    meta=json.loads((OUT/'features/cache.json').read_text());assert meta['fingerprint']['protocol_sha256']==sha(PROTOCOL)
    assert meta['fingerprint']['dataset_sha256']==sha(DATA/'manifest.json') and not meta['old_test_loaded']
    assert meta['features_sha256']==sha(OUT/'features/body-features.pt')
    cache=torch.load(OUT/'features/body-features.pt',map_location='cpu',weights_only=True);records=cache['records']
    base=torch.load(ROOT/protocol['base'],map_location='cpu',weights_only=True)['state_dict']
    train=[r for r in rows if r['split']=='train']
    dev=[r for r in rows if r['split']=='development' and r['history_variant']=='canonical']
    cal=[r for r in rows if r['split']=='calibration' and r['history_variant']=='canonical']
    dev_all=[r for r in rows if r['split']=='development'];saved_runs=[];runs=collections.defaultdict(list)
    for seed in protocol['seeds']:
        parent=None
        for method in ['preferred','acceptable','necessity']:
            model,fit_info=fit(train,records,base,method,seed,protocol['optimizer'],parent=parent if method=='necessity' else None)
            if method=='acceptable':parent=model
            calibrated=calibrate(predict(model,cal,records),cal,method,protocol)
            output=predict(model,dev,records);config=calibrated['config']
            pred,amp=decide(output['logits'],output['strength'],necessity=output['necessity'] if method=='necessity' else None,**config)
            all_output=predict(model,dev_all,records)
            all_pred,all_amp=decide(all_output['logits'],all_output['strength'],necessity=all_output['necessity'] if method=='necessity' else None,**config)
            entry=dict(method=method,seed=seed,calibrated=calibrated,development=metrics(dev,pred,amp),
                development_all_histories=metrics(dev_all,all_pred,all_amp),fit=fit_info,
                necessity_development_before=necessity_metrics(output['necessity'],dev) if method=='necessity' else None,
                necessity_development_after=necessity_metrics(output['necessity'],dev,config['temperature']) if method=='necessity' else None,
                necessity_calibration_before=necessity_metrics(predict(model,cal,records)['necessity'],cal) if method=='necessity' else None,
                necessity_calibration_after=necessity_metrics(predict(model,cal,records)['necessity'],cal,config['temperature']) if method=='necessity' else None)
            checkpoint=OUT/f'{method}-{seed}.pt';torch.save(dict(state_dict=model.state_dict(),config=config,
                frozen_base_sha256=protocol['base_sha256'],protocol_sha256=sha(PROTOCOL),dataset_sha256=sha(DATA/'manifest.json')),checkpoint)
            entry['checkpoint_sha256']=sha(checkpoint);saved_runs.append(entry);runs[method].append(dict(pred=pred,amplitude=amp))
            decisions=[dict(id=r['id'],text=r['text'],annotation=r['body_annotation'],body=int(p),amplitude=float(a),
                            body_probabilities=probs.tolist(),necessity_probabilities=intent.tolist() if method=='necessity' else None)
                       for r,p,a,probs,intent in zip(dev,pred,amp,output['logits'].softmax(-1),(output['necessity']/config.get('temperature',1.)).softmax(-1))]
            write(OUT/f'{method}-{seed}-decisions.json',decisions)
            print(json.dumps(dict(method=method,seed=seed,metrics=entry['development'])),flush=True)
    raw=torch.stack([records[r['id']]['body_logits'] for r in dev]);strength=torch.stack([records[r['id']]['body_strength'] for r in dev])
    old_pred,old_amp=decide(raw,strength,.4);runs['frozen_r1'].append(dict(pred=old_pred,amplitude=old_amp))
    zero=torch.zeros(len(dev),dtype=torch.long);runs['all_none'].append(dict(pred=zero,amplitude=torch.zeros(len(dev))))
    # Uses the same fixed action for every clause. This is a diagnostic, not a real model.
    runs['always_lean'].append(dict(pred=zero+1,amplitude=torch.zeros(len(dev))+.6))
    summary={}
    for method,rr in runs.items():
        mm=[metrics(dev,r['pred'],r['amplitude']) for r in rr]
        summary[method]=dict(seeds=len(rr),metrics={k:mean_std([m[k] for m in mm]) for k in RATE_KEYS},family_bootstrap_95=family_intervals(dev,rr))
    # Paired family intervals for the incremental gate effect, using identical B heads.
    result=dict(schema='intent-study-results.v1',status='exploratory_development_only',promoted=False,
        protocol_sha256=sha(PROTOCOL),dataset_sha256=sha(DATA/'manifest.json'),features_sha256=meta['features_sha256'],
        old_test_loaded=False,new_final_test_created=False,train_rows=len(train),development_clauses=len(dev),development_families=len({r['family'] for r in dev}),
        calibration_clauses=len(cal),calibration_families=len({r['family'] for r in cal}),runs=saved_runs,summary=summary,
        necessity_minus_acceptable_paired_family_95=paired_intervals(dev,runs['necessity'],runs['acceptable']),
        inference_scope='Body proposals; execution busy/cooldown and rendered naturalness not tested by this pilot',
        missing_development_preferred_classes=sorted(set(['lean','sway','nod','tilt','turn','cajole'])-{r['body_annotation']['preferred'] for r in dev}),
        caveats=['Assistant-authored draft labels, no human agreement measurement','Only 18 development and 18 calibration families',
                 'Frozen shared representation: a linear-probe study, not full expert retraining',
                 'Calibration metrics are fitted in-sample; development estimate is separate',
                 'History augmentation is not additional independent evidence','No new final test or runtime promotion'])
    write(OUT/'results.json',result);print(json.dumps(dict(complete=True,output=str(OUT/'results.json'))),flush=True)
if __name__=='__main__':main()
