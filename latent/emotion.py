"""Quote-aware emotion observations and the raw 28-label classifier.

The output of this module is an ``emotion.timeline.v2``: every texture window
of the spoken text (from ``emotion_spans``) carries the raw 28 sigmoid scores
of its own quote-aware window input (from ``emotion_inputs``).  There is no
six-class normalisation and no avatar-adapter heuristic here any more; the
browser owns rendering and the learned heads own motion.
"""
import json
import math
import time
from copy import deepcopy
from pathlib import Path

import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer

from common import ROOT, sha
from emotion_config import LABELS, THRESHOLDS, load_thresholds

TIMELINE_SCHEMA = "emotion.timeline.v2"
SOURCE_PATH = ROOT / "latent/emotion-source.json"
PAIRS = {"“": "”", "‘": "’", "「": "」", "『": "』", '"': '"', "（": "）", "(": ")"}
QUOTE_PAIRS = {"“": "”", "‘": "’", "「": "」", "『": "』", '"': '"'}


def emotion_spans(text):
    """Phrase observations; quoted speech stays whole and is never rewritten."""
    if not isinstance(text, str):
        raise ValueError("台词必须是字符串")
    spans = []
    start = 0
    stack = []
    quoted = False
    for index, char in enumerate(text):
        if stack and char == stack[-1]:
            stack.pop()
        elif char in PAIRS:
            stack.append(PAIRS[char])
            quoted = True
        if stack:
            continue
        end = index + 1
        sentence = char in "。！？!?；;\n"
        phrase = char in "，,、" and not quoted and end - start >= 6
        window = end - start >= 64 and not quoted
        if sentence or phrase or window:
            spans.append({"text": text[start:end].strip(), "start": start, "end": end})
            start = end
            quoted = False
    if start < len(text):
        spans.append({"text": text[start:].strip(), "start": start, "end": len(text)})
    # Whitespace is retained in the surrounding interval, never an empty model input.
    result = []
    for span in spans:
        if not span["text"] and result:
            result[-1]["end"] = span["end"]
        elif span["text"]:
            if not result:
                span["start"] = 0
            result.append(span)
    return result


def emotion_inputs(text, observations, previous=""):
    """Causal local context only: earlier words never see later phrases."""
    prior = emotion_spans(previous) if previous else []
    windows = []
    for index, span in enumerate(observations):
        if index:
            windows.append(text[observations[index - 1]["start"]:span["end"]].strip())
        elif prior:
            windows.append("\n".join([prior[-1]["text"], span["text"]]).strip())
        else:
            windows.append(span["text"])
    return windows


def speaker_text(text):
    """Quoted material is reported speech, not automatically the avatar's affect."""
    stack = []
    out = []
    for char in text:
        if stack:
            if char == stack[-1]:
                stack.pop()
            elif char in QUOTE_PAIRS and char != '"':
                stack.append(QUOTE_PAIRS[char])
        elif char in QUOTE_PAIRS:
            stack.append(QUOTE_PAIRS[char])
        else:
            out.append(char)
    return "".join(out).strip()


def observations(text, previous=""):
    return emotion_spans(text), emotion_inputs(text, emotion_spans(text), previous)


def build_timeline(text, observations, windows, classified, thresholds=None):
    """Assemble and validate a v2 timeline from classified windows."""
    thresholds = thresholds or THRESHOLDS
    if not isinstance(text, str) or not text.strip():
        raise ValueError("台词不能为空或只有空白")
    if len(observations) != len(windows) or len(observations) != len(classified):
        raise ValueError("时间轴观测、窗口与分类结果数量不一致")
    points = []
    for span, window, result in zip(observations, windows, classified):
        probabilities = result.get("probabilities") or {}
        if probabilities and set(probabilities) != set(LABELS):
            raise ValueError("分类结果必须覆盖全部 28 个标签")
        points.append({
            "text": span["text"],
            "window_text": window,
            "start": span["start"],
            "end": span["end"],
            "start_fraction": span["start"] / len(text),
            "probabilities": {label: float(probabilities[label]) for label in LABELS} if probabilities else {},
            "policy_default": bool(result.get("policy_default", not probabilities)),
            "quoted_text_excluded": bool(result.get("quoted_text_excluded", False)),
        })
    timeline = {"schema": TIMELINE_SCHEMA, "labels": list(LABELS), "thresholds": dict(thresholds), "points": points}
    validate_timeline(timeline, text)
    return timeline


