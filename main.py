"""Foreground Windows launcher; Ctrl+C owns the full Windows/WSL service lifetime.

The internal WSL host supervises model process groups and exits on stdin EOF,
stop-file, or termination signals. No model libraries are imported by either host.
"""
import argparse
import ctypes
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.request
import uuid
import webbrowser

ROOT=Path(__file__).resolve().parent
RUNTIME=ROOT/'.runtime'
STATE=RUNTIME/'main-process.json'
DISTRO='Ubuntu-24.04'
ENABLE_PROCESSED_INPUT=0x0001
CTRL_C_BYTE=b'\x03'


class Cancelled(Exception):pass


class ConsoleInput:
    """Keep terminal Ctrl+C working while the WSL host owns a raw console.

    wsl.exe switches the console it shares with the launcher into raw mode (no
    ENABLE_PROCESSED_INPUT) for as long as it runs. Without that flag a terminal
    Ctrl+C arrives as a plain 0x03 byte instead of CTRL_C_EVENT, so the SIGINT
    handler never runs and the terminal looks frozen. Re-enable the flag before
    waiting on the services and restore the original mode when the launcher exits.
    """
    def __init__(self):
        self.kernel=None;self.handle=None;self.original=None
        try:
            kernel=ctypes.WinDLL('kernel32',use_last_error=True)
            kernel.CreateFileW.argtypes=[ctypes.c_wchar_p,ctypes.c_uint32,ctypes.c_uint32,ctypes.c_void_p,ctypes.c_uint32,ctypes.c_uint32,ctypes.c_void_p]
            kernel.CreateFileW.restype=ctypes.c_void_p
            kernel.GetConsoleMode.argtypes=[ctypes.c_void_p,ctypes.POINTER(ctypes.c_uint)]
            kernel.SetConsoleMode.argtypes=[ctypes.c_void_p,ctypes.c_uint]
            kernel.CloseHandle.argtypes=[ctypes.c_void_p]
            # CONIN$ is this process' own console; inherited std handles may point elsewhere.
            handle=kernel.CreateFileW('CONIN$',0xC0000000,3,None,3,0,None)
            mode=ctypes.c_uint()
            if not handle or not kernel.GetConsoleMode(handle,ctypes.byref(mode)):return
            self.kernel=kernel;self.handle=handle;self.original=mode.value
        except OSError:pass
    def ensure(self):
        if self.kernel is None:return
        mode=ctypes.c_uint()
        if not self.kernel.GetConsoleMode(self.handle,ctypes.byref(mode)):
            self.kernel=None;return
        # wsl.exe sets raw mode once, but keep guarding: the console is shared.
        if mode.value&ENABLE_PROCESSED_INPUT:return
        if not self.kernel.SetConsoleMode(self.handle,mode.value|ENABLE_PROCESSED_INPUT):self.kernel=None
    def restore(self):
        if self.kernel is None:return
        try:self.kernel.SetConsoleMode(self.handle,(self.original or 0)|ENABLE_PROCESSED_INPUT)
        except OSError:pass
        self.kernel.CloseHandle(self.handle)
        self.kernel=None;self.handle=None

def read(path):
    try:return json.loads(Path(path).read_text(encoding='utf-8-sig'))
    except (FileNotFoundError,json.JSONDecodeError):return None

def write(path,data):
    path=Path(path);temporary=path.with_name(path.name+'.tmp')
    temporary.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8')
    for attempt in range(10):
        try:os.replace(temporary,path);return
        except PermissionError:
            if attempt==9:raise
            time.sleep(.03)

def health(port,path='/health'):
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(f'http://127.0.0.1:{port}{path}',timeout=.5) as response:return json.load(response)
    except (OSError,ValueError):return None

def occupied(port):
    with socket.socket() as probe:
        probe.settimeout(.2);return probe.connect_ex(('127.0.0.1',port))==0

