import argparse
import json
from pathlib import Path
import statistics
import time
import numpy as np
import torch
from common import ROOT,CHANNELS,write,read
from data import prepare
from runtime import LatentPolicy
from plot_run import plot_run

parser=argparse.ArgumentParser();parser.add_argument('--experiment',default=read(ROOT/'latent/default-run.json')['path']);args=parser.parse_args()
folder=Path(args.experiment)
run=read(folder/'run.json')
if run.get('supervision')=='program_authored_assistant_reviewed':
    from evaluate_reviewed import main
    main(folder.resolve(),ROOT/run['dataset_path'])
    raise SystemExit(0)
policy=LatentPolicy(folder)
rows,manifest,targets=prepare(ROOT/'datasets/pilot-v1')
selections=[]
for label in ['nod','shake_head','look_left','point_index','hand_chest','smile']:
    selections.append(next(r for r in rows if r['annotation']['primary_action']==label))
report={'schema':'latent_evaluation.v1','supervision':'program_authored_unreviewed','held_out_evaluation':False,'dataset_sha256':manifest['sha256'],'cases':[]}
outputs={}
for kind in ['regression','flow']:
    for row in selections:
        a=row['annotation']; result=policy.predict(a['utterance'],a.get('context',''),a.get('style','natural'),kind=kind)
        timings=[]
        for repeat in range(5):
            measured=policy.predict(a['utterance'],a.get('context',''),a.get('style','natural'),kind=kind)
            timings.append(measured['timing'])
        result['timing_median']={key:statistics.median(t[key] for t in timings) for key in ['encoder_ms','head_ms','total_compute_ms']}
        result['text']=a['utterance'];result['context']=a.get('context','');result['style']=a.get('style','natural');result['sample_id']=row['id'];result['source_action_label']=a['primary_action']
        key=kind+'-'+a['primary_action'];outputs[key]=result
        report['cases'].append({'key':key,'sample_id':row['id'],'text':a['utterance'],'timing':result['timing_median'],'constraints':result['constraints']})
    print(json.dumps({'evaluated':kind}),flush=True)
write(folder/'predictions.json',outputs);write(folder/'evaluation.json',report)
plot_run(folder, rows, targets, outputs)
print(json.dumps({'ok':True,'report':str(folder/'evaluation.json'),'claim':'seen program-supervision examples, not held-out language quality'}))
