"""Descriptive train/dev diagnostics, no fitting, no sealed-test access."""
import json
from pathlib import Path
import torch
from common import ROOT
from cache_intent_features import read_dataset
from intent_study import BodyProbe,decide,metrics,necessity_metrics
from run_intent_study import tensor_input,write

def main():
    torch.set_num_threads(3);out=ROOT/'experiments/vtuber-v4-intent-r1'
    records=torch.load(out/'features/body-features.pt',map_location='cpu',weights_only=True)['records']
    rows=read_dataset(ROOT/'datasets/vtuber-v4-intent-v1');result=[]
    for seed in [7137,1741,9283]:
        for method in ['preferred','acceptable','necessity']:
            saved=torch.load(out/f'{method}-{seed}.pt',map_location='cpu',weights_only=True)
            model=BodyProbe();model.load_state_dict(saved['state_dict']);model.eval();entry=dict(seed=seed,method=method,splits={})
            for split in ['train','development','calibration']:
                rr=[r for r in rows if r['split']==split and r['history_variant']=='canonical']
                with torch.inference_mode():output=model(*tensor_input(rr,records))
                raw,amp=decide(output['logits'],output['strength'],0.)
                gated,gated_amp=decide(output['logits'],output['strength'],necessity=output['necessity'] if method=='necessity' else None,**saved['config'])
                entry['splits'][split]=dict(raw=metrics(rr,raw,amp),calibrated=metrics(rr,gated,gated_amp),
                    necessity=necessity_metrics(output['necessity'],rr,saved['config'].get('temperature',1.)) if method=='necessity' else None)
            result.append(entry)
    write(out/'diagnostics.json',dict(scope='Descriptive, no tuning; train/dev/calibration only',runs=result))
    for e in result:
        if e['seed']==7137:print(json.dumps(e))
if __name__=='__main__':main()
