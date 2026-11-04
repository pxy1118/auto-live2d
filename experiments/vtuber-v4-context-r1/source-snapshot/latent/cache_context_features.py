"""Resumable frozen representations and direct decision diagnostic; development only."""
import copy
import hashlib
import json
import time
from pathlib import Path
import torch
from common import ROOT,sha
from semantic_tokens import FrozenTokenEncoder
from cache_intent_features import read_dataset
from cache_intent_tokens import key
from context_prompts import prompt,parse_direct

OUT=ROOT/'experiments/vtuber-v4-context-r1';PROTOCOL=ROOT/'research/vtuber-v4-context-study/protocol.json'

def write(path,data):path.write_text(json.dumps(data,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf-8')

def main():
    torch.set_num_threads(3);OUT.mkdir(parents=True,exist_ok=True)
    data=ROOT/'datasets/vtuber-v4-intent-v1';source=ROOT/'latent/encoders/qwen3.5-4b.json';protocol=json.loads(PROTOCOL.read_text())
    assert sha(data/'manifest.json')==protocol['dataset_sha256']
    fingerprint=dict(dataset_sha256=sha(data/'manifest.json'),protocol_sha256=sha(PROTOCOL),prompt_sha256=sha(ROOT/'latent/context_prompts.py'),
                     source_sha256=sha(source),extractor_sha256=sha(Path(__file__)))
    rows=read_dataset(data);pairs={key(r):r for r in rows};encoder=None;started=time.perf_counter();metadata={}
    def load():
        nonlocal encoder
        if encoder is None:
            encoder=FrozenTokenEncoder(source);encoder.encode('你好。','普通聊天。')
        return encoder
    def input_for(row,mode):
        e=load();formatted=prompt(e.tokenizer,row['text'],row['context'],mode)
        encoded=e.tokenizer(formatted,return_tensors='pt',add_special_tokens=False).to('cuda')
        assert encoded.input_ids.shape[1]<=protocol['max_input_tokens']
        return encoded
    for mode in ['context_first','task_context_first']:
        path=OUT/f'{mode}-tokens.pt';features={};timings=[]
        if path.exists():
            saved=torch.load(path,map_location='cpu',weights_only=True);assert saved['fingerprint']==fingerprint
            features=saved['features'];timings=saved['timings']
        missing=[k for k in sorted(pairs) if k not in features]
        for i,k in enumerate(missing):
            encoded=input_for(pairs[k],mode);torch.cuda.synchronize();begin=time.perf_counter()
            with torch.inference_mode():h=encoder.backbone(**encoded,use_cache=False,return_dict=True).last_hidden_state[0]
            torch.cuda.synchronize();elapsed=(time.perf_counter()-begin)*1000
            features[k]=h.cpu().to(torch.bfloat16);timings.append(dict(input_sha256=hashlib.sha256(k.encode()).hexdigest(),tokens=len(h),encoder_ms=elapsed))
            if (i+1)%50==0 or i+1==len(missing):
                tmp=path.with_suffix('.tmp');torch.save(dict(fingerprint=fingerprint,features=features,timings=timings),tmp);tmp.replace(path)
                print(json.dumps(dict(stage='encode',mode=mode,pairs=len(features),total=len(pairs),elapsed_s=round(time.perf_counter()-started,1))),flush=True)
        metadata[mode]=dict(path=str(path.relative_to(ROOT)),sha256=sha(path),pairs=len(features),fingerprint=fingerprint)
        del features
    legacy=ROOT/'experiments/vtuber-v4-intent-r2/tokens.pt';legacy_meta=json.loads((legacy.parent/'cache.json').read_text())
    assert sha(legacy)==legacy_meta['cache_sha256'];metadata['legacy_json']=dict(path=str(legacy.relative_to(ROOT)),sha256=sha(legacy),pairs=300)
    write(OUT/'cache.json',dict(fingerprint=fingerprint,modes=metadata,old_test_loaded=False,new_final_test_created=False))
    generation=protocol['direct_generation'];path=OUT/'direct-generation.json';records={};warmup=None
    if path.exists():
        saved=json.loads(path.read_text());assert saved['fingerprint']==fingerprint
        records=saved['records'];warmup=saved['warmup']
    todo=[r for r in rows if r['split'] in generation['splits'] and r['history_variant']=='canonical' and r['id'] not in records]
    if todo:
        e=load();e.wrapper.to('cuda').eval();e.wrapper.requires_grad_(False)
        config=copy.deepcopy(e.wrapper.generation_config);config.do_sample=False;config.temperature=1.;config.top_p=1.;config.top_k=0
        config.max_new_tokens=generation['max_new_tokens'];config.use_cache=True
        def generate(row):
            encoded=input_for(row,generation['mode']);torch.cuda.synchronize();begin=time.perf_counter()
            with torch.inference_mode():generated=e.wrapper.generate(**encoded,generation_config=config,logits_to_keep=1)
            torch.cuda.synchronize();elapsed=(time.perf_counter()-begin)*1000
            new=generated[0,encoded.input_ids.shape[1]:]
            text=e.tokenizer.decode(new,skip_special_tokens=True,clean_up_tokenization_spaces=False).strip()
            error=None;parsed=None
            try:parsed=parse_direct(text)
            except (ValueError,TypeError,KeyError) as exc:error=type(exc).__name__+': '+str(exc)
            return dict(raw=text,parsed=parsed,error=error,valid=error is None,input_tokens=int(encoded.input_ids.shape[1]),
                        output_tokens=len(new),generation_ms=elapsed,max_tokens_reached=len(new)>=generation['max_new_tokens'])
        if warmup is None:warmup=generate(dict(text='文档已经保存。',context='双方核对普通文件保存进度。'))
        for i,row in enumerate(todo):
            records[row['id']]=dict(split=row['split'],**generate(row))
            if (i+1)%10==0 or i+1==len(todo):
                write(path,dict(fingerprint=fingerprint,records=records,warmup=warmup,old_test_loaded=False,promoted=False,
                    scope='offline decision diagnostic only, not a live chat LLM connection; isolated timings'))
                print(json.dumps(dict(stage='direct',completed=len(records),total=120,invalid=sum(not v['valid'] for v in records.values()),
                    elapsed_s=round(time.perf_counter()-started,1))),flush=True)
    print(json.dumps(dict(complete=True,direct_records=len(records),output=str(OUT))),flush=True)
if __name__=='__main__':main()
