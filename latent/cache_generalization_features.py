"""Cache full frozen token states for TRAIN/DEVELOPMENT ONLY, resumably."""
import argparse
import gc
import hashlib
import json
import time
from pathlib import Path
import numpy as np
import torch
from common import ROOT,sha
from semantic_tokens import FrozenTokenEncoder
from generalization_data import read_rows,key

def main():
    p=argparse.ArgumentParser();p.add_argument('--source',type=Path,required=True);p.add_argument('--dataset',type=Path,default=ROOT/'datasets/vtuber-v4-generalization-v1');p.add_argument('--output',type=Path,required=True);args=p.parse_args()
    torch.set_num_threads(3);args.output.mkdir(parents=True,exist_ok=True)
    manifest=json.loads((args.dataset/'manifest.json').read_text(encoding='utf-8'))
    for split in ['train','validation']:assert sha(args.dataset/f'{split}.jsonl')==manifest['splits'][split]['sha256']
    rows=read_rows(args.dataset,'train')+read_rows(args.dataset,'validation');pairs={key(r):(r['text'],r['context']) for r in rows}
    fingerprint={'encoder_source_sha256':sha(args.source),'dataset_manifest_sha256':sha(args.dataset/'manifest.json'),'splits':['train','validation']}
    path=args.output/'tokens.pt';meta=args.output/'cache.json';features={};timings=[]
    if path.exists():
        saved=torch.load(path,map_location='cpu',weights_only=True);assert saved['fingerprint']==fingerprint;features=saved['features'];timings=saved['timings']
    missing=[k for k in sorted(pairs) if k not in features]
    if not missing:
        if meta.exists():
            existing=json.loads(meta.read_text());assert existing['tokens_sha256']==sha(path)
        else:
            # Recovery after the final tensor checkpoint but before metadata.
            source=json.loads(args.source.read_text(encoding='utf-8'))
            summary={**fingerprint,'repo':source['repo_id'],'revision':source['revision'],
                'hidden_dim':next(iter(features.values())).shape[-1],'pairs':len(features),'tokens_sha256':sha(path),'test_encoded':False,
                'encoder_ms':{'p50':float(np.percentile([r['encoder_ms'] for r in timings],50)),'p95':float(np.percentile([r['encoder_ms'] for r in timings],95))},
                'token_lengths':{'min':min(len(h) for h in features.values()),'max':max(len(h) for h in features.values())},
                'timing_scope':'single isolated encoder, one warmup excluded; not concurrent TTS benchmark','metadata_recovered_from_complete_cache':True}
            meta.write_text(json.dumps(summary,indent=2)+'\n',encoding='utf-8')
        print(json.dumps({'stage':'cache_ready','pairs':len(features)}));return
    encoder=FrozenTokenEncoder(args.source);started=time.perf_counter()
    encoder.encode('你好。','普通聊天。')
    for i,k in enumerate(missing):
        h,info=encoder.encode(*pairs[k]);features[k]=h.to(device='cpu',dtype=torch.bfloat16);timings.append(info)
        if (i+1)%128==0 or i+1==len(missing):
            temporary=path.with_suffix('.tmp');torch.save({'fingerprint':fingerprint,'features':features,'timings':timings},temporary);temporary.replace(path)
            print(json.dumps({'stage':'encode','completed':len(features),'total':len(pairs),'elapsed_s':round(time.perf_counter()-started,1)}),flush=True)
    summary={**fingerprint,'repo':encoder.source['repo_id'],'revision':encoder.source['revision'],'hidden_dim':encoder.hidden_size,
        'pairs':len(features),'tokens_sha256':sha(path),'test_encoded':False,'encoder_ms':{'p50':float(np.percentile([r['encoder_ms'] for r in timings],50)),'p95':float(np.percentile([r['encoder_ms'] for r in timings],95))},
        'token_lengths':{'min':min(len(h) for h in features.values()),'max':max(len(h) for h in features.values())},'timing_scope':'single isolated encoder, one warmup excluded; not concurrent TTS benchmark'}
    meta.write_text(json.dumps(summary,indent=2)+'\n',encoding='utf-8');print(json.dumps({'stage':'cache_ready',**summary}),flush=True)

if __name__=='__main__':main()
