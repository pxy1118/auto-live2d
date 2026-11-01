"""Windows lifecycle integration: real console Ctrl+C and real model services."""
import ctypes
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time
import unittest

ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
import main as launcher


@unittest.skipUnless(os.name=='nt','Windows process identity')
class ProcessIdentityTests(unittest.TestCase):
    def test_exited_process_with_retained_handle_is_not_alive(self):
        # Popen retains its Windows process handle after wait(). PID/time queries
        # still succeed on that terminated process until all handles are closed.
        with subprocess.Popen([sys.executable,'-c','import time; time.sleep(.3)'],creationflags=subprocess.CREATE_NO_WINDOW) as child:
            self.assertIsNotNone(launcher.windows_birth(child.pid))
            self.assertEqual(child.wait(timeout=10),0)
            self.assertIsNone(launcher.windows_birth(child.pid))


@unittest.skipUnless(os.name=='nt','Windows foreground launcher')
class LifecycleTests(unittest.TestCase):
    def setUp(self):
        self.children=[];self.out=ROOT/'test-results/launcher';self.out.mkdir(parents=True,exist_ok=True)
        self.assertIsNone(launcher.read(launcher.STATE),'Stop the existing launcher before lifecycle tests')
        self.assertFalse(launcher.occupied(8765))
    def spawn(self,label):
        info=subprocess.STARTUPINFO();info.dwFlags|=subprocess.STARTF_USESHOWWINDOW;info.wShowWindow=0
        with (self.out/(label+'.log')).open('wb') as log:
            process=subprocess.Popen([sys.executable,'-u',str(ROOT/'main.py'),'--no-browser'],cwd=ROOT,
                stdout=log,stderr=log,creationflags=subprocess.CREATE_NEW_CONSOLE,startupinfo=info)
        self.children.append(process);return process
    def wait_for(self,process,predicate,timeout=240):
        end=time.monotonic()+timeout
        while time.monotonic()<end:
            state=launcher.read(launcher.STATE)
            if state and state.get('pid')==process.pid and predicate(state):return state
            if process.poll() is not None:self.fail('Launcher exited early; see '+str(self.out))
            time.sleep(.08)
        self.fail('Launcher readiness timed out')
    def interrupt(self,process):
        # An isolated hidden console lets us send actual CTRL_C_EVENT without
        # interrupting the test terminal, Codex, or unrelated console processes.
        script=('import ctypes,time; k=ctypes.WinDLL("kernel32",use_last_error=True); k.FreeConsole(); '
            f'assert k.AttachConsole({process.pid}),ctypes.get_last_error(); '
            'assert k.SetConsoleCtrlHandler(None,True); '
            'assert k.GenerateConsoleCtrlEvent(0,0),ctypes.get_last_error(); time.sleep(.3);k.FreeConsole()')
        subprocess.run([sys.executable,'-c',script],check=True,creationflags=subprocess.CREATE_NO_WINDOW,timeout=10)
    def assert_clean(self,process,token,code=0):
        self.assertEqual(process.wait(timeout=40),code)
        report=launcher.read(ROOT/'.runtime/main-last.json');self.assertEqual(report['run_id'],token);self.assertTrue(report['all_stopped'])
        self.assertFalse(launcher.STATE.exists());self.assertFalse(launcher.occupied(8765))
        workers=(report.get('workers') or {}).get('workers',[]);pids=[w['pid'] for w in workers]
        script=('import json,pathlib,subprocess; pids='+repr(pids)+'; '
            'rows=subprocess.run(["ss","-H","-ltnp"],capture_output=True,text=True,check=True).stdout.splitlines(); '
            'remaining=[x for x in rows if x.split()[3].endswith((":8768",":8769"))]; '
            'live=[p for p in pids if pathlib.Path("/proc/"+str(p)).exists()]; '
            'print(json.dumps({"listeners":remaining,"live_owned_pids":live})); assert not remaining and not live')
        result=subprocess.run(['wsl.exe','--distribution',launcher.DISTRO,'--exec','python3','-c',script],capture_output=True,text=True,encoding='utf-8',check=True,timeout=15)
        report['verified_shutdown']=json.loads(result.stdout)
        (self.out/(self._testMethodName+'.json')).write_text(json.dumps(report,indent=2),encoding='utf-8')
        for name in ['latent-ready.json','tts-ready.json']:self.assertFalse((ROOT/'.runtime'/name).exists())
    def tearDown(self):
        for process in self.children:
            if process.poll() is None:
                state=launcher.read(launcher.STATE)
                if state and state.get('pid')==process.pid:
                    (ROOT/'.runtime/main'/state['run_id']/'stop').touch()
                try:process.wait(timeout=40)
                except subprocess.TimeoutExpired:process.terminate();process.wait(timeout=10)
    def test_01_real_ctrl_c_stops_every_service_and_duplicate_is_rejected(self):
        process=self.spawn('ctrl-c');state=self.wait_for(process,lambda s:s.get('status')=='running')
        self.assertTrue(launcher.health(8765,'/api/latent/status')['ready']);self.assertTrue(launcher.health(8765,'/api/speech/status')['ready'])
        duplicate=self.spawn('duplicate');self.assertEqual(duplicate.wait(timeout=15),1)
        self.assertIsNone(process.poll());self.assertEqual(launcher.read(launcher.STATE)['run_id'],state['run_id'])
        self.interrupt(process);self.assert_clean(process,state['run_id'])
        self.assertEqual(launcher.read(ROOT/'.runtime/main-last.json')['reason'],'Ctrl+C')
    def test_05_stop_command_handles_a_retained_launcher_process_handle(self):
        process=self.spawn('stop-retained-handle');state=self.wait_for(process,lambda s:s.get('status')=='running')
        result=subprocess.run([sys.executable,str(ROOT/'main.py'),'--stop'],cwd=ROOT,capture_output=True,encoding='utf-8',timeout=50,creationflags=subprocess.CREATE_NO_WINDOW)
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        self.assert_clean(process,state['run_id'])
    def test_02_ctrl_c_during_model_loading_cleans_partial_startup(self):
        process=self.spawn('startup-cancel')
        def loading(state):
            workers=launcher.read(ROOT/'.runtime/main'/state['run_id']/'workers.json')
            return workers and workers.get('phase')=='latent' and any(w['name']=='latent' for w in workers['workers'])
        state=self.wait_for(process,loading);self.interrupt(process);self.assert_clean(process,state['run_id'])
    def test_03_node_failure_shuts_down_model_workers(self):
        process=self.spawn('node-failure');state=self.wait_for(process,lambda s:s.get('status')=='running')
        pid=state['node_pid'];birth=launcher.windows_birth(pid);self.assertIsNotNone(birth)
        self.assertEqual(launcher.windows_birth(pid),birth);os.kill(pid,signal.SIGTERM)
        self.assert_clean(process,state['run_id'],code=1)
    def test_04_occupied_port_is_not_taken_over(self):
        with socket.socket() as foreign:
            foreign.bind(('127.0.0.1',8765));foreign.listen(10)
            process=self.spawn('occupied-port');self.assertEqual(process.wait(timeout=15),1)
            self.assertTrue(launcher.occupied(8765));self.assertFalse(launcher.STATE.exists())


if __name__=='__main__':unittest.main(verbosity=2)
