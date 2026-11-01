import argparse,json,os,threading
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from speech.config import RUNTIME,settings,write
from speech.runtime import Voice

parser=argparse.ArgumentParser();parser.add_argument('--device',choices=['cuda','cpu'],default='cuda');args=parser.parse_args()
voice=Voice(args.device);lock=threading.Lock()

class Handler(BaseHTTPRequestHandler):
    def send(self,status,data):
        raw=json.dumps(data,ensure_ascii=False,allow_nan=False).encode();self.send_response(status);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Content-Length',str(len(raw)));self.end_headers()
        try:self.wfile.write(raw)
        except (BrokenPipeError,ConnectionResetError):pass
    def do_GET(self):self.send(200,{**voice.info(),'busy':lock.locked()}) if self.path=='/health' else self.send(404,{'error':'not_found'})
    def do_POST(self):
        if self.path!='/synthesize':return self.send(404,{'error':'not_found'})
        if not lock.acquire(blocking=False):return self.send(429,{'error':'语音正在生成，请稍后再试'})
        try:
            size=int(self.headers.get('Content-Length',0))
            if not 0<size<16000:raise ValueError('请求过大')
            data=json.loads(self.rfile.read(size));result=voice.synthesize(data.get('text'),data.get('language'),data.get('seed',41));self.send(200,result)
        except Exception as e:self.send(400,{'error':str(e)})
        finally:lock.release()

server=ThreadingHTTPServer(('127.0.0.1',settings()['port']),Handler)
RUNTIME.mkdir(exist_ok=True);write(RUNTIME/'tts-ready.json',{'pid':os.getpid(),**voice.info()})
print(json.dumps(voice.info()),flush=True);server.serve_forever()
