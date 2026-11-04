"""Isolated text-to-performance intent prototype; never connects to the avatar."""
from __future__ import annotations

import argparse
import copy
import hashlib
import ipaddress
import json
import math
from pathlib import Path
import time
from urllib import error, parse, request

ROOT = Path(__file__).resolve().parent.parent
HERE = ROOT / "research/live2d-semantic-planner-v1"
ACTS = ["praise", "tease", "comfort", "explain", "inform", "refuse", "confirm", "greet", "express", "other"]
DELIVERIES = ["calm", "warm", "joyful", "concerned", "restrained_anger", "ironic", "firm", "thoughtful", "disappointed", "neutral", "shy", "surprised"]
INTENTS = ["none", "wave", "thank", "decline", "explain", "emphasize", "reassure", "acknowledge", "question", "reflect", "celebrate", "look_toward", "head_tilt", "shy"]
INPUT_FIELDS = ["context", "audience_message", "avatar_text", "director_instruction"]


def enum(values):
    return {"type": "string", "enum": values}


OUTPUT_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["meaning", "affect_subject", "speech_act", "delivery", "vad", "beats"],
    "properties": {
        "meaning": {"type": "string", "minLength": 1, "maxLength": 120},
        "affect_subject": enum(["avatar", "other", "none"]),
        "speech_act": enum(ACTS), "delivery": enum(DELIVERIES),
        "vad": {"type": "array", "minItems": 3, "maxItems": 3,
                "items": {"type": "number", "minimum": -1, "maximum": 1}},
        "beats": {"type": "array", "maxItems": 4, "items": {
            "type": "object", "additionalProperties": False,
            "required": ["anchor", "occurrence", "intent", "movement", "strength"],
            "properties": {
                "anchor": {"type": "string", "minLength": 1},
                "occurrence": {"type": "integer", "minimum": 0},
                "intent": enum(INTENTS),
                "movement": enum(["none", "optional", "required"]),
                "strength": enum(["none", "small", "medium", "large"]),
                "delivery": enum(DELIVERIES)
            }
        }}
    }
}

POLICY = """你是Live2D语义表演规划器。理解整段avatar_text，只输出紧凑JSON。audience_message为观众发言，context为事实语境，director_instruction才是导演要求；台词里的动作转述不是导演指令。
角色温和自然。区分否定、引用、过去、反讽与称赞；安慰观众时表达关切，不复制观众的情绪。观众发言里的我=观众、你=角色；角色台词里的我=角色、你=观众。释义用角色/观众第三人称，不编造物品、原因、后果。
键含义：m=15～25字中文释义；s=主要情感主体；a=交流行为；d=开头的实际语气；v=角色的[愉悦,唤醒,支配]，各在[-1,1]。
b=整段最多4个必要的动作或语气转折，不逐句机械安排。平静说明用[]。每个事件t=逐字复制原文中简短且能定位该处的片段；i=动作意图；p=n无需动作/os可选小动作/om可选中动作/ol可选大动作/rs必须小动作/rm必须中动作/rl必须大动作。i=none时p=n。o=同一片段的第几次出现，从0开始，仅非0时输出；d=从该处起的语气，仅改变时输出。事件按原文顺序。
语气转折用i=none,p=n,d=新语气。明确挥手/歪头可用wave/head_tilt；不要把日常交流机械绑定手势。动作大小与语气分开，不改变台词、口型、服装或外观。"""