def windows_birth(pid):
    from ctypes import wintypes
    kernel=ctypes.WinDLL('kernel32',use_last_error=True)
    kernel.OpenProcess.argtypes=[wintypes.DWORD,wintypes.BOOL,wintypes.DWORD];kernel.OpenProcess.restype=wintypes.HANDLE
    kernel.GetProcessTimes.argtypes=[wintypes.HANDLE]+[ctypes.POINTER(wintypes.FILETIME)]*4
    kernel.GetExitCodeProcess.argtypes=[wintypes.HANDLE,ctypes.POINTER(wintypes.DWORD)]
    kernel.CloseHandle.argtypes=[wintypes.HANDLE]
    handle=kernel.OpenProcess(0x1000,False,pid)
    if not handle:return None
    try:
        # An exited process remains queryable while a terminal/Popen retains its
        # handle. Creation time alone is an identity check, not a liveness check.
        exit_code=wintypes.DWORD()
        if not kernel.GetExitCodeProcess(handle,ctypes.byref(exit_code)) or exit_code.value!=259:return None
        stamps=[wintypes.FILETIME() for _ in range(4)]
        if not kernel.GetProcessTimes(handle,*[ctypes.byref(v) for v in stamps]):return None
        return (stamps[0].dwHighDateTime<<32)|stamps[0].dwLowDateTime
    finally:kernel.CloseHandle(handle)


class WindowsJob:
    """Closing the launcher also closes its Node/build/WSL wrapper process tree."""
    def __init__(self):
        from ctypes import wintypes as w
        class Basic(ctypes.Structure):
            _fields_=[('PerProcessUserTimeLimit',ctypes.c_int64),('PerJobUserTimeLimit',ctypes.c_int64),('LimitFlags',w.DWORD),
                ('MinimumWorkingSetSize',ctypes.c_size_t),('MaximumWorkingSetSize',ctypes.c_size_t),('ActiveProcessLimit',w.DWORD),
                ('Affinity',ctypes.c_size_t),('PriorityClass',w.DWORD),('SchedulingClass',w.DWORD)]
        class IO(ctypes.Structure):
            _fields_=[(name,ctypes.c_uint64) for name in ['ReadOperationCount','WriteOperationCount','OtherOperationCount','ReadTransferCount','WriteTransferCount','OtherTransferCount']]
        class Extended(ctypes.Structure):
            _fields_=[('BasicLimitInformation',Basic),('IoInfo',IO),('ProcessMemoryLimit',ctypes.c_size_t),('JobMemoryLimit',ctypes.c_size_t),('PeakProcessMemoryUsed',ctypes.c_size_t),('PeakJobMemoryUsed',ctypes.c_size_t)]
        self.kernel=ctypes.WinDLL('kernel32',use_last_error=True)
        self.kernel.CreateJobObjectW.argtypes=[ctypes.c_void_p,w.LPCWSTR];self.kernel.CreateJobObjectW.restype=w.HANDLE
        self.kernel.SetInformationJobObject.argtypes=[w.HANDLE,ctypes.c_int,ctypes.c_void_p,w.DWORD]
        self.kernel.AssignProcessToJobObject.argtypes=[w.HANDLE,w.HANDLE];self.kernel.CloseHandle.argtypes=[w.HANDLE]
        self.handle=self.kernel.CreateJobObjectW(None,None)
        if not self.handle:raise ctypes.WinError(ctypes.get_last_error())
        limits=Extended();limits.BasicLimitInformation.LimitFlags=0x2000
        if not self.kernel.SetInformationJobObject(self.handle,9,ctypes.byref(limits),ctypes.sizeof(limits)):
            self.close();raise ctypes.WinError(ctypes.get_last_error())
    def add(self,process):
        if not self.kernel.AssignProcessToJobObject(self.handle,int(process._handle)):
            process.terminate();process.wait();raise ctypes.WinError(ctypes.get_last_error())
    def close(self):
        if self.handle:self.kernel.CloseHandle(self.handle);self.handle=None


