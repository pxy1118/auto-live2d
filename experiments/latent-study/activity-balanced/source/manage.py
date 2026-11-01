"""WSL worker lifecycle, PID/start-time ownership, hidden from the Windows desktop."""
import argparse
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / ".runtime"
STATE = RUNTIME / "latent-process.json"
READY = RUNTIME / "latent-ready.json"


def identity(pid):
    try:
        # Fields after the parenthesized comm start at field 3; index 19 is starttime (22).
        stat = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()
        return {"start": stat[19], "cmdline": Path(f"/proc/{pid}/cmdline").read_text().replace("\0", " ")}
    except FileNotFoundError: return None


def main():
    parser = argparse.ArgumentParser(); parser.add_argument("action", choices=["start", "stop", "status"])
    parser.add_argument("--device", choices=["cpu", "cuda"], default="cuda"); args = parser.parse_args()
    previous = json.loads(STATE.read_text()) if STATE.exists() else None
    live = identity(previous["pid"]) if previous else None
    owned = bool(live and live["start"] == previous["start"] and str(ROOT / "latent/serve.py") in live["cmdline"])
    if args.action == "stop":
        if live and not owned: raise RuntimeError("进程身份不匹配，未停止任何进程")
        if owned:
            os.kill(previous["pid"], signal.SIGTERM)
            for _ in range(40):
                if not identity(previous["pid"]): break
                time.sleep(.1)
        if STATE.exists(): STATE.unlink()
        if READY.exists() and json.loads(READY.read_text()).get("pid") == (previous or {}).get("pid"): READY.unlink()
        print("动作模型已停止。Demo 控制服务保持运行。")
        return
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    if args.action == "status":
        if not owned or not READY.exists(): raise RuntimeError("动作模型未启动")
        print(READY.read_text())
        return
    if live and not owned: raise RuntimeError("记录的进程身份不符")
    if owned:
        print(f"动作专家已启动，PID {previous['pid']}；重启前先运行 stop.ps1")
        return
    # Do not take over an unrelated service on the worker port.
    import socket
    with socket.socket() as probe:
        probe.settimeout(.5)
        if probe.connect_ex(("127.0.0.1", 8768)) == 0: raise RuntimeError("8768 已被其他服务占用")
    uv = str(Path.home() / ".local/bin/uv") if (Path.home() / ".local/bin/uv").exists() else shutil.which("uv")
    env = os.environ.copy(); environment = Path.home() / ".local/share/auto-live2d/latent-venv"; env["UV_PROJECT_ENVIRONMENT"] = str(environment)
    subprocess.run([uv, "sync", "--project", str(ROOT / "latent"), "--locked"], env=env, check=True)
    source_file = ROOT / "latent/encoder-source.json"
    source = json.loads(source_file.read_text(encoding='utf-8'))
    model_dir = ROOT / source.get("directory", "models/" + source["repo_id"].split("/")[-1])
    if not source.get("weights") or any(not (model_dir / w["file"]).exists() or (model_dir / w["file"]).stat().st_size != w["bytes"] for w in source["weights"]):
        subprocess.run([str(environment / "bin/python"), str(ROOT / "latent/prepare_encoder.py")], env=env, check=True)
    RUNTIME.mkdir(exist_ok=True)
    command = [str(environment / "bin/python"), str(ROOT / "latent/serve.py"), "--device", args.device]
    with (RUNTIME / "latent.log").open("ab") as log:
        process = subprocess.Popen(command, cwd=ROOT, env=env, stdout=log, stderr=log, start_new_session=True)
    info = identity(process.pid)
    STATE.write_text(json.dumps({"pid": process.pid, "start": info["start"], "root": str(ROOT)}), encoding="utf-8")
    for _ in range(120):
        if process.poll() is not None: raise RuntimeError("模型进程退出，查看 .runtime/latent.log")
        if READY.exists() and json.loads(READY.read_text()).get("pid") == process.pid:
            print(READY.read_text()); return
        time.sleep(1)
    raise RuntimeError("模型仍未就绪，查看 .runtime/latent.log；已保留进程与日志")


if __name__ == "__main__": main()

