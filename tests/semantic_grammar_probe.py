"""Tokenizer-only regression probe: legal Chinese JSON must remain reachable."""
import json
import logging
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from transformers import AutoTokenizer
from lmformatenforcer import JsonSchemaParser,TokenEnforcer
from semantic.grammar import tokenizer_data,schema_enforcer
from semantic.planner import OUTPUT_SCHEMA,ROOT
logging.basicConfig(level=logging.DEBUG)
tokenizer=AutoTokenizer.from_pretrained(ROOT/'models/Qwen3.5-4B',local_files_only=True)
data=tokenizer_data(tokenizer,tokenizer.eos_token_id)
for schema,plan in [(OUTPUT_SCHEMA,dict(meaning='向观众问好',affect_subject='avatar',speech_act='greet',delivery='warm',vad=[.4,.2,0],beats=[]))]:
    target=json.dumps(plan,ensure_ascii=False,separators=(',',':'))
    prefix=tokenizer.encode('请输出JSON：',add_special_tokens=False)
    enforcer=schema_enforcer(data,schema)
    for token in tokenizer.encode(target,add_special_tokens=False):
        allowed=enforcer.get_allowed_tokens(prefix).allowed_tokens
        if token not in allowed:
            print(json.dumps(dict(prefix=tokenizer.decode(prefix),wanted=tokenizer.decode([token]),token=token,eos=tokenizer.eos_token_id,allowed_sample=[tokenizer.decode([t]) for t in allowed[:10]]),ensure_ascii=False))
            raise AssertionError('legal Chinese JSON token was excluded')
        prefix.append(token)
    assert tokenizer.eos_token_id in enforcer.get_allowed_tokens(prefix).allowed_tokens
print('Chinese JSON remains reachable; EOS only permitted after a full object.')