class Foreground:
    def __init__(self,args):
        self.args=args;self.token=uuid.uuid4().hex;self.folder=RUNTIME/'main'/self.token
        self.stop_event=threading.Event();self.reason='';self.job=None;self.lock=None;self.host=None;self.node=None;self.children=[]
        self.stop_file=self.folder/'stop';self.worker_file=self.folder/'workers.json'
        self.console=ConsoleInput()
    def request_stop(self,number=None,frame=None):
        self.reason='Ctrl+C' if number==signal.SIGINT else 'stop requested';self.stop_event.set()
    def watch_stdin(self):
        # Fallback for a console that still has processed input disabled: with
        # ENABLE_PROCESSED_INPUT off the terminal's Ctrl+C is a 0x03 input byte.
        stream=getattr(sys.stdin,'buffer',None)
        if stream is None:return
        try:
            while not self.stop_event.is_set():
                chunk=stream.read(1)
                if not chunk:return
                if chunk==CTRL_C_BYTE:self.request_stop(signal.SIGINT);return
        except (OSError,ValueError):return
    def check(self):
        self.console.ensure()
        if self.stop_event.is_set() or self.stop_file.exists():raise Cancelled(self.reason or 'stop requested')
    def spawn(self,command,log,stdin=None):
        with log.open('ab') as output:
            process=subprocess.Popen(command,cwd=ROOT,stdin=stdin,stdout=output,stderr=output,
                creationflags=subprocess.CREATE_NEW_PROCESS_GROUP,env={**os.environ,'WSL_UTF8':'1'})
        self.children.append(process);self.job.add(process);return process
    def command(self,command,label):
        self.check();process=self.spawn(command,RUNTIME/'startup.log')
        while process.poll() is None:self.check();time.sleep(.1)
        if process.returncode:raise RuntimeError(label+'失败，查看 .runtime/startup.log')
        self.check()
    def acquire(self):
        import msvcrt
        RUNTIME.mkdir(exist_ok=True);self.lock=(RUNTIME/'main.lock').open('a+b')
        if self.lock.seek(0,2)==0:self.lock.write(b'0');self.lock.flush()
        self.lock.seek(0)
        try:msvcrt.locking(self.lock.fileno(),msvcrt.LK_NBLCK,1)
        except OSError:
            self.lock.close();self.lock=None;raise RuntimeError('已有 main.py 在运行，请先在原终端按 Ctrl+C。')
        self.folder.mkdir(parents=True);self.job=WindowsJob()
        write(STATE,{'pid':os.getpid(),'birth':windows_birth(os.getpid()),'root':str(ROOT),'run_id':self.token,'status':'starting'})
    def run(self):
        self.acquire()
        signal.signal(signal.SIGINT,self.request_stop);signal.signal(signal.SIGBREAK,self.request_stop)
        ctypes.windll.kernel32.SetConsoleCtrlHandler(None,False)
        threading.Thread(target=self.watch_stdin,daemon=True).start()
        if occupied(8765):raise RuntimeError('8765 已被占用，未接管现有服务。')
        node=shutil.which('node');wsl=shutil.which('wsl.exe')
        if not node or not wsl:raise RuntimeError('需要本机 Node.js 和 WSL Ubuntu-24.04。')
        npm=Path(node).parent/'node_modules/npm/bin/npm-cli.js'
        if not npm.is_file():raise RuntimeError('找不到 Node.js 配套 npm。')
        print('准备依赖并构建网页…',flush=True)
        if not (ROOT/'node_modules/tsx').exists():self.command([node,str(npm),'ci','--no-fund','--no-audit'],'安装前端依赖')
        self.command([node,str(npm),'run','build'],'构建网页')
        # WSL accepts an explicit exec argv; no shell-built command or quoting is needed.
        drive=ROOT.drive[0].lower();linux_root='/mnt/'+drive+'/'+str(ROOT)[3:].replace('\\','/')
        print('启动表演模型与 Qwen3-TTS…',flush=True)
        worker_args=['--worker-host',self.token,'--device',self.args.device]
        if self.args.stream_experiment:worker_args+=['--stream-experiment',self.args.stream_experiment]
        self.check();self.host=self.spawn([wsl,'--distribution',DISTRO,'--cd',linux_root,'--exec','python3',linux_root+'/main.py',
            *worker_args],RUNTIME/'worker-host.log',stdin=subprocess.PIPE)
        deadline=time.monotonic()+300;previous_phase=None
        while True:
            self.check();state=read(self.worker_file)
            if state and state.get('phase')!=previous_phase:
                previous_phase=state.get('phase')
                labels={'dependencies':'同步模型环境…','latent':'加载情感模型与情绪动作专家（8768）…','tts':'加载大肥鱼音色（8769）…'}
                if previous_phase in labels:print(labels[previous_phase],flush=True)
            if self.host.poll() is not None:raise RuntimeError('模型服务启动失败，查看 .runtime/worker-host.log 和模型日志。')
            if state and state.get('status')=='ready':break
            if time.monotonic()>deadline:raise RuntimeError('模型启动超时，开始清理本次进程。')
            time.sleep(.15)
        self.check();self.node=self.spawn([node,'--import','tsx','server/index.ts','--production'],RUNTIME/'server.log')
        deadline=time.monotonic()+20
        while not (health(8765,'/api/health') or {}).get('ok'):
            self.check()
            if self.node.poll() is not None or time.monotonic()>deadline:raise RuntimeError('网页服务未就绪，查看 .runtime/server.log')
            time.sleep(.1)
        state=read(STATE);state.update(status='running',node_pid=self.node.pid);write(STATE,state)
        target='http://127.0.0.1:8765/'
        print('\n全部服务已就绪：'+target+'\n保持本终端运行；按 Ctrl+C 关闭全部服务。',flush=True)
        if not self.args.no_browser:webbrowser.open(target)
        while True:
            self.check()
            if self.host.poll() is not None:raise RuntimeError('模型服务异常退出，关闭其余服务。')
            if self.node.poll() is not None:raise RuntimeError('网页服务异常退出，关闭其余服务。')
            time.sleep(.2)
    def close(self):
        if self.lock is None:return
        print('正在关闭全部服务…',flush=True)
        if self.folder.exists():self.stop_file.touch()
        if self.host and self.host.stdin:
            try:self.host.stdin.write(b'stop\n');self.host.stdin.flush();self.host.stdin.close()
            except (OSError,ValueError):pass
        # Linux host handles models first, so no detached CUDA process outlives the terminal.
        deadline=time.monotonic()+25
        while self.host and time.monotonic()<deadline:
            state=read(self.worker_file)
            if (state and state.get('status')=='stopped') or (self.host.poll() is not None and not state):break
            time.sleep(.1)
        for process in reversed(self.children):
            if process.poll() is None:
                try:process.send_signal(signal.CTRL_BREAK_EVENT);process.wait(timeout=3)
                except (OSError,subprocess.TimeoutExpired):
                    try:process.terminate()
                    except OSError:pass
        if self.job:self.job.close()
        for process in self.children:
            try:process.wait(timeout=3)
            except subprocess.TimeoutExpired:pass
        workers=read(self.worker_file);clean=not self.host or (workers and workers.get('status')=='stopped') or (self.host.poll() is not None and not workers)
        write(RUNTIME/'main-last.json',{'run_id':self.token,'reason':self.reason,'workers':workers,'all_stopped':bool(clean),'node_pid':self.node.pid if self.node else None})
        current=read(STATE)
        if current and current.get('run_id')==self.token:STATE.unlink(missing_ok=True)
        self.lock.close();self.lock=None
        self.console.restore()
        if not clean:raise RuntimeError('模型清理未确认完成，查看 .runtime/main-last.json')
        print('全部服务已关闭。',flush=True)


