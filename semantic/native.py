"""Offline native inference, owned by the same Windows launcher as the app."""
import copy
import json
from pathlib import Path
import time
from urllib import error, request
from .planner import ROOT, OUTPUT_SCHEMA, LocalAPI, ContractError


def settings():
    return json.loads((ROOT / 'semantic/native-runtime.json').read_text(encoding='utf-8'))


def command(device='cuda'):
    config = settings()
    executable = Path(config['executable'])
    model = (ROOT / config['model']).resolve()
    if not executable.is_file() or not model.is_file():
        raise RuntimeError('本地专用推理引擎或 Q8_0 模型缺失，查看 semantic/native-runtime.json')
    if not model.is_relative_to(ROOT / 'models'):
        raise RuntimeError('语义模型必须位于项目 models 内')
    return [str(executable), '-m', str(model), '--alias', 'live2d-semantic-4b',
            '--host', '127.0.0.1', '--port', str(config['port']), '-c', '4096', '-np', '1',
            '-ngl', '0' if device == 'cpu' else '99', '-fa', 'on', '--jinja', '--chat-template-kwargs', '{"enable_thinking":false}',
            '--offline', '--no-webui']


class NativeModel(LocalAPI):
    def __init__(self, device='cuda'):
        config = settings()
        super().__init__('http://127.0.0.1:' + str(config['port']) + '/v1', 'live2d-semantic-4b', 120)
        self.info.update(provider='local-llama.cpp', device=device, quantization=config['quantization'],
                         revision=config['source_revision'], model_revision=config['model_source_revision'], constrained_json=True)

    def complete(self, messages, max_tokens, cancel_event=None):
        if cancel_event is not None and cancel_event.is_set():
            raise ContractError('会话已取消')
        payload = dict(model=self.model, messages=messages, temperature=0, top_k=1, repeat_penalty=1,
                       max_tokens=max_tokens, stream=True, stream_options={'include_usage': True},
                       chat_template_kwargs={'enable_thinking': False},
                       response_format={'type': 'json_object', 'schema': copy.deepcopy(OUTPUT_SCHEMA)})
        req = request.Request(self.url, json.dumps(payload, ensure_ascii=False).encode(), {'Content-Type': 'application/json'})
        started = time.perf_counter()
        parts, usage, finish, size = [], {}, None, 0
        try:
            with self.opener.open(req, timeout=self.timeout) as response:
                for line in response:
                    if cancel_event is not None and cancel_event.is_set():
                        raise ContractError('会话已取消')
                    if not line.startswith(b'data:'):
                        continue
                    data = line[5:].strip()
                    if data == b'[DONE]':
                        break
                    event = json.loads(data)
                    if event.get('error'):
                        raise RuntimeError('本地推理引擎生成失败')
                    usage = event.get('usage') or usage
                    for choice in event.get('choices', []):
                        part = choice.get('delta', {}).get('content') or ''
                        size += len(part)
                        if size > 20000:
                            raise ContractError('语义输出超过限制')
                        parts.append(part)
                        finish = choice.get('finish_reason') or finish
        except error.HTTPError as exc:
            raise RuntimeError('本地推理引擎 HTTP ' + str(exc.code)) from None
        except error.URLError:
            raise RuntimeError('本地推理引擎未连接') from None
        if finish is None:
            raise ContractError('语义流未完成')
        return dict(raw=''.join(parts), input_tokens=usage.get('prompt_tokens'), output_tokens=usage.get('completion_tokens'),
                    generation_ms=(time.perf_counter()-started)*1000, max_tokens_reached=finish == 'length')
