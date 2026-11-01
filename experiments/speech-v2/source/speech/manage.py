"""Start/stop the separate, existing Qwen3-TTS environment with PID ownership checks."""
import argparse,json,os,signal,socket,subprocess,time
from pathlib import Path
from speech.config import ROOT,RUNTIME,settings,read,write,local_path

STATE=RUNTIME/'tts-process.json';READY=RUNTIME/'tts-ready.json'
def identity(pid):
    try:return {'start':Path(f'/proc/{pid}/stat').read_text().rsplit(')',1)[1].split()[19],
        'cmdline':Path(f'/proc/{pid}/cmdline').read_text().replace('\0',' '),'cwd':str(Path(f'/proc/{pid}/cwd').resolve())}
    except (FileNotFoundError,ProcessLookupError):return None

def main():
    p=argparse.ArgumentParser();p.add_argument('action',choices=['start','stop','status']);p.add_argument('--device',choices=['cuda','cpu'],default='cuda');args=p.parse_args()
    previous=read(STATE) if STATE.exists() else None;live=identity(previous['pid']) if previous else None
    owned=bool(live and live['start']==previous['start'] and '-m speech.serve' in live['cmdline'] and live['cwd']==str(ROOT))
    if live and not owned:raise RuntimeError('TTS 进程身份不符，未操作该进程')
    if args.action=='stop':
        if owned:
            os.kill(previous['pid'],signal.SIGTERM)
            for _ in range(100):
                if not identity(previous['pid']):break
                time.sleep(.1)
            if identity(previous['pid']):raise RuntimeError('TTS 尚未退出，保留进程记录以便检查')
        STATE.unlink(missing_ok=True)
        if READY.exists() and read(READY).get('pid')==(previous or {}).get('pid'):READY.unlink()
        print('TTS 服务已停止。');return
    if args.action=='status':
        if not owned or not READY.exists():raise RuntimeError('TTS 未启动')
        print(READY.read_text());return
    if owned:print(f"TTS 已启动，PID {previous['pid']}");return
    config=settings();python=local_path(config['python']);checkpoint=local_path(config['checkpoint'])
    if not python.is_file() or not (checkpoint/'model.safetensors').is_file():raise RuntimeError('TTS 环境或 checkpoint 不存在，检查 speech/config.json')
    with socket.socket() as probe:
        probe.settimeout(.5)
        if probe.connect_ex(('127.0.0.1',config['port']))==0:raise RuntimeError('TTS 端口被其他服务占用')
    RUNTIME.mkdir(exist_ok=True);env=os.environ.copy();env.update({'HF_HUB_OFFLINE':'1','TRANSFORMERS_OFFLINE':'1','TOKENIZERS_PARALLELISM':'false'})
    with (RUNTIME/'tts.log').open('ab') as log:process=subprocess.Popen([str(python),'-m','speech.serve','--device',args.device],cwd=ROOT,env=env,stdout=log,stderr=log,start_new_session=True)
    info=identity(process.pid);write(STATE,{'pid':process.pid,'start':info['start'],'root':str(ROOT)})
    for _ in range(180):
        if process.poll() is not None:raise RuntimeError('TTS 加载失败，查看 .runtime/tts.log')
        if READY.exists() and read(READY).get('pid')==process.pid:print(READY.read_text());return
        time.sleep(1)
    raise RuntimeError('TTS 仍未就绪，保留进程与日志')

if __name__=='__main__':main()