def linux_identity(pid):
    try:return Path(f'/proc/{pid}/stat').read_text().rsplit(')',1)[1].split()[19]
    except FileNotFoundError:return None


def resolve_stream_experiment(value):
    path=(ROOT/value).resolve()
    if not path.is_relative_to(ROOT/'experiments') or not (path/'run.json').is_file():
        raise ValueError('研究候选必须是当前项目 experiments 内已有的实验目录')
    return path.relative_to(ROOT).as_posix()


def choose_stream_profile(explicit=None):
    if explicit:return resolve_stream_experiment(explicit),'explicit'
    config=read(ROOT/'latent/stream-run.json') or {}
    if not config.get('promoted'):raise ValueError('当前默认表演模型未启用；不再自动回退到旧版')
    return resolve_stream_experiment(config['path']),'default'


def latent_worker_command(python,device,experiment=None):
    command=[str(python),str(ROOT/'latent/serve.py'),'--device',device]
    if experiment:
        experiment=resolve_stream_experiment(experiment);run=read(ROOT/experiment/'run.json')
        if not run.get('emotion_classifier') and not str(run.get('schema','')).startswith('vtuber.v6'):
            raise ValueError('默认启动只支持情感分类与情绪动作方案')
        command+=['--stream-experiment',experiment]
    return command


