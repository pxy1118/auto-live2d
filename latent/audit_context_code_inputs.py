"""Assert code readout has complete input and unambiguous one-token labels."""
import json
from transformers import AutoTokenizer
from common import ROOT,sha
from cache_intent_features import read_dataset
from context_code import LETTERS,code_messages
from run_intent_study import write

def main():
    tokenizer=AutoTokenizer.from_pretrained(ROOT/'models/Qwen3.5-4B',local_files_only=True)
    rows=[r for r in read_dataset(ROOT/'datasets/vtuber-v4-intent-v1') if r['split'] in ['development','calibration'] and r['history_variant']=='canonical']
    counts=[]
    for seed in [7137,1741,9283]:
        for row in rows:
            mm=code_messages(row['text'],row['context'],seed)
            prompt=tokenizer.apply_chat_template(mm,tokenize=False,add_generation_prompt=True,enable_thinking=False)
            ids=tokenizer(prompt,add_special_tokens=False)['input_ids'];assert tokenizer.decode(ids,skip_special_tokens=False)==prompt
            payload=json.loads(mm[-1]['content']);assert payload['text']==row['text'] and payload['context']==row['context']
            counts.append(len(ids))
    labels=[tokenizer.encode(c,add_special_tokens=False) for c in LETTERS]
    result=dict(prompts=len(counts),min_tokens=min(counts),max_tokens=max(counts),limit=512,roundtrip_failures=0,
                label_token_ids=labels,prompt_sha256=sha(ROOT/'latent/context_code.py'))
    print(json.dumps(result),flush=True)
    assert max(counts)<=512,'Do not truncate'
    assert all(len(v)==1 for v in labels) and len({v[0] for v in labels})==14
    write(ROOT/'experiments/vtuber-v4-context-code-r1/input-audit.json',result)
if __name__=='__main__':main()
