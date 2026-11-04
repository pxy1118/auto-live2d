"""Token preservation and causal field-order audit; tokenizer only, no test data."""
import json
from pathlib import Path
import torch
from transformers import AutoTokenizer
from common import ROOT,sha
from cache_intent_features import read_dataset
from cache_intent_tokens import key
from context_prompts import MODES,prompt,messages

def main():
    out=ROOT/'experiments/vtuber-v4-context-r1';out.mkdir(parents=True,exist_ok=True)
    data=ROOT/'datasets/vtuber-v4-intent-v1';protocol=ROOT/'research/vtuber-v4-context-study/protocol.json'
    assert sha(data/'manifest.json')==json.loads(protocol.read_text())['dataset_sha256']
    tokenizer=AutoTokenizer.from_pretrained(ROOT/'models/Qwen3.5-4B',local_files_only=True)
    rows=read_dataset(data);unique={key(r):r for r in rows};legacy_folder=ROOT/'experiments/vtuber-v4-intent-r2'
    legacy_meta=json.loads((legacy_folder/'cache.json').read_text());assert sha(legacy_folder/'tokens.pt')==legacy_meta['cache_sha256']
    legacy=torch.load(legacy_folder/'tokens.pt',map_location='cpu',weights_only=True)['features'];checks=[]
    for k,r in unique.items():
        item=dict(input_key=k,modes={})
        for mode in MODES:
            text=prompt(tokenizer,r['text'],r['context'],mode)
            ids=tokenizer(text,add_special_tokens=False)['input_ids'];decoded=tokenizer.decode(ids,skip_special_tokens=False,clean_up_tokenization_spaces=False)
            assert decoded==text,'Tokenization round trip changed content'
            assert len(ids)<=512,'No silent input truncation permitted'
            content=messages(r['text'],r['context'],mode)[-1]['content'];restored=json.loads(content)
            assert restored['text']==r['text'] and restored['context']==r['context']
            text_pos=text.index('"text":');context_pos=text.index('"context":')
            item['modes'][mode]=dict(tokens=len(ids),context_before_text=context_pos<text_pos,complete_roundtrip=True)
            if mode=='legacy_json':
                assert ids==tokenizer(text)['input_ids'],'Legacy tokenizer adds extra tokens'
                assert len(ids)==len(legacy[k]),'Cached token sequence length mismatch'
        checks.append(item)
    result=dict(schema='context-input-audit.v1',pairs=len(unique),checks=checks,old_test_loaded=False,
        dataset_sha256=sha(data/'manifest.json'),source_sha256=sha(ROOT/'latent/context_prompts.py'),
        summary={mode:dict(min_tokens=min(c['modes'][mode]['tokens'] for c in checks),max_tokens=max(c['modes'][mode]['tokens'] for c in checks),
                           roundtrip_failures=0,context_before_text_pairs=sum(c['modes'][mode]['context_before_text'] for c in checks)) for mode in MODES},
        interpretation='Original text tokens precede context and cannot causally see it. Later context/assistant tokens can see the text; this ordering alone does not prove a bug.')
    (out/'input-audit.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');print(json.dumps(result['summary']))
if __name__=='__main__':main()