def worker_host(token,device,stream_experiment=None):
    if len(token)!=32 or any(c not in '0123456789abcdef' for c in token):raise ValueError('Invalid session token')
    folder=RUNTIME/'main'/token;folder.mkdir(parents=True,exist_ok=True)
    stop_file=folder/'stop';registry=folder/'workers.json';event=threading.Event();children=[];phase='dependencies';error=None
    def stop(*_):event.set()
    for number in [signal.SIGTERM,signal.SIGINT,signal.SIGHUP]:signal.signal(number,stop)
    def watch_input():
        try:sys.stdin.buffer.readline()
        finally:event.set()
    threading.Thread(target=watch_input,daemon=True).start()
    def check():
        if event.is_set() or stop_file.exists():raise Cancelled('launcher disconnected')
    def status(value):write(registry,{'run_id':token,'status':value,'phase':phase,'host_pid':os.getpid(),'workers':[{k:v for k,v in c.items() if k!='process'} for c in children],'error':error})
    def spawn(name,command,environment=None):
        check()
        with (RUNTIME/(name+'.log')).open('ab') as log:process=subprocess.Popen(command,cwd=ROOT,env=environment,stdout=log,stderr=log,start_new_session=True)
        children.append({'name':name,'pid':process.pid,'start':linux_identity(process.pid),'process':process});status('starting');check();return process
    try:
        status('starting');check()
        from speech.config import settings,local_path
        config=settings()
        if occupied(8768) or occupied(config['port']):raise RuntimeError('模型端口已被占用，未接管已有进程。')
        uv=str(Path.home()/'.local/bin/uv') if (Path.home()/'.local/bin/uv').exists() else shutil.which('uv')
        if not uv:raise RuntimeError('WSL 内找不到 uv。')
        if not local_path(config['python']).is_file():raise RuntimeError('speech/config.json 中的 TTS Python 不存在。')
        env={**os.environ,'UV_PROJECT_ENVIRONMENT':str(Path.home()/'.local/share/auto-live2d/latent-venv')}
        sync=spawn('dependency-sync',[uv,'sync','--project',str(ROOT/'latent'),'--locked'],env)
        while sync.poll() is None:check();time.sleep(.1)
        if sync.returncode:raise RuntimeError('动作环境依赖同步失败。')
        python=Path(env['UV_PROJECT_ENVIRONMENT'])/'bin/python';check()
        source=read(ROOT/'latent/encoder-source.json');model=ROOT/'models'/source['repo_id'].split('/')[-1]
        if any(not (model/w['file']).exists() or (model/w['file']).stat().st_size!=w['bytes'] for w in source['weights']):
            download=spawn('encoder-prepare',[str(python),str(ROOT/'latent/prepare_encoder.py')],env)
            while download.poll() is None:check();time.sleep(.1)
            if download.returncode:raise RuntimeError('动作编码器准备失败。')
        run=read(ROOT/stream_experiment/'run.json')
        if run.get('emotion_classifier') or str(run.get('schema','')).startswith('vtuber.v6'):
            source=read(ROOT/'latent/emotion-source.json');model=ROOT/source['local_path']
            if any(not (model/name).is_file() for name in source['files']):
                download=spawn('emotion-prepare',[str(python),str(ROOT/'latent/prepare_emotion.py')],env)
                while download.poll() is None:check();time.sleep(.1)
                if download.returncode:raise RuntimeError('情感模型准备失败。')
        if str(run.get('schema','')).startswith('vtuber.v6'):
            for name,spec in (run.get('models') or {}).items():
                path=ROOT/stream_experiment/spec.get('checkpoint','')
                if not spec.get('checkpoint') or not path.is_file():
                    raise RuntimeError(f'情绪动作检查点缺失：{name}，请先运行训练。')
        for name,command,port,ready,environment in [
            ('latent',latent_worker_command(python,device,stream_experiment),8768,RUNTIME/'latent-ready.json',env),
            ('tts',[str(local_path(config['python'])),'-m','speech.serve','--device',device],config['port'],RUNTIME/'tts-ready.json',
                {**os.environ,'HF_HUB_OFFLINE':'1','TRANSFORMERS_OFFLINE':'1','TOKENIZERS_PARALLELISM':'false'})]:
            phase=name;process=spawn(name,command,environment);deadline=time.monotonic()+180
            while True:
                check()
                if any(c['process'].poll() is not None and c['name'] in ['latent','tts'] for c in children):raise RuntimeError(name+' 服务退出，查看对应日志。')
                metadata=read(ready)
                if metadata and metadata.get('pid')==process.pid and (health(port) or {}).get('ready'):break
                if time.monotonic()>deadline:raise RuntimeError(name+' 加载超时。')
                time.sleep(.15)
        phase='running';status('ready')
        while True:
            check()
            if any(c['process'].poll() is not None for c in children if c['name'] in ['latent','tts']):raise RuntimeError('模型服务异常退出。')
            time.sleep(.15)
    except Cancelled:pass
    except Exception as exc:error=str(exc);print(error,file=sys.stderr,flush=True)
    finally:
        phase='stopping'
        try:status('stopping')
        except OSError:pass
        for child in reversed(children):
            process=child['process']
            if process.poll() is None and linux_identity(process.pid)==child['start']:
                try:os.killpg(process.pid,signal.SIGTERM)
                except ProcessLookupError:pass
        deadline=time.monotonic()+8
        while any(c['process'].poll() is None for c in children) and time.monotonic()<deadline:time.sleep(.1)
        for child in children:
            process=child['process']
            if process.poll() is None and linux_identity(process.pid)==child['start']:
                try:os.killpg(process.pid,signal.SIGKILL)
                except ProcessLookupError:pass
            process.wait()
            ready=RUNTIME/(child['name']+'-ready.json')
            if (read(ready) or {}).get('pid')==process.pid:ready.unlink(missing_ok=True)
        phase='stopped';status('stopped')
    return 1 if error else 0


