"""Loopback-only semantic worker. Replaces the v4 decision worker in --semantic mode."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .planner import ROOT, LocalHF, ContractError, messages_for, parse_plan


class SemanticRuntime:
    def __init__(self, backend):
        self.backend = backend
        self.lock = threading.Lock()
        self.guard = threading.Lock()
        self.active = None
        self.cancelled = set()
        self.last_attempts = []

    def info(self):
        return {"ready": True, "semantic_planner": True, "driver": "semantic-local-v1",
                "experimental": True, "promoted": False, "busy": self.lock.locked(),
                "model": self.backend.info, "max_text_length": 300, "continuous_utterance": True,
                "run": {"name": "本地语义表演", "performance_planner": True}}

    def cancel(self, session_id):
        if not isinstance(session_id, str) or len(session_id) > 128:
            raise ContractError("session_id 不合法")
        with self.guard:
            self.cancelled.add(session_id)
            if len(self.cancelled) > 256:
                self.cancelled = {session_id}
            if self.active and self.active[0] == session_id:
                self.active[1].set()
        return {"cancelled": True}

    def plan(self, data):
        sid = data.get("session_id", "diagnostic")
        if not isinstance(sid, str) or not 0 < len(sid) <= 128:
            raise ContractError("session_id 不合法")
        text = data.get("text")
        if not isinstance(text, str) or not 0 < len(text.strip()) <= 300:
            raise ContractError("完整台词必须为 1～300 字")
        case = {key: data.get(key, "") for key in ("context", "audience_message", "director_instruction")}
        case["avatar_text"] = text
        utterance = data.get("utterance", "")
        if not isinstance(utterance, str) or len(utterance) > 12000:
            raise ContractError("整段台词不合法")
        state = data.get("planner_state", {})
        if not isinstance(state, dict):
            raise ContractError("planner_state 不合法")
        if not isinstance(case["context"], str):
            raise ContractError("context 不合法")
        if utterance and utterance != text:
            case["context"] += "\n此前已知台词：" + utterance
        # Physical action scheduling belongs to the renderer. A full numeric
        # face/age snapshot adds tokens without changing the line's meaning.
        if state.get("emotion") and state["emotion"] != "neutral":
            case["context"] += "\n角色此前情绪：" + str(state["emotion"])
        messages = messages_for(case)
        event = threading.Event()
        with self.guard:
            if sid in self.cancelled:
                raise ContractError("会话已取消")
            self.active = (sid, event)
        started = time.perf_counter()
        try:
            attempts = []
            for attempt in range(2):
                result = self.backend.complete(messages, 512, cancel_event=event)
                attempts.append(result)
                self.last_attempts = attempts
                if event.is_set():
                    raise ContractError("会话已取消")
                try:
                    plan = parse_plan(result["raw"], text)
                    break
                except (ValueError, TypeError, KeyError) as exc:
                    result["contract_error"] = str(exc)
                    if attempt:
                        failure = ContractError("语义计划经一次重试后仍不合法：" + str(exc))
                        failure.attempts = attempts
                        raise failure from exc
                    messages += [{"role": "assistant", "content": result["raw"]},
                                 {"role": "user", "content": "输出未通过格式校验：" + str(exc) + "。请重新输出完整JSON。原文片段必须逐字复制，出现次数从0开始；不需动作时事件数组可以为空。保持对原输入的理解，不要增加新台词。"}]
            return {"ready": True, "semantic_plan": plan, "semantic_ms": (time.perf_counter() - started) * 1000,
                    "context_truncated": False, "planner_timing": {key: result[key] for key in ("input_tokens", "output_tokens", "generation_ms", "max_tokens_reached")},
                    "raw": result["raw"], "attempts": attempts, "contract_repairs": len(attempts)-1}
        finally:
            with self.guard:
                if self.active and self.active[1] is event:
                    self.active = None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device", choices=["cpu", "cuda"], default="cuda")
    parser.add_argument("--port", type=int, default=8768)
    parser.add_argument("--backend", choices=["native", "hf"], default="native")
    args = parser.parse_args()
    os.environ["HF_HUB_OFFLINE"] = "1"
    if args.backend == "native":
        from .native import NativeModel
        backend = NativeModel(args.device)
    else:
        backend = LocalHF(ROOT / "models/Qwen3.5-4B", args.device, 8, 4096, constrained=True)
    runtime = SemanticRuntime(backend)
    folder = ROOT / ".runtime/semantic"
    folder.mkdir(parents=True, exist_ok=True)
    try:
        warmup = runtime.plan({"text": "文件已经保存。", "context": "平静汇报文件状态。", "session_id": "warmup"})
    except ContractError as exc:
        warmup = {"semantic_ms": None, "contract_error": str(exc), "attempts": runtime.last_attempts}
    (folder / "warmup.json").write_text(json.dumps(warmup, ensure_ascii=False, indent=2), encoding="utf-8")

    class Handler(BaseHTTPRequestHandler):
        def send(self, code, value):
            raw = json.dumps(value, ensure_ascii=False, allow_nan=False).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            try:
                self.wfile.write(raw)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def do_GET(self):
            self.send(200, runtime.info()) if self.path in ("/health", "/stream/status") else self.send(404, {"error": "not_found"})

        def do_POST(self):
            if self.path not in ("/stream/prefill", "/semantic/cancel"):
                return self.send(404, {"error": "not_found"})
            data = {}
            try:
                size = int(self.headers.get("Content-Length", 0))
                if not 0 < size < 128000:
                    raise ContractError("请求大小不合法")
                data = json.loads(self.rfile.read(size))
                if not isinstance(data, dict):
                    raise ContractError("请求必须为对象")
                if self.path == "/semantic/cancel":
                    return self.send(200, runtime.cancel(data.get("session_id")))
                if not runtime.lock.acquire(blocking=False):
                    return self.send(429, {"error": "语义模型正在规划"})
                try:
                    result = runtime.plan(data)
                    name = hashlib.sha256((str(time.time_ns()) + data.get("text", "")).encode()).hexdigest()[:20]
                    (folder / (name + ".json")).write_text(json.dumps({"request": data, "result": result}, ensure_ascii=False, indent=2), encoding="utf-8")
                    self.send(200, result)
                finally:
                    runtime.lock.release()
            except (ValueError, TypeError, RuntimeError, KeyError) as exc:
                if getattr(exc, "attempts", None):
                    (folder / ("failed-" + str(time.time_ns()) + ".json")).write_text(json.dumps({"request": data, "error": str(exc), "attempts": exc.attempts}, ensure_ascii=False, indent=2), encoding="utf-8")
                self.send(400, {"error": str(exc)})

    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    ready = ROOT / ".runtime/latent-ready.json"
    ready.write_text(json.dumps({"pid": os.getpid(), **runtime.info()}, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({**runtime.info(), "warmup_ms": warmup["semantic_ms"]}, ensure_ascii=False), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
