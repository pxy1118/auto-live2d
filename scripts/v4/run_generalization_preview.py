"""Own only the temporary candidate workers; preserve default model pointers."""
import json
import os
import signal
import subprocess
import sys
import time
import urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'experiments/vtuber-v4-generalization-r1'
sys.path.insert(0,str(ROOT))

def write(path,data):path.write_text(json.dumps(data,indent=2)+'\n',encoding='utf-8')
def health(port):
    try:
        with urllib.request.urlopen(f'http://127.0.0.1:{port}/health',timeout=1) as r:return json.load(r)
    except Exception:return None

def main():
    if health(8768) or health(8769):raise RuntimeError('Existing model services are running; no process taken over')
    stop=OUT/'preview.stop';stop.unlink(missing_ok=True);children=[];logs=[];interrupted=False
    def halt(*_):
        nonlocal interrupted
        interrupted=True
    for sig in [signal.SIGTERM,signal.SIGINT,signal.SIGHUP]:signal.signal(sig,halt)
    def stopping():return interrupted or stop.exists()
    def status(phase):write(OUT/'preview-workers.json',{'phase':phase,'host_pid':os.getpid(),'workers':[{'name':name,'pid':p.pid,'running':p.poll() is None} for name,p in children]})
    try:
        from speech.config import settings,local_path
        cfg=settings()
        specifications=[('latent',[sys.executable,'latent/serve.py','--device','cpu','--planner-device','cuda','--stream-experiment','experiments/vtuber-v4-generalization-r1/runtime-candidate'],8768),
            ('tts',[str(local_path(cfg['python'])),'-m','speech.serve','--device','cuda'],8769)]
        for name,command,port in specifications:
            log=(OUT/f'preview-{name}.log').open('a');logs.append(log)
            proc=subprocess.Popen(command,cwd=ROOT,stdout=log,stderr=subprocess.STDOUT,
                env={**os.environ,'HF_HUB_OFFLINE':'1','TRANSFORMERS_OFFLINE':'1','TOKENIZERS_PARALLELISM':'false'})
            children.append((name,proc));status('loading-'+name);deadline=time.monotonic()+180
            while not health(port):
                if stopping():return
                if proc.poll() is not None:raise RuntimeError(f'{name} exited; see preview-{name}.log')
                if time.monotonic()>deadline:raise RuntimeError(f'{name} startup timeout')
                time.sleep(.25)
        status('ready');print('Candidate + TTS ready; live model pointers unchanged',flush=True)
        while not stopping():
            if any(p.poll() is not None for _,p in children):raise RuntimeError('A candidate worker exited')
            time.sleep(.2)
    finally:
        for _,proc in reversed(children):
            if proc.poll() is None:proc.terminate()
        for _,proc in children:
            try:proc.wait(timeout=8)
            except subprocess.TimeoutExpired:proc.kill();proc.wait()
        for log in logs:log.close()
        status('stopped')

if __name__=='__main__':main()
