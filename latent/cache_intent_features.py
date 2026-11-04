"""Frozen-body representation cache for a development-only necessity study."""
import argparse
import collections
import hashlib
import json
import time
from pathlib import Path
import torch
from common import ROOT,sha
from semantic_tokens import FrozenTokenEncoder,TokenPerformancePlanner

SPLITS=['train','development','calibration']

def read_dataset(folder):
    manifest=json.loads((folder/'manifest.json').read_text(encoding='utf-8'));rows=[]
    for split in SPLITS:
        assert sha(folder/f'{split}.jsonl')==manifest['files'][f'{split}.jsonl']
        rows.extend(json.loads(line) for line in (folder/f'{split}.jsonl').read_text(encoding='utf-8').splitlines())
    assert not manifest['old_final_test_loaded'] and not manifest['final_test_created']
    return rows

@torch.inference_mode()
def project(model,h,rows,device):
    tokens=h.float()[None].expand(len(rows),-1,-1)
    state=torch.tensor([r['state_vector'] for r in rows],device=device)
    memory=model.projection(tokens)
    query=model.query[None]+model.history(state)[:,None]
    attended,_=model.attention(query,memory,memory,need_weights=False)
    hidden=model.mix(query+attended);pooled=hidden.mean(1)
    logits=model.heads['body'](hidden[:,1]);strength=model.regression(pooled).sigmoid()[:,0]
    # Check the intermediate features exactly reconstruct the frozen public head.
    direct=model(tokens,torch.zeros(tokens.shape[:2],device=device,dtype=torch.bool),state)
    assert torch.allclose(logits,direct['body'],atol=2e-5,rtol=2e-5)
    return {r['id']:dict(body_h=hidden[i,1].cpu(),pooled_h=pooled[i].cpu(),body_logits=logits[i].cpu(),
                        body_strength=strength[i].cpu()) for i,r in enumerate(rows)}

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--dataset',type=Path,default=ROOT/'datasets/vtuber-v4-intent-v1')
    parser.add_argument('--output',type=Path,default=ROOT/'experiments/vtuber-v4-intent-r1/features')
    parser.add_argument('--source',type=Path,default=ROOT/'latent/encoders/qwen3.5-4b.json')
    parser.add_argument('--checkpoint',type=Path,default=ROOT/'experiments/vtuber-v4-generalization-r1/selected-planner.pt')
    args=parser.parse_args();torch.set_num_threads(3);args.output.mkdir(parents=True,exist_ok=True)
    protocol=ROOT/'research/vtuber-v4-intent-study/protocol.json'
    fingerprint=dict(dataset_sha256=sha(args.dataset/'manifest.json'),protocol_sha256=sha(protocol),
                     encoder_source_sha256=sha(args.source),base_sha256=sha(args.checkpoint),extractor_sha256=sha(Path(__file__)))
    assert fingerprint['base_sha256']==json.loads(protocol.read_text())['base_sha256']
    rows=read_dataset(args.dataset);grouped=collections.defaultdict(list)
    for r in rows:grouped[(r['text'],r['context'])].append(r)
    path=args.output/'body-features.pt';records={};timings=[]
    if path.exists():
        saved=torch.load(path,map_location='cpu',weights_only=True);assert saved['fingerprint']==fingerprint
        records=saved['records'];timings=saved['timings']
    missing=[(pair,rr) for pair,rr in sorted(grouped.items()) if rr[0]['id'] not in records]
    if missing:
        saved=torch.load(args.checkpoint,map_location='cpu',weights_only=True)
        model=TokenPerformancePlanner(saved['input_dim'],saved['width']).cuda().eval();model.load_state_dict(saved['state_dict']);model.requires_grad_(False)
        encoder=FrozenTokenEncoder(args.source);encoder.encode('你好。','普通聊天。');started=time.perf_counter()
        for i,((text,context),rr) in enumerate(missing):
            h,info=encoder.encode(text,context)
            info['input_sha256']=hashlib.sha256(json.dumps([text,context],ensure_ascii=False).encode()).hexdigest()
            info['token_states_sha256']=hashlib.sha256(h.cpu().contiguous().view(torch.uint8).numpy().tobytes()).hexdigest()
            records.update(project(model,h,rr,'cuda'));timings.append(info)
            if (i+1)%20==0 or i+1==len(missing):
                tmp=path.with_suffix('.tmp');torch.save(dict(fingerprint=fingerprint,records=records,timings=timings),tmp);tmp.replace(path)
                print(json.dumps(dict(stage='encode',pairs=len(timings),total=len(grouped),elapsed_s=round(time.perf_counter()-started,1))),flush=True)
    assert len(records)==len(rows)
    summary=dict(fingerprint=fingerprint,features_sha256=sha(path),pairs=len(grouped),rows=len(rows),feature_width=128,
                 encoder_and_attention_frozen=True,old_test_loaded=False,new_final_test_created=False,
                 max_tokens=max(t['tokens'] for t in timings),timing_scope='isolated encoder; not runtime or simultaneous TTS latency')
    (args.output/'cache.json').write_text(json.dumps(summary,indent=2)+'\n',encoding='utf-8');print(json.dumps(summary),flush=True)
if __name__=='__main__':main()
