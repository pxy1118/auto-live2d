"""Read-only functional probes, separate from held-out test evaluation."""
import json,urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
CASES=[('大家好呀。','和观众自然聊天。'),('再陪我一会儿好不好？','我想亲近地请求观众多陪伴一会儿。'),('你突然这样夸我，我有点不好意思。','和观众自然聊天。'),('我真的生气了，请不要再捉弄我。','和观众自然聊天。'),('她说“我真的生气了！”，我只是在读她的留言。','和观众自然聊天。'),('今天的天气和昨天差不多。','和观众自然聊天。'),('我来解释一下为什么。','和观众自然聊天。'),('这件事就交给我吧。','和观众自然聊天。'),('我现在已经平静下来了。','刚才有些生气，现在恢复了。')]
def main():
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}));results=[]
    for text,context in CASES:
        req=urllib.request.Request('http://127.0.0.1:8768/stream/prefill',json.dumps({'text':text,'context':context},ensure_ascii=False).encode(),{'Content-Type':'application/json'})
        with opener.open(req,timeout=30) as response:d=json.load(response)
        results.append({'text':text,'context':context,'plan':d.get('performance_plan'),'semantic_ms':d['semantic_ms']})
        p=d.get('performance_plan',{});print(json.dumps({'text':text,'arm':p.get('arm'),'body':p.get('body'),'emotion':p.get('emotion'),'expressions':p.get('expressions'),'eye':p.get('eye')},ensure_ascii=False))
    out=ROOT/'test-results/v4-composition';out.mkdir(exist_ok=True);(out/'functional-probes.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
if __name__=='__main__':main()
