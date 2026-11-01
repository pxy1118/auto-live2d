import argparse
import json
from pathlib import Path
import statistics
import time
import numpy as np
import torch
from common import ROOT,CHANNELS,write,sha
from data import prepare
from runtime import LatentPolicy

parser=argparse.ArgumentParser();parser.add_argument('--experiment',default='experiments/latent-pilot-v1');args=parser.parse_args()
folder=Path(args.experiment); policy=LatentPolicy(folder)
rows,manifest,targets=prepare(ROOT/'datasets/pilot-v1')
selections=[]
for label in ['nod','shake_head','look_left','point_index','hand_chest','smile']:
    selections.append(next(r for r in rows if r['annotation']['primary_action']==label))
report={'schema':'latent_evaluation.v1','supervision':'program_authored_unreviewed','held_out_evaluation':False,'dataset_sha256':manifest['sha256'],'cases':[]}
outputs={}
for kind in ['regression','flow']:
    for row in selections:
        a=row['annotation']; result=policy.predict(a['utterance'],a.get('context',''),kind=kind)
        timings=[]
        for repeat in range(5):
            measured=policy.predict(a['utterance'],a.get('context',''),kind=kind)
            timings.append(measured['timing'])
        result['timing_median']={key:statistics.median(t[key] for t in timings) for key in ['encoder_ms','head_ms','total_compute_ms']}
        result['text']=a['utterance'];result['sample_id']=row['id'];result['source_action_label']=a['primary_action']
        key=kind+'-'+a['primary_action'];outputs[key]=result
        report['cases'].append({'key':key,'sample_id':row['id'],'text':a['utterance'],'timing':result['timing_median'],'constraints':result['constraints']})
    print(json.dumps({'evaluated':kind}),flush=True)
write(folder/'predictions.json',outputs);write(folder/'evaluation.json',report)
# Render trajectory diagnostics using the same normalized time grid as training.
import matplotlib;matplotlib.use('Agg')
import matplotlib.pyplot as plt
fig,axes=plt.subplots(3,2,figsize=(10,8),layout='constrained')
time=np.arange(64)/10
lo=np.array([c['min'] for c in CHANNELS]);hi=np.array([c['max'] for c in CHANNELS])
for ax,row,axis in zip(axes.flat,selections,[1,0,0,7,7,9]):
    index=next(i for i,r in enumerate(rows) if r['id']==row['id'])
    truth=(targets['actions'][index,:,axis]+1)/2*(hi[axis]-lo[axis])+lo[axis]
    ax.plot(time,truth,'k--',label='Program supervision',lw=1.3)
    for kind,color in [('regression','#3679a8'),('flow','#d18b39')]:
        ax.plot(time,np.array(outputs[kind+'-'+row['annotation']['primary_action']]['values'])[:,axis],color=color,label=kind,lw=1.2)
    ax.set_title(row['annotation']['primary_action']+' / '+CHANNELS[axis]['id'],fontsize=10);ax.set_xlabel('Time (s)');ax.grid(alpha=.2)
axes.flat[0].legend(fontsize=8);fig.suptitle('Training samples only: predicted primary-control trajectories',fontsize=12)
fig.savefig(folder/'trajectories.png',dpi=160);plt.close(fig)
print(json.dumps({'ok':True,'report':str(folder/'evaluation.json'),'claim':'seen program-supervision examples, not held-out language quality'}))
