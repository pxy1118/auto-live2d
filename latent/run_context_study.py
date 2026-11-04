"""Same body decoder, data and seeds; vary only its frozen semantic input."""
import json
import time
import hashlib
from pathlib import Path
import numpy as np
import torch
from torch.nn import functional as F
from common import ROOT,sha
from cache_intent_features import read_dataset
from cache_intent_tokens import key
from semantic_tokens import pad_features
from context_prompts import MODES
from intent_study import labels,type_strength_loss,decide,metrics,necessity_metrics,NECESSITY
from run_intent_adapter_study import BodyAdapter,adapter_input
from run_intent_study import write,calibrate,family_intervals,paired_intervals,mean_std,RATE_KEYS
from planner_contract import BODIES

OUT=ROOT/'experiments/vtuber-v4-context-r1';PROTOCOL=ROOT/'research/vtuber-v4-context-study/protocol.json'
DATA=ROOT/'datasets/vtuber-v4-intent-v1'

def initialization_hash(model):
    digest=hashlib.sha256()
    for name,value in sorted(model.state_dict().items()):
        digest.update(name.encode());digest.update(value.detach().cpu().contiguous().view(torch.uint8).numpy().tobytes())
    return digest.hexdigest()

@torch.inference_mode()
def predict(model,rows,features):
    model.eval();chunks=[]
    for start in range(0,len(rows),32):chunks.append({k:v.cpu().float() for k,v in model(*adapter_input(rows[start:start+32],features)).items()})
    return {k:torch.cat([o[k] for o in chunks]) for k in chunks[0]}

def contrast_metrics(rows,pred):
    """Only authored same-family, same-text contrasts across different stories.

    Identical actions can be appropriate in both contexts when accepted sets overlap.
    No assumption that every different context requires a different body type.
    """
    groups={}
    for i,r in enumerate(rows):groups.setdefault((r['family'],r['text']),[]).append(i)
    pairs=[]
    for (family,text),indices in groups.items():
        for offset,i in enumerate(indices):
            for j in indices[offset+1:]:
                if rows[i]['scene_id']==rows[j]['scene_id']:continue
                a,b=rows[i]['body_annotation'],rows[j]['body_annotation']
                if set(a['acceptable'])==set(b['acceptable']):continue
                good_a=BODIES[int(pred[i])] in a['acceptable'];good_b=BODIES[int(pred[j])] in b['acceptable']
                pairs.append(dict(family=family,text=text,a=rows[i]['id'],b=rows[j]['id'],both_acceptable=good_a and good_b,
                    disjoint_sets=set(a['acceptable']).isdisjoint(b['acceptable']),pred_a=BODIES[int(pred[i])],pred_b=BODIES[int(pred[j])]))
    family_values={}
    for p in pairs:family_values.setdefault(p['family'],[]).append(p['both_acceptable'])
    return dict(pairs=len(pairs),families=len(family_values),both_acceptable=sum(p['both_acceptable'] for p in pairs)/len(pairs) if pairs else None,
                family_mean=float(np.mean([np.mean(v) for v in family_values.values()])) if pairs else None,details=pairs)

def direct_results(rows,records):
    selected=[records[r['id']] for r in rows];valid=torch.tensor([v['valid'] for v in selected])
    pred=torch.tensor([BODIES.index(v['parsed']['body']) if v['valid'] else 0 for v in selected])
    amplitude=torch.tensor([v['parsed']['strength'] if v['valid'] else 0. for v in selected])
    accepted=labels(rows)['acceptable'].gather(1,pred[:,None])[:,0];required=labels(rows)['necessity']==2
    necessity=[v['parsed']['necessity'] if v['valid'] else None for v in selected]
    times=[v['generation_ms'] for v in selected]
    return dict(metrics=metrics(rows,pred,amplitude),contract_valid_rate=float(valid.float().mean()),
                contract_and_acceptable=float((valid&accepted).float().mean()),
                contract_and_required_success=float((valid&accepted)[required].float().mean()),
                necessity_accuracy=sum(n==r['body_annotation']['necessity'] for n,r in zip(necessity,rows))/len(rows),
                invalid=sum(not v['valid'] for v in selected),max_tokens_reached=sum(v['max_tokens_reached'] for v in selected),
                generation_ms=dict(p50=float(np.percentile(times,50)),p95=float(np.percentile(times,95))),
                timing_scope='isolated local generation, no TTS; not end-to-end acceptance',contrasts=contrast_metrics(rows,pred)),dict(pred=pred,amplitude=amplitude)

