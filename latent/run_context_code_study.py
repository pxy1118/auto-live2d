"""One-prefill decision diagnostic. Saves raw logits, all mappings and failures."""
import json
import time
from pathlib import Path
import torch
import numpy as np
from common import ROOT,sha
from semantic_tokens import FrozenTokenEncoder
from cache_intent_features import read_dataset
from context_code import LETTERS,CLASSES,code_messages,semantic_order,marginals,editorial_strength
from planner_contract import BODIES
from intent_study import decide,metrics
from run_intent_study import write,calibrate,family_intervals,mean_std,RATE_KEYS
from run_context_study import contrast_metrics

OUT=ROOT/'experiments/vtuber-v4-context-code-r1';PROTOCOL=ROOT/'research/vtuber-v4-context-study/code-protocol.json'

def main():
    OUT.mkdir(parents=True,exist_ok=True)
    if (OUT/'results.json').exists():raise RuntimeError('Completed code study is immutable')
    torch.set_num_threads(3);protocol=json.loads(PROTOCOL.read_text());data=ROOT/'datasets/vtuber-v4-intent-v1';source=ROOT/'latent/encoders/qwen3.5-4b.json'
    fingerprint=dict(dataset_sha256=sha(data/'manifest.json'),protocol_sha256=sha(PROTOCOL),prompt_sha256=sha(ROOT/'latent/context_code.py'),
                     source_sha256=sha(source),implementation_sha256=sha(Path(__file__)))
    all_rows=read_dataset(data);rows=[r for r in all_rows if r['split'] in ['development','calibration'] and r['history_variant']=='canonical']
    raw_path=OUT/'readouts.json';records={};warmups=[]
    if raw_path.exists():
        saved=json.loads(raw_path.read_text());assert saved['fingerprint']==fingerprint;records=saved['records'];warmups=saved['warmups']
    todo=[(seed,r) for seed in protocol['permutations'] for r in rows if f"{seed}/{r['id']}" not in records]
    if todo:
        encoder=FrozenTokenEncoder(source);encoder.wrapper.to('cuda').eval();encoder.wrapper.requires_grad_(False)
        token_ids=[encoder.tokenizer.encode(c,add_special_tokens=False) for c in LETTERS]
        assert all(len(t)==1 for t in token_ids) and len(set(t[0] for t in token_ids))==14
        ids=torch.tensor([t[0] for t in token_ids],device='cuda');begin_all=time.perf_counter()
        @torch.inference_mode()
        def readout(row,seed):
            text=encoder.tokenizer.apply_chat_template(code_messages(row['text'],row['context'],seed),tokenize=False,add_generation_prompt=True,enable_thinking=False)
            x=encoder.tokenizer(text,return_tensors='pt',add_special_tokens=False).to('cuda');assert x.input_ids.shape[1]<=512
            torch.cuda.synchronize();begin=time.perf_counter()
            h=encoder.backbone(**x,use_cache=False,return_dict=True).last_hidden_state[:,-1]
            logits=encoder.wrapper.lm_head(h)[0].float();restricted=logits[ids];prob=restricted.softmax(-1)
            all_log_z=logits.logsumexp(-1);mass=float((restricted.logsumexp(-1)-all_log_z).exp())
            torch.cuda.synchronize();elapsed=(time.perf_counter()-begin)*1000
            top=int(logits.argmax());return dict(semantic_probabilities=semantic_order(prob.cpu().tolist(),seed),letter_logits=restricted.cpu().tolist(),
                allowed_probability_mass=mass,unconstrained_top_token=encoder.tokenizer.decode([top]),
                unconstrained_top_is_allowed=top in ids.tolist(),tokens=int(x.input_ids.shape[1]),prefill_ms=elapsed)
        if not warmups:
            for seed in protocol['permutations']:warmups.append(readout(dict(text='资料已经保存。',context='双方核对普通资料保存情况。'),seed))
        for i,(seed,row) in enumerate(todo):
            records[f"{seed}/{row['id']}"]=dict(split=row['split'],**readout(row,seed))
            if (i+1)%30==0 or i+1==len(todo):
                write(raw_path,dict(fingerprint=fingerprint,records=records,warmups=warmups,old_test_loaded=False))
                print(json.dumps(dict(stage='code_readout',completed=len(records),total=360,elapsed_s=round(time.perf_counter()-begin_all,1))),flush=True)
    dev=[r for r in rows if r['split']=='development'];cal=[r for r in rows if r['split']=='calibration']
    old_protocol=json.loads((ROOT/'research/vtuber-v4-intent-study/protocol.json').read_text());runs=[];decisions={};ensembles={}
    for name,seeds in [(str(s),[s]) for s in protocol['permutations']]+[('ensemble',protocol['permutations'])]:
        def probabilities(rr):return torch.tensor([[records[f"{s}/{r['id']}"]['semantic_probabilities'] for s in seeds] for r in rr]).mean(1)
        cc=marginals(probabilities(cal));calibrated=calibrate(cc,cal,'necessity',old_protocol);config=calibrated['config']
        pp=probabilities(dev);output=marginals(pp);pred,_=decide(output['logits'],output['strength'],necessity=output['necessity'],**config)
        amp=editorial_strength(pred,output['necessity'])
        # Raw is the actual constrained winning combination, not marginal argmax.
        raw_idx=pp.argmax(-1);raw_pred=torch.tensor([BODIES.index(CLASSES[int(i)][1]) for i in raw_idx]);raw_amp=editorial_strength(raw_pred,output['necessity'])
        times=[sum(records[f"{s}/{r['id']}"]['prefill_ms'] for s in seeds) for r in dev]
        masses=[records[f"{s}/{r['id']}"]['allowed_probability_mass'] for r in dev for s in seeds]
        metric=metrics(dev,pred,amp)
        entry=dict(mapping=name,calibrated=calibrated,development=metric,raw_development=metrics(dev,raw_pred,raw_amp),
                   family_bootstrap_95=family_intervals(dev,[dict(pred=pred,amplitude=amp)]),contrasts=contrast_metrics(dev,pred),
                   prefill_ms=dict(p50=float(np.percentile(times,50)),p95=float(np.percentile(times,95))),
                   allowed_mass=dict(mean=float(np.mean(masses)),min=min(masses)),
                   unconstrained_code_top_fraction=sum(records[f"{s}/{r['id']}"]['unconstrained_top_is_allowed'] for r in dev for s in seeds)/(len(dev)*len(seeds)))
        runs.append(entry);ensembles[name]=dict(pred=pred,amplitude=amp)
        decisions[name]=[dict(id=r['id'],body=BODIES[int(p)],strength=float(a),class_probabilities=prob.tolist()) for r,p,a,prob in zip(dev,pred,amp,pp)]
    summary=dict(metrics={k:mean_std([r['development'][k] for r in runs if r['mapping']!='ensemble']) for k in RATE_KEYS},
                 family_bootstrap_95=family_intervals(dev,[ensembles[str(s)] for s in protocol['permutations']]))
    write(OUT/'decisions.json',decisions)
    write(OUT/'results.json',dict(schema='context-code-results.v1',status='adaptive_development_only',promoted=False,
        fingerprint=fingerprint,runs=runs,summary=summary,old_test_loaded=False,new_final_test_created=False,
        strength_source='unlearned editorial defaults; do not compare to learned-strength quality or actual rendering',
        timing_scope='isolated prefill; ensemble is sequential sum of three calls, not a TTS or end-to-end benchmark',
        caveats=['New stronger quiet policy differs from JSON prompt','Restricted decoder guarantees formatting only',
                 'Three label permutations are prompt variants, not independent data or training seeds','Same inspected small draft development set']))
    print(json.dumps(dict(complete=True,results=[dict(mapping=r['mapping'],development=r['development'],latency=r['prefill_ms']) for r in runs])),flush=True)
if __name__=='__main__':main()