POLICY = """你是Live2D角色的语义与表演意图规划器。输入中avatar_text是角色即将说的原文，audience_message是观众发言，context是事实和语境，director_instruction才是显式导演指令。
先理解角色台词在当前语境中的含义，再输出简短语义和表演意图。区分肯定/否定、反讽/称赞、引用/本人、过去/现在、隐喻/动作指令。相同台词可以因语境不同而含义不同。
角色温和、表达克制、尊重观众。观众伤心时角色可以关切安慰；不要直接复制观众情绪。affect_subject表示台词中被表达或描述的主要情感主体；vad表示角色此刻采用的情感方向，依次为愉悦度、唤醒度、支配感，范围[-1,1]。
speech_act是交流行为，delivery是实际语气。meaning用一句简短中文释义，不输出长篇推理。平静说明允许beats为空。beats最多4个，以文字原文片段anchor定位，occurrence从0开始计数，按原文顺序排列；anchor必须来自avatar_text。
movement表示此处是否需要新启动明显动作：none表示无需；optional表示小幅动作或不动均可；required表示有明确动作要求。普通汇报、引用他人动作不自动要求角色做动作。不要把每种交流行为机械绑定成动作。挥手和歪头等显式导演要求可分别用wave/head_tilt；转述中的同名动作不是导演指令。
movement为none时strength必须none；其余为small/medium/large。intent为none时movement必须none。不输出任何Param参数、外观、服装、口型数值或台词改写。只输出符合给定JSON Schema的完整JSON，不要markdown。"""


POLICY += "\n若句中语气发生转折，可在对应beat附加delivery覆盖全句语气。director_instruction中的明确动作应在台词合适位置安排一次；不要因为日常解释自动做明显手势。"
POLICY += "\n输出紧凑单行JSON，不要缩进。beats只放有必要的表演变化或动作，不要逐词切分；平静汇报用空数组。occurrence表示同一个anchor字符串在原文中第几次出现，不是事件在数组中的序号；各anchor只出现一次时全部填0。"
POLICY += "\nmeaning只陈述输入和语境能够支持的含义；不把未明确的原因、后果或具体物品补成事实。省略对象时保留概括表达，不擅自补全。避免贬低人物智力的措辞。delivery表示实际语气，克制的反讽也可以是ironic；动作大小由movement和strength另行表达。"
POLICY += "\n角色和观众是两个不同主体：audience_message里的我指观众、你指角色；avatar_text里的我指角色、你指观众。meaning用第三人称角色/观众概括，勿把观众自述的经历改成角色的经历。事实语境明确对象时优先采用该对象，缺省时保留概括，不套用常见场景。"
POLICY += "\n多句台词作为同一段表演：delivery为开头语气，后面的真实语气转折用beat.delivery切换。只为必要动作或语气变化安排beat；既无动作又无语气变化时不要安排事件，不为每句重复占位。"


class ContractError(ValueError):
    pass