def stop_foreground():
    state=read(STATE)
    if not state:print('没有运行中的 main.py。');return 0
    if state.get('root')!=str(ROOT) or windows_birth(state['pid'])!=state.get('birth'):
        raise RuntimeError('启动器进程身份不匹配，未停止任何进程。')
    (RUNTIME/'main'/state['run_id']/'stop').touch()
    deadline=time.monotonic()+40
    while windows_birth(state['pid'])==state['birth'] and time.monotonic()<deadline:time.sleep(.1)
    if windows_birth(state['pid'])==state['birth']:raise RuntimeError('启动器仍在清理，请查看原终端。')
    print('全部服务已关闭。');return 0


def main():
    parser=argparse.ArgumentParser(description='启动 Live2D、动作专家和 Qwen3-TTS；Ctrl+C 关闭全部服务。')
    parser.add_argument('--no-browser',action='store_true',help='不自动打开网页')
    parser.add_argument('--device',choices=['cuda','cpu'],default='cuda')
    profiles=parser.add_mutually_exclusive_group()
    profiles.add_argument('--stream-experiment',help='显式启动 experiments 内的流式方案，不修改默认配置')
    parser.add_argument('--stop',action='store_true',help='关闭当前前台启动器及其服务')
    parser.add_argument('--worker-host',help=argparse.SUPPRESS);args=parser.parse_args()
    args.runtime_mode='explicit'
    if not args.stop and not args.worker_host:
        try:args.stream_experiment,args.runtime_mode=choose_stream_profile(args.stream_experiment)
        except (ValueError,KeyError) as exc:parser.error(str(exc))
    elif args.stream_experiment:
        try:args.stream_experiment=resolve_stream_experiment(args.stream_experiment)
        except ValueError as exc:parser.error(str(exc))
    if args.worker_host:return worker_host(args.worker_host,args.device,args.stream_experiment)
    if os.name!='nt':parser.error('请在 Windows 终端运行 python main.py。')
    if args.stop:return stop_foreground()
    supervisor=Foreground(args);result=0
    try:supervisor.run()
    except Cancelled as exc:supervisor.reason=str(exc)
    except Exception as exc:supervisor.reason=str(exc);print(str(exc),file=sys.stderr,flush=True);result=1
    finally:
        try:supervisor.close()
        except Exception as exc:print(str(exc),file=sys.stderr,flush=True);result=1
    return result


if __name__=='__main__':
    for stream in [sys.stdout,sys.stderr]:
        if hasattr(stream,'reconfigure'):stream.reconfigure(encoding='utf-8',errors='replace')
    raise SystemExit(main())
