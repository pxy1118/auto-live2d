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
        if self.path not in ('/synthesize','/stream'):return self.send(404,{'error':'not_found'})
        if not lock.acquire(blocking=False):return self.send(429,{'error':'语音正在生成，请稍后再试'})
        streaming=False;events=None
        try:
            size=int(self.headers.get('Content-Length',0))
            if not 0<size<16000:raise ValueError('请求过大')
            data=json.loads(self.rfile.read(size));voice.validate(data.get('text'),data.get('language'),data.get('seed',41))
            if self.path=='/synthesize':return self.send(200,voice.synthesize(data.get('text'),data.get('language'),data.get('seed',41)))
            if not voice.fast:raise ValueError('流式推理需要 CUDA Graph 后端')
            self.send_response(200);self.send_header('Content-Type','application/x-ndjson; charset=utf-8');self.send_header('Cache-Control','no-store');self.end_headers();streaming=True
            events=voice.stream(data['text'],data.get('language'),data.get('seed',41))
            for event in events:
                self.wfile.write((json.dumps(event,ensure_ascii=False,allow_nan=False)+'\n').encode());self.wfile.flush()
        except (BrokenPipeError,ConnectionResetError):pass
        except Exception as e:
            if streaming:
                try:self.wfile.write((json.dumps({'type':'error','error':str(e)},ensure_ascii=False)+'\n').encode());self.wfile.flush()
                except (BrokenPipeError,ConnectionResetError):pass
            else:self.send(400,{'error':str(e)})
        finally:
            if events is not None:events.close()
            lock.release()

server=ThreadingHTTPServer(('127.0.0.1',settings()['port']),Handler)
RUNTIME.mkdir(exist_ok=True);write(RUNTIME/'tts-ready.json',{'pid':os.getpid(),**voice.info()})
print(json.dumps(voice.info()),flush=True);server.serve_forever()
