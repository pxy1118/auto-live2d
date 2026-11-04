"""Resumable, predeclared four-way ablation with three matched seeds."""
import json
import subprocess
import sys
from datetime import datetime,timezone
from pathlib import Path
from common import ROOT,sha

OUT=ROOT/'experiments/vtuber-v4-generalization-r1'
def write(p,d):p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

def main():
    OUT.mkdir(exist_ok=True)
    protocol={'schema':'semantic.ablation.v1','created_utc':datetime.now(timezone.utc).isoformat(),
        'dataset':'datasets/vtuber-v4-generalization-v1','dataset_manifest_sha256':sha(ROOT/'datasets/vtuber-v4-generalization-v1/manifest.json'),
        'encoders':{'0.8b':'latent/encoder-source.json','4b':'latent/encoders/qwen3.5-4b.json'},
        'representations':['tail16_mean','full_attention'],'seeds':[7137,1741,9283],'steps':1600,
        'selection':'mean across seeds: 0.65 new-scene macro-F1 + 0.35 all-development macro-F1 - 0.1 false positive rate - 0.1 regression MAE',
        'checkpoint_selection':'same score every 200 steps, development only',
        'execution_gates':{'arm':.85,'grass':.95,'body':.4,'emotion':.7,'eye':.6},
        'scope':'frozen semantic backbone and matched task-query head; representation is one mean token or complete contextual tokens',
        'test_policy':'do not cache, read or evaluate final test until the candidate has been fixed; then one evaluation',
        'promotion_policy':'no automatic promotion; independent functional, concurrent-TTS latency and human preference acceptance required',
        'quality_targets':{'arm_active_recall':.8,'body_active_recall':.75,'emotion_active_recall':.85,'eye_active_recall':.85,'neutral_false_positive_rate':.04}}
    pp=OUT/'protocol.json'
    if pp.exists():
        existing=json.loads(pp.read_text());protocol['created_utc']=existing['created_utc'];assert existing==protocol
    else:write(pp,protocol)
    def run(name,command):
        write(OUT/'progress.json',{'stage':name,'started_utc':datetime.now(timezone.utc).isoformat(),'command':command})
        print(json.dumps({'stage':name,'command':command}),flush=True)
        with (OUT/(name+'.log')).open('a',encoding='utf-8') as log:
            result=subprocess.run([sys.executable,*command],cwd=ROOT,stdout=log,stderr=subprocess.STDOUT)
        if result.returncode:
            write(OUT/'progress.json',{'stage':'failed','failed_step':name,'returncode':result.returncode,'resume':'uv run --project latent python latent/run_generalization_experiment.py'})
            raise SystemExit(result.returncode)
    for encoder,source in protocol['encoders'].items():
        cache=OUT/'features'/encoder
        run('encode-'+encoder,['latent/cache_generalization_features.py','--source',source,'--output',str(cache)])
    for encoder in protocol['encoders']:
        for mode in protocol['representations']:
            for seed in protocol['seeds']:
                name=f'{encoder}-{mode}-s{seed}';folder=OUT/'candidates'/name
                if (folder/'metadata.json').exists():
                    m=json.loads((folder/'metadata.json').read_text());assert m['dataset_manifest_sha256']==protocol['dataset_manifest_sha256'] and m['checkpoint_sha256']==sha(folder/'planner.pt');continue
                run(name,['latent/train_generalization.py','--cache',str(OUT/'features'/encoder),'--output',str(folder),'--mode',mode,'--seed',str(seed),'--steps',str(protocol['steps'])])
    write(OUT/'progress.json',{'stage':'training_complete','candidates':12,'test_evaluated':False})

if __name__=='__main__':main()