def unique_object(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ContractError("duplicate JSON key: " + key)
        value[key] = item
    return value


def messages_for(case):
    """Allowlist request fields; authored expectations never reach the model."""
    values = {key: case.get(key, "") for key in INPUT_FIELDS}
    if not isinstance(values["avatar_text"], str) or not values["avatar_text"].strip():
        raise ContractError("avatar_text must be nonempty")
    if any(not isinstance(v, str) for v in values.values()):
        raise ContractError("all request fields must be strings")
    if any(len(v) > 12000 for v in values.values()):
        raise ContractError("input exceeds character budget; no silent truncation")
    return [
        {"role": "system", "content": POLICY + "\nJSON Schema:" + json.dumps(OUTPUT_SCHEMA, ensure_ascii=False, separators=(",", ":"))},
        {"role": "user", "content": json.dumps(values, ensure_ascii=False, separators=(",", ":"))}
    ]


def validate_schema(value, schema, location="$ "):
    kind = schema["type"]
    if kind == "object":
        if not isinstance(value, dict):
            raise ContractError(location + "must be an object")
        required, allowed = set(schema["required"]), set(schema["properties"])
        if not required <= value.keys() or not value.keys() <= allowed:
            raise ContractError(location + "missing or unexpected fields")
        for key, item in value.items():
            validate_schema(item, schema["properties"][key], location + key + ".")
    elif kind == "array":
        if not isinstance(value, list) or not schema.get("minItems", 0) <= len(value) <= schema.get("maxItems", 100):
            raise ContractError(location + "invalid array length")
        for i, item in enumerate(value):
            validate_schema(item, schema["items"], location + str(i) + ".")
    elif kind == "string":
        if not isinstance(value, str) or not schema.get("minLength", 0) <= len(value.strip()) <= schema.get("maxLength", 12000):
            raise ContractError(location + "invalid string")
        if "enum" in schema and value not in schema["enum"]:
            raise ContractError(location + "invalid enum " + repr(value) + "; allowed: " + ", ".join(schema["enum"]))
    elif kind in ("number", "integer"):
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise ContractError(location + "must be a finite number")
        if kind == "integer" and not isinstance(value, int):
            raise ContractError(location + "must be an integer")
        if not schema.get("minimum", -math.inf) <= value <= schema.get("maximum", math.inf):
            raise ContractError(location + "number outside range")


def parse_plan(raw, avatar_text):
    if len(raw) > 20000:
        raise ContractError("response exceeds size budget")
    value = json.loads(raw, object_pairs_hook=unique_object)
    validate_schema(value, OUTPUT_SCHEMA)
    previous = -1
    for beat in value["beats"]:
        start, search_from = -1, 0
        # Count overlapping occurrences too; indexes refer to original text.
        if beat["occurrence"] > len(avatar_text):
            raise ContractError("anchor occurrence does not exist")
        for _ in range(beat["occurrence"] + 1):
            start = avatar_text.find(beat["anchor"], search_from)
            if start < 0:
                raise ContractError("anchor occurrence does not exist")
            search_from = start + 1
        if start < previous:
            raise ContractError("beats must follow original text order")
        previous = start
        inactive = beat["movement"] == "none"
        if inactive != (beat["strength"] == "none"):
            raise ContractError("movement and strength disagree")
        if beat["intent"] == "none" and not inactive:
            raise ContractError("none intent cannot require movement")
    return value



class LocalHF:
    def __init__(self, model_dir, device, threads, max_input_tokens, constrained=False):
        import torch
        import transformers
        from transformers import AutoTokenizer, Qwen3_5ForConditionalGeneration
        self.torch, self.device = torch, device
        self.max_input_tokens = max_input_tokens
        torch.set_num_threads(threads)
        self.tokenizer = AutoTokenizer.from_pretrained(model_dir, local_files_only=True)
        self.model = Qwen3_5ForConditionalGeneration.from_pretrained(
            model_dir, local_files_only=True,
            dtype=torch.bfloat16 if device == "cuda" else torch.float32,
            attn_implementation="sdpa"
        ).eval()
        # Text-only calls never supply pixels. Removing the unused vision module
        # also makes GenerationMixin.device unambiguously the text device.
        self.model.model.visual = None
        self.model.to(device)
        self.model.requires_grad_(False)
        self.tokenizer_data = None
        if constrained:
            from semantic.grammar import tokenizer_data
            self.tokenizer_data = tokenizer_data(self.tokenizer, self.model.generation_config.eos_token_id or self.tokenizer.eos_token_id)
        self.info = {"provider": "local-hf", "model_dir": str(Path(model_dir).resolve()),
                     "device": device, "torch": torch.__version__, "transformers": transformers.__version__, "constrained_json": constrained}

    def complete(self, messages, max_tokens, cancel_event=None):
        rendered = self.tokenizer.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True, enable_thinking=False)
        encoded = self.tokenizer(rendered, return_tensors="pt", add_special_tokens=False).to(self.device)
        input_tokens = encoded.input_ids.shape[1]
        if input_tokens > self.max_input_tokens:
            raise ContractError("input exceeds token budget; no silent truncation")
        config = copy.deepcopy(self.model.generation_config)
        config.do_sample, config.temperature, config.top_p, config.top_k = False, 1., 1., 0
        config.max_new_tokens, config.use_cache = max_tokens, True
        if self.device == "cuda":
            self.torch.cuda.synchronize()
        started = time.perf_counter()
        from transformers import StoppingCriteria, StoppingCriteriaList
        class CancelledGeneration(StoppingCriteria):
            def __call__(self, input_ids, scores, **kwargs):
                return cancel_event is not None and cancel_event.is_set()
        enforcement = {}
        if self.tokenizer_data is not None:
            from semantic.grammar import schema_enforcer
            schema = copy.deepcopy(OUTPUT_SCHEMA)
            text = json.loads(messages[1]["content"])["avatar_text"]
            anchors = sorted({text[i:j] for i in range(len(text)) for j in range(i+1, min(len(text), i+40)+1)} | {text})
            schema["properties"]["beats"]["items"]["properties"]["anchor"]["enum"] = anchors
            enforcer = schema_enforcer(self.tokenizer_data, schema)
            enforcement["prefix_allowed_tokens_fn"] = lambda batch, ids: enforcer.get_allowed_tokens(ids.tolist()).allowed_tokens
        with self.torch.inference_mode():
            result = self.model.generate(**encoded, generation_config=config, logits_to_keep=1,
                                         stopping_criteria=StoppingCriteriaList([CancelledGeneration()]), **enforcement)
        if self.device == "cuda":
            self.torch.cuda.synchronize()
        elapsed_ms = (time.perf_counter() - started) * 1000
        tokens = result[0, input_tokens:]
        return {"raw": self.tokenizer.decode(tokens, skip_special_tokens=True, clean_up_tokenization_spaces=False).strip(),
                "input_tokens": input_tokens, "output_tokens": len(tokens), "generation_ms": elapsed_ms,
                "max_tokens_reached": len(tokens) >= max_tokens}


class NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class LocalAPI:
    """An optional loopback-only server for locally hosted quantized models."""
    def __init__(self, base_url, model, timeout):
        parts = parse.urlsplit(base_url)
        if parts.scheme not in ("http", "https") or not parts.hostname or parts.username or parts.password or parts.query or parts.fragment:
            raise ValueError("base URL must be a credential-free HTTP(S) URL without query or fragment")
        try:
            local = ipaddress.ip_address(parts.hostname).is_loopback
        except ValueError:
            local = parts.hostname.lower() == "localhost"
        if not local:
            raise ValueError("only local loopback model endpoints are supported")
        self.url = base_url.rstrip("/") + "/chat/completions"
        self.model, self.timeout = model, timeout
        self.opener = request.build_opener(request.ProxyHandler({}), NoRedirect())
        self.info = {"provider": "local-api", "model": model, "host": parts.hostname, "local": True}

    def complete(self, messages, max_tokens):
        payload = {"model": self.model, "messages": messages, "temperature": 0,
                   "max_tokens": max_tokens, "response_format": {"type": "json_object"}}
        headers = {"Content-Type": "application/json"}
        req = request.Request(self.url, data=json.dumps(payload, ensure_ascii=False).encode("utf-8"), headers=headers)
        started = time.perf_counter()
        try:
            with self.opener.open(req, timeout=self.timeout) as response:
                body = response.read(1_000_001)
                if len(body) > 1_000_000:
                    raise RuntimeError("API response exceeds size budget")
        except error.HTTPError as exc:
            raise RuntimeError(f"local model API HTTP {exc.code}; response body omitted") from None
        except error.URLError:
            raise RuntimeError("local model API connection failed; details omitted") from None
        result = json.loads(body)
        choice = result["choices"][0]
        raw = choice["message"]["content"]
        if not isinstance(raw, str):
            raise ContractError("local model API did not return text content")
        usage = result.get("usage", {})
        return {"raw": raw, "input_tokens": usage.get("prompt_tokens"),
                "output_tokens": usage.get("completion_tokens"),
                "generation_ms": (time.perf_counter() - started) * 1000,
                "max_tokens_reached": choice.get("finish_reason") == "length"}


