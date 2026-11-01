"""Compare the unchanged fine-tuned weights on the original and CUDA-graph paths."""
import argparse
import json
import sys
import time
import socket
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
from speech.runtime import Voice

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--backend',choices=['huggingface','cuda_graph'],default='cuda_graph')
    parser.add_argument('--repeats',type=int,default=2)
    args=parser.parse_args()
    try:
        with socket.create_connection(('127.0.0.1',8769),timeout=.2):raise SystemExit('请先关闭 TTS 服务，避免重复加载模型占用显存。')
    except OSError:pass
    begin=time.perf_counter();voice=Voice('cuda',backend=args.backend)
    report={'backend':args.backend,'load_ms':round((time.perf_counter()-begin)*1000),'info':voice.info(),'cases':[]}
    for text in ['大家晚上好，我是大肥鱼。很高兴又见到你。','今天想和大家聊一聊开心的事情。先坐好，听我慢慢说。遇到困难也别着急，我们一起想办法，好不好？']:
        for i in range(args.repeats):
            result=voice.synthesize(text)
            item={k:result[k] for k in ['text','duration_ms','synthesis_ms','audio_url','audio_sha256']}
            item['repeat']=i;report['cases'].append(item)
            print(json.dumps(item,ensure_ascii=False),flush=True)
    destination=ROOT/'test-results/speech-v2'/('benchmark-'+args.backend+'.json')
    destination.parent.mkdir(parents=True,exist_ok=True)
    destination.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
