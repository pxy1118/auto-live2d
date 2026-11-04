import argparse
import json
import os
import threading
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from common import ROOT,write
from runtime import LatentPolicy
from streaming import StreamingPolicy

parser=argparse.ArgumentParser(); parser.add_argument('--device',choices=['cuda','cpu'],default='cuda'); parser.add_argument('--port',type=int,default=8768); args=parser.parse_args()
policy=LatentPolicy(device=args.device); lock=threading.Lock()
streaming=StreamingPolicy(policy.encoder)
# Pay CUDA/kernel initialization at startup, so the first spoken reply does not
# wait on a cold semantic encoder while its first audio chunk is already ready.
if args.device=='cuda':
    for kind in ['regression','flow']:
        policy.predict('你好，我是大肥鱼。','直播开始，普通问候观众。','lively',kind,41)

class Handler(BaseHTTPRequestHandler):
    def send(self,status,value):
        body=json.dumps(value,ensure_ascii=False,allow_nan=False).encode(); self.send_response(status); self.send_header('Content-Type','application/json; charset=utf-8'); self.send_header('Content-Length',str(len(body))); self.end_headers(); self.wfile.write(body)
    def do_GET(self):
        if self.path=='/health':self.send(200,{**policy.info(),'streaming':streaming.info()})
        elif self.path=='/stream/status':self.send(200,streaming.info())
        else:self.send(404,{'error':'not_found'})
    def do_POST(self):
        if self.path not in ('/predict','/stream/predict','/stream/prefill'): return self.send(404,{'error':'not_found'})
        size=int(self.headers.get('Content-Length',0))
        if not 0<size<128000: return self.send(400,{'error':'invalid_size'})
        if not lock.acquire(blocking=False): return self.send(429,{'error':'模型正在预测'})
        try:
            data=json.loads(self.rfile.read(size))
            result=streaming.prefill(data) if self.path=='/stream/prefill' else streaming.predict(data) if self.path=='/stream/predict' else policy.predict(data.get('text'),data.get('context',''),data.get('style','natural'),data.get('kind','regression'),data.get('seed',41))
            self.send(200,result)
        except Exception as e: self.send(400,{'error':str(e)})
        finally: lock.release()

server=ThreadingHTTPServer(('127.0.0.1',args.port),Handler)
(ROOT/'.runtime').mkdir(exist_ok=True);write(ROOT/'.runtime'/('latent-ready.json' if args.port==8768 else f'latent-ready-{args.port}.json'),{'pid':os.getpid(),**policy.info()})
print(json.dumps(policy.info()),flush=True);server.serve_forever()