def main():
    if (OUT/'results.json').exists():raise RuntimeError('Completed research is immutable')
    torch.set_num_threads(3);protocol=json.loads(PROTOCOL.read_text());old_protocol=json.loads((ROOT/'research/vtuber-v4-intent-study/protocol.json').read_text())
    assert sha(DATA/'manifest.json')==protocol['dataset_sha256'];meta=json.loads((OUT/'cache.json').read_text())
    assert meta['fingerprint']['protocol_sha256']==sha(PROTOCOL) and meta['fingerprint']['prompt_sha256']==sha(ROOT/'latent/context_prompts.py')
    rows=read_dataset(DATA);train=[r for r in rows if r['split']=='train'];target=labels(train)
    dev=[r for r in rows if r['split']=='development' and r['history_variant']=='canonical']
    cal=[r for r in rows if r['split']=='calibration' and r['history_variant']=='canonical']
    dev_all=[r for r in rows if r['split']=='development'];saved=torch.load(ROOT/protocol['base'],map_location='cpu',weights_only=True)
    assert sha(ROOT/protocol['base'])==protocol['base_sha256']
    runs={mode:[] for mode in MODES};entries=[];initial_hashes={}
    for mode in MODES:
        cache_info=meta['modes'][mode];path=ROOT/cache_info['path'];assert sha(path)==cache_info['sha256']
        cache=torch.load(path,map_location='cpu',weights_only=True);features={k:v.cuda() for k,v in cache['features'].items()}
        for seed in protocol['seeds']:
            torch.manual_seed(seed);generator=torch.Generator().manual_seed(seed)
            model=BodyAdapter(saved).cuda();initial=initialization_hash(model)
            if seed in initial_hashes:assert initial==initial_hashes[seed],'Input modes must have identical initial model weights'
            initial_hashes[seed]=initial;recipe=protocol['optimizer']
            groups=[dict(params=[p for p in model.shared.parameters() if p.requires_grad],lr=recipe['body_adapter_lr']),dict(params=model.head.parameters(),lr=recipe['head_lr'])]
            optimizer=torch.optim.AdamW(groups,weight_decay=recipe['weight_decay']);trace=[];begin=time.perf_counter()
            for step in range(recipe['steps']):
                model.train();idx=torch.randint(len(train),(recipe['batch_size'],),generator=generator).tolist()
                rr=[train[i] for i in idx];output=model(*adapter_input(rr,features));y={k:v[idx].cuda() for k,v in target.items()}
                cost=type_strength_loss(output,y,'acceptable')+F.cross_entropy(output['necessity'],y['necessity'])
                optimizer.zero_grad();cost.backward();torch.nn.utils.clip_grad_norm_(model.parameters(),2.);optimizer.step()
                if (step+1)%200==0:trace.append(dict(step=step+1,loss=float(cost.detach())))
            calibration=predict(model,cal,features);calibrated=calibrate(calibration,cal,'necessity',old_protocol);config=calibrated['config']
            output=predict(model,dev,features);pred,amp=decide(output['logits'],output['strength'],necessity=output['necessity'],**config)
            raw,raw_amp=decide(output['logits'],output['strength']);all_output=predict(model,dev_all,features)
            all_pred,all_amp=decide(all_output['logits'],all_output['strength'],necessity=all_output['necessity'],**config)
            tr=[r for r in train if r['history_variant']=='canonical'];train_output=predict(model,tr,features)
            train_pred,train_amp=decide(train_output['logits'],train_output['strength'],necessity=train_output['necessity'],**config)
            entry=dict(mode=mode,seed=seed,initial_sha256=initial,calibrated=calibrated,development=metrics(dev,pred,amp),
                       development_raw=metrics(dev,raw,raw_amp),development_all_histories=metrics(dev_all,all_pred,all_amp),
                       train=metrics(tr,train_pred,train_amp),contrasts=contrast_metrics(dev,pred),trace=trace,
                       necessity_development_before=necessity_metrics(output['necessity'],dev),
                       necessity_development_after=necessity_metrics(output['necessity'],dev,config['temperature']),
                       elapsed_s=round(time.perf_counter()-begin,2))
            path=OUT/f'{mode}-{seed}.pt';torch.save(dict(state_dict=model.state_dict(),config=config,mode=mode,
                initial_sha256=initial,protocol_sha256=sha(PROTOCOL),dataset_sha256=protocol['dataset_sha256']),path)
            entry['checkpoint_sha256']=sha(path);entries.append(entry);runs[mode].append(dict(pred=pred,amplitude=amp))
            write(OUT/f'{mode}-{seed}-decisions.json',[dict(id=r['id'],body=BODIES[int(p)],strength=float(a),
                  necessity_probabilities=intent.tolist()) for r,p,a,intent in zip(dev,pred,amp,(output['necessity']/config['temperature']).softmax(-1))])
            print(json.dumps(dict(mode=mode,seed=seed,development=entry['development'])),flush=True)
            del model,optimizer;torch.cuda.empty_cache()
        del features,cache;torch.cuda.empty_cache()
    summary={}
    for mode,rr in runs.items():
        mm=[metrics(dev,r['pred'],r['amplitude']) for r in rr]
        summary[mode]=dict(seeds=len(rr),metrics={k:mean_std([m[k] for m in mm]) for k in RATE_KEYS},family_bootstrap_95=family_intervals(dev,rr))
    generation=json.loads((OUT/'direct-generation.json').read_text());assert generation['fingerprint']==meta['fingerprint']
    direct,direct_run=direct_results(dev,generation['records']);direct_cal,_=direct_results(cal,generation['records'])
    direct['family_bootstrap_95']=family_intervals(dev,[direct_run])
    write(OUT/'results.json',dict(schema='context-study.v1',status='development_only',promoted=False,
        dataset_sha256=sha(DATA/'manifest.json'),protocol_sha256=sha(PROTOCOL),input_audit_sha256=sha(OUT/'input-audit.json'),
        prompt_sha256=sha(ROOT/'latent/context_prompts.py'),matched_initializations=initial_hashes,runs=entries,summary=summary,
        context_minus_legacy_family_95=paired_intervals(dev,runs['context_first'],runs['legacy_json']),
        task_minus_legacy_family_95=paired_intervals(dev,runs['task_context_first'],runs['legacy_json']),
        direct_development=direct,direct_calibration=direct_cal,old_test_loaded=False,new_final_test_created=False,
        caveats=['Same 18-family development set already inspected in prior study','Draft labels, not human gold',
                 'Task mode adds explicit task information; only legacy vs context_first isolates ordering',
                 'Direct generation omits the numerical history vector and is a diagnostic, not a matched architecture ablation',
                 'Isolated timing excludes concurrent TTS and runtime integration','No visual, stability or human-preference acceptance']))
    print(json.dumps(dict(complete=True,output=str(OUT/'results.json'))),flush=True)
if __name__=='__main__':main()