def validate_timeline(value, text):
    """Mirror of the browser validator for the fields the runtime depends on."""
    if not isinstance(text, str) or not text.strip():
        raise ValueError("台词不能为空或只有空白")
    if not isinstance(value, dict) or value.get("schema") != TIMELINE_SCHEMA:
        raise ValueError("时间轴 schema 不合法")
    if value.get("labels") != list(LABELS):
        raise ValueError("时间轴标签必须与契约顺序一致")
    thresholds = value.get("thresholds")
    if not isinstance(thresholds, dict) or set(thresholds) != set(LABELS) or not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(float(v)) and 0 <= float(v) <= 1 for v in thresholds.values()):
        raise ValueError("时间轴阈值不合法")
    points = value.get("points")
    if not isinstance(points, list) or not points or len(points) > 80:
        raise ValueError("时间轴点数不合法")
    end = 0
    for point in points:
        if not isinstance(point, dict):
            raise ValueError("时间轴点不合法")
        start, stop = point.get("start"), point.get("end")
        if not isinstance(start, int) or isinstance(start, bool) or not isinstance(stop, int) or isinstance(stop, bool):
            raise ValueError("时间轴偏移必须是整数")
        if start != end or stop <= start or stop > len(text):
            raise ValueError("时间轴点必须连续覆盖全文")
        if not isinstance(point.get("text"), str) or not point["text"] or text[start:stop].strip() != point["text"]:
            raise ValueError("时间轴文本与原文不匹配")
        window = point.get("window_text")
        if not isinstance(window, str) or len(window) > 512 or not window.endswith(point["text"]):
            raise ValueError("时间轴窗口不合法")
        fraction = point.get("start_fraction")
        if not isinstance(fraction, (int, float)) or not math.isfinite(float(fraction)) or abs(float(fraction) - start / len(text)) > 1e-7:
            raise ValueError("时间轴 start_fraction 不合法")
        probabilities = point.get("probabilities")
        if not isinstance(probabilities, dict) or set(probabilities) - set(LABELS):
            raise ValueError("时间轴概率键不合法")
        if point.get("policy_default"):
            if probabilities:
                raise ValueError("默认策略点不得携带分类概率")
        elif set(probabilities) != set(LABELS):
            raise ValueError("非默认点必须携带全部 28 个概率")
        if not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(float(v)) and 0 <= float(v) <= 1 for v in probabilities.values()):
            raise ValueError("时间轴概率必须是 0..1 的有限数值")
        end = stop
    if end != len(text):
        raise ValueError("时间轴必须覆盖到台词结尾")
    return value


class EmotionClassifier:
    """Pinned multi-label classifier over quote-aware windows only."""

    def __init__(self, source=SOURCE_PATH, device="cuda", thresholds_path=None):
        self.source = json.loads(Path(source).read_text(encoding="utf-8-sig"))
        self.device = device
        folder = ROOT / self.source["local_path"]
        for name, expected in self.source["files"].items():
            if not (folder / name).is_file() or sha(folder / name) != expected:
                raise ValueError("情感模型文件缺失或校验失败：" + name)
        self.tokenizer = AutoTokenizer.from_pretrained(folder, local_files_only=True, trust_remote_code=False)
        self.model = AutoModelForSequenceClassification.from_pretrained(
            folder, local_files_only=True, trust_remote_code=False,
            attn_implementation="sdpa", dtype=torch.float32,
        ).to(device).eval()
        self.model.requires_grad_(False)
        self.thresholds = load_thresholds(thresholds_path) if thresholds_path else dict(THRESHOLDS)
        self.cache = {}
        self.last_timing = {}
        self.parameters = sum(parameter.numel() for parameter in self.model.parameters())
        self.classify_many(["你好。", "我很开心。", "这个数字还没有填。"])

    @torch.inference_mode()
    def classify_many(self, texts):
        begin = time.perf_counter()
        missing = list(dict.fromkeys(text for text in texts if text not in self.cache))
        filtered = [speaker_text(text) for text in missing]
        if missing:
            nonempty = [value for value in filtered if value]
            rows = []
            if nonempty:
                encoded = self.tokenizer(nonempty, return_tensors="pt", padding=True, truncation=True, max_length=256).to(self.device)
                rows = self.model(**encoded).logits.sigmoid().float().cpu().tolist()
            predictions = iter(rows)
            for original, spoken in zip(missing, filtered):
                if spoken:
                    row = next(predictions)
                    tokens = len(self.tokenizer(spoken, add_special_tokens=True)["input_ids"])
                    self.cache[original] = {
                        "probabilities": {self.model.config.id2label[index]: float(row[index]) for index in range(len(LABELS))},
                        "policy_default": False,
                        "quoted_text_excluded": spoken != original.strip(),
                        "tokens": tokens,
                        "truncated": tokens > 256,
                    }
                else:
                    # No speaker-owned words: neutral policy without inventing a posterior.
                    self.cache[original] = {
                        "probabilities": {},
                        "policy_default": True,
                        "quoted_text_excluded": True,
                        "tokens": 0,
                        "truncated": False,
                    }
        results = [deepcopy(self.cache[text]) for text in texts]
        while len(self.cache) > 256:
            self.cache.pop(next(iter(self.cache)))
        self.last_timing = {"total_ms": (time.perf_counter() - begin) * 1000, "batch_size": len(texts), "uncached": len(missing)}
        return results

    def timeline(self, text, previous=""):
        spans, windows = observations(text, previous)
        classified = self.classify_many(windows)
        return build_timeline(text, spans, windows, classified, self.thresholds)

    def info(self):
        return {
            "model": self.source["repo_id"],
            "revision": self.source["revision"],
            "parameters": self.parameters,
            "device": self.device,
            "multi_label": True,
            "labels": list(LABELS),
            "threshold_source": "published per-label validation thresholds",
            "max_tokens": 256,
        }
