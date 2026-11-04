"""Full frozen tokens for the independently adapted body branch, not a new split."""
import json
import hashlib
import time
from pathlib import Path
import torch
from common import ROOT,sha
from semantic_tokens import FrozenTokenEncoder
from cache_intent_features import read_dataset

def key(row):return json.dumps([row['text'],row['context']],ensure_ascii=False,separators=(',',':'))

def main():
    torch.set_num_threads(3);out=ROOT/'experiments/vtuber-v4-intent-r2';out.mkdir(parents=True,exist_ok=True)
    data=ROOT/'datasets/vtuber-v4-intent-v1';protocol=ROOT/'research/vtuber-v4-intent-study/adapter-protocol.json'
    source=ROOT/'latent/encoders/qwen3.5-4b.json'
    fingerprint=dict(dataset_sha256=sha(data/'manifest.json'),protocol_sha256=sha(protocol),encoder_source_sha256=sha(source),extractor_sha256=sha(Path(__file__)))
    pairs={key(r):(r['text'],r['context']) for r in read_dataset(data)};path=out/'tokens.pt'
    features={};timings=[]
    if path.exists():
        saved=torch.load(path,map_location='cpu',weights_only=True);assert saved['fingerprint']==fingerprint
        features=saved['features'];timings=saved['timings']
    missing=[k for k in sorted(pairs) if k not in features]
    if missing:
        encoder=FrozenTokenEncoder(source);encoder.encode('你好。','普通聊天。');begin=time.perf_counter()
        for i,k in enumerate(missing):
            h,info=encoder.encode(*pairs[k]);features[k]=h.cpu().to(torch.bfloat16);timings.append(info)
            if (i+1)%50==0 or i+1==len(missing):
                tmp=path.with_suffix('.tmp');torch.save(dict(fingerprint=fingerprint,features=features,timings=timings),tmp);tmp.replace(path)
                print(json.dumps(dict(stage='cache_full_tokens',pairs=len(features),total=len(pairs),elapsed_s=round(time.perf_counter()-begin,1))),flush=True)
    meta=dict(fingerprint=fingerprint,cache_sha256=sha(path),pairs=len(features),old_test_loaded=False,
              timing_scope='isolated backbone cache; excludes runtime TTS')
    (out/'cache.json').write_text(json.dumps(meta,indent=2)+'\n',encoding='utf-8');print(json.dumps(meta),flush=True)
if __name__=='__main__':main()