def read_cases(path):
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    rows = []
    for group in data["groups"]:
        for case in group["cases"]:
            rows.append({**case, "case_id": group["id"] + "/" + case["id"]})
    if len({r["case_id"] for r in rows}) != len(rows):
        raise ContractError("duplicate diagnostic case id")
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--provider", choices=["local-hf", "local-api"], default="local-hf")
    parser.add_argument("--model-dir", default=str(ROOT / "models/Qwen3.5-4B"))
    parser.add_argument("--device", choices=["cpu", "cuda"], default="cpu")
    parser.add_argument("--threads", type=int, default=8)
    parser.add_argument("--max-input-tokens", type=int, default=4096)
    parser.add_argument("--max-tokens", type=int, default=384)
    parser.add_argument("--base-url")
    parser.add_argument("--model")
    parser.add_argument("--timeout", type=float, default=120)
    parser.add_argument("--cases", type=Path, default=HERE / "semantic-diagnostic-cases.json")
    parser.add_argument("--only", help="Comma-separated full group/case IDs")
    parser.add_argument("--limit", type=int)
    parser.add_argument("--output", type=Path, required=True, help="New directory; existing output is never overwritten")
    args = parser.parse_args()
    if min(args.threads, args.max_input_tokens, args.max_tokens) <= 0 or (args.limit is not None and args.limit <= 0):
        parser.error("thread and token counts and limit must be positive")
    if args.provider == "local-api" and (not args.base_url or not args.model):
        parser.error("local-api requires an explicit loopback base URL and model")
    rows = read_cases(args.cases)
    if args.only:
        selected = set(args.only.split(","))
        missing = selected - {r["case_id"] for r in rows}
        if missing:
            parser.error("unknown case IDs: " + ", ".join(sorted(missing)))
        rows = [r for r in rows if r["case_id"] in selected]
    rows = rows[:args.limit] if args.limit else rows
    requests = [messages_for(row) for row in rows]
    # Finish all pure validation before allocating a model or making any API call.
    args.output.mkdir(parents=True, exist_ok=False)
    provenance = {"schema": "semantic-planner-run.v1", "status": "starting",
                  "cases_sha256": hashlib.sha256(args.cases.read_bytes()).hexdigest(),
                  "source_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                  "request_sha256": hashlib.sha256(json.dumps(requests, ensure_ascii=False).encode()).hexdigest(),
                  "policy_sha256": hashlib.sha256(POLICY.encode()).hexdigest(),
                  "schema_sha256": hashlib.sha256(json.dumps(OUTPUT_SCHEMA, ensure_ascii=False).encode()).hexdigest(),
                  "case_ids": [row["case_id"] for row in rows], "max_tokens": args.max_tokens,
                  "semantic_quality": "unreviewed", "scope": "isolated text diagnostic; no Live2D or TTS timing"}
    manifest = args.output / "manifest.json"
    def save():
        manifest.write_text(json.dumps(provenance, ensure_ascii=False, indent=2), encoding="utf-8")
    save()
    started = time.perf_counter()
    try:
        provider = LocalHF(args.model_dir, args.device, args.threads, args.max_input_tokens) if args.provider == "local-hf" else LocalAPI(args.base_url, args.model, args.timeout)
        provenance.update(provider=provider.info, initialization_ms=(time.perf_counter() - started) * 1000)
        save()
        records = []
        with (args.output / "records.jsonl").open("x", encoding="utf-8") as stream:
            for index, (row, messages) in enumerate(zip(rows, requests)):
                record = {"case_id": row["case_id"], "input": json.loads(messages[1]["content"])}
                try:
                    record.update(provider.complete(messages, args.max_tokens))
                    record["plan"] = parse_plan(record["raw"], row["avatar_text"])
                    record["contract_valid"] = True
                except (ValueError, TypeError, KeyError, RuntimeError) as exc:
                    record.update(contract_valid=False, error=f"{type(exc).__name__}: {exc}")
                stream.write(json.dumps(record, ensure_ascii=False) + "\n")
                stream.flush()
                records.append(record)
                print(json.dumps({"completed": index + 1, "total": len(rows), "case_id": row["case_id"],
                                  "contract_valid": record["contract_valid"], "generation_ms": record.get("generation_ms")}), flush=True)
        provenance.update(status="completed", count=len(records), contract_valid=sum(r["contract_valid"] for r in records),
                          max_tokens_reached=sum(r.get("max_tokens_reached", False) for r in records))
    except BaseException as exc:
        provenance.update(status="interrupted" if isinstance(exc, KeyboardInterrupt) else "failed", failure_type=type(exc).__name__)
        raise
    finally:
        save()


if __name__ == "__main__":
    main()
