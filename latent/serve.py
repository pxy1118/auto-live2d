import argparse
import json
import os
import threading
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from common import ROOT,write
import torch
from encoder import SemanticEncoder
from emotion_action import EmotionActionPolicy

parser=argparse.ArgumentParser(); parser.add_argument('--device',choices=['cuda','cpu'],default='cuda'); parser.add_argument('--port',type=int,default=8768)
parser.add_argument('--stream-experiment',help='Explicit candidate experiment; does not change stream-run.json')
args=parser.parse_args()
torch.set_num_threads(4)
encoder=SemanticEncoder(device=args.device);lock=threading.Lock()
streaming=EmotionActionPolicy(encoder,args.stream_experiment)
if args.stream_experiment:
    streaming.prefill({'text':'你好，我是大肥鱼。','context':'直播开始，普通问候观众。'})

class Handler(BaseHTTPRequestHandler):
    def send(self,status,value):
        body=json.dumps(value,ensure_ascii=False,allow_nan=False).encode(); self.send_response(status); self.send_header('Content-Type','application/json; charset=utf-8'); self.send_header('Content-Length',str(len(body))); self.end_headers(); self.wfile.write(body)
    def do_GET(self):
        if self.path=='/health':self.send(200,streaming.info())
        elif self.path=='/stream/status':self.send(200,streaming.info())
        else:self.send(404,{'error':'not_found'})
    def do_POST(self):
        if self.path not in ('/stream/predict','/stream/prefill'): return self.send(404,{'error':'not_found'})
        size=int(self.headers.get('Content-Length',0))
        if not 0<size<128000: return self.send(400,{'error':'invalid_size'})
        if not lock.acquire(blocking=False): return self.send(429,{'error':'模型正在预测'})
        try:
            data=json.loads(self.rfile.read(size))
            result=streaming.prefill(data) if self.path=='/stream/prefill' else streaming.predict(data)
            self.send(200,result)
        except Exception as e: self.send(400,{'error':str(e)})
        finally: lock.release()

server=ThreadingHTTPServer(('127.0.0.1',args.port),Handler)
(ROOT/'.runtime').mkdir(exist_ok=True);write(ROOT/'.runtime'/('latent-ready.json' if args.port==8768 else f'latent-ready-{args.port}.json'),{'pid':os.getpid(),**streaming.info()})
print(json.dumps(streaming.info()),flush=True);server.serve_forever()
