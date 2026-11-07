"""Single Python reader for the emotion contract.

The only sources of truth are ``contracts/emotion-config.json`` (labels, gains,
VAD presets, curve/expression policy, 64-dim affect layout) and the pinned
classifier's published ``thresholds.json``.  No label list is duplicated here.
"""
import hashlib
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "contracts/emotion-config.json"
THRESHOLDS_PATH = ROOT / "models/multilingual-emotions-base/thresholds.json"
SOURCE_PATH = ROOT / "latent/emotion-source.json"


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _finite(value, lo=None, hi=None):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(float(value)) and (lo is None or float(value) >= lo) and (hi is None or float(value) <= hi)


def _load():
    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    if not isinstance(config, dict) or config.get("schema") != "emotion.config.v1":
        raise ValueError("emotion-config: 未知 schema")
    labels = config.get("labels")
    if not isinstance(labels, list) or len(labels) != 28 or len(set(labels)) != 28 or not all(isinstance(label, str) and label for label in labels):
        raise ValueError("emotion-config: 需要 28 个唯一情绪标签")
    vad = config.get("vad_presets")
    if not isinstance(vad, dict) or set(vad) != set(labels):
        raise ValueError("emotion-config: vad_presets 必须覆盖全部标签")
    for label, vector in vad.items():
        if not isinstance(vector, list) or len(vector) != 3 or not all(_finite(v, -1, 1) for v in vector):
            raise ValueError(f"emotion-config: {label} 的 VAD 预设不合法")
    curve = config.get("curve")
    if not isinstance(curve, dict) or curve.get("spring") != "critically_damped":
        raise ValueError("emotion-config: 只支持临界阻尼曲线")
    for key in ("response_attack_ms", "response_release_ms", "reversal_release_ms", "mood_attack_ms", "mood_release_ms"):
        if not _finite(curve.get(key), 1e-6):
            raise ValueError(f"emotion-config: curve.{key} 不合法")
    if not _finite(curve.get("response_mix"), 0, 1):
        raise ValueError("emotion-config: curve.response_mix 不合法")
    affect = config.get("affect")
    if not isinstance(affect, dict):
        raise ValueError("emotion-config: 缺少 affect 布局")
    expected = {"fast": 28, "slow": 28, "tension": 1, "vad": 3, "intensity": 1, "style": 3, "dim": 64}
    for key, value in expected.items():
        if affect.get(key) != value:
            raise ValueError(f"emotion-config: affect.{key} 应为 {value}")
    styles = affect.get("styles")
    if not isinstance(styles, list) or len(styles) != 3 or len(set(styles)) != 3:
        raise ValueError("emotion-config: affect.styles 需要 3 个互异风格")
    motion = config.get("motion")
    if not isinstance(motion, dict):
        raise ValueError("emotion-config: 缺少 motion 策略")
    for key in ("evaluate_ms", "arm_threshold", "body_threshold", "same_action_window_ms"):
        if not _finite(motion.get(key)):
            raise ValueError(f"emotion-config: motion.{key} 不合法")
    return config


CONFIG = _load()
SCHEMA = CONFIG["schema"]
LABELS = tuple(CONFIG["labels"])
LABEL_SET = frozenset(LABELS)
LABEL_INDEX = {label: index for index, label in enumerate(LABELS)}
EVIDENCE_GAIN = {label: float(value) for label, value in (CONFIG.get("gains") or {}).items()}
EVIDENCE_SCALE = float(CONFIG.get("evidence", {}).get("scale", .9))
EVIDENCE_MIN_SPAN = float(CONFIG.get("evidence", {}).get("minimum_threshold_span", .001))
CURVE = CONFIG["curve"]
EXPRESSION = CONFIG.get("expression") or {}
AFFECT = CONFIG["affect"]
AFFECT_DIM = int(AFFECT["dim"])
STYLES = tuple(AFFECT["styles"])
MOTION = CONFIG["motion"]
VAD_PRESETS = {label: tuple(float(value) for value in CONFIG["vad_presets"][label]) for label in LABELS}

RESPONSE_ATTACK_S = float(CURVE["response_attack_ms"]) / 1000.
RESPONSE_RELEASE_S = float(CURVE["response_release_ms"]) / 1000.
REVERSAL_RELEASE_S = float(CURVE["reversal_release_ms"]) / 1000.
MOOD_ATTACK_S = float(CURVE["mood_attack_ms"]) / 1000.
MOOD_RELEASE_S = float(CURVE["mood_release_ms"]) / 1000.
RESPONSE_MIX = float(CURVE["response_mix"])
SWITCH_MARGIN = float(CURVE.get("switch_margin", .07))
SWITCH_DWELL_MS = float(CURVE.get("switch_dwell_ms", 350))
INITIAL_DWELL_MS = float(CURVE.get("initial_dwell_ms", 180))
MIN_SWITCH_MS = float(CURVE.get("minimum_switch_ms", 500))
CLOCK = CURVE.get("clock", "audio")
HORIZON = 24
UPDATE_MS = int(MOTION.get("evaluate_ms", 200))
NO_ACTION_ID = "none"


def emotion_config_sha256():
    return sha(CONFIG_PATH)


def load_thresholds(path=THRESHOLDS_PATH):
    """Published per-label validation thresholds from the pinned model folder."""
    thresholds = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(thresholds, dict) or set(thresholds) != set(LABELS):
        raise ValueError("emotion thresholds 必须覆盖全部 28 个契约标签")
    for label, value in thresholds.items():
        if not _finite(value, 0, 1):
            raise ValueError(f"emotion thresholds.{label} 不合法")
    return {label: float(thresholds[label]) for label in LABELS}


def thresholds_sha256(path=THRESHOLDS_PATH):
    return sha(path)


THRESHOLDS = load_thresholds()


def evidence(probabilities, thresholds=None):
    """Continuous per-label evidence: gain * scale * sqrt(margin), never a calibrated intensity."""
    thresholds = THRESHOLDS if thresholds is None else thresholds
    result = {}
    for label in LABELS:
        probability = float(probabilities.get(label, 0.) or 0.)
        if probability < 0.:
            probability = 0.
        threshold = float(thresholds[label])
        span = max(EVIDENCE_MIN_SPAN, 1. - threshold)
        margin = max(0., probability - threshold) / span
        value = EVIDENCE_GAIN.get(label, 1.) * EVIDENCE_SCALE * math.sqrt(margin)
        result[label] = min(1., max(0., value))
    return result


def build_affect_vector(response, mood, tension, vad, intensity, style):
    """The exact 64-dim layout: 28 fast reaction + 28 slow mood + 1 + 3 + 1 + 3."""
    if style not in STYLES:
        raise ValueError(f"未知风格：{style}")
    if not _finite(tension) or not _finite(intensity):
        raise ValueError("affect 的 tension/intensity 不合法")
    if not isinstance(vad, (list, tuple)) or len(vad) != 3 or not all(_finite(v, -1, 1) for v in vad):
        raise ValueError("affect 的 VAD 不合法")
    vector = []
    for label in LABELS:
        value = float(response.get(label, 0.) or 0.)
        if not _finite(value):
            raise ValueError("affect response 不合法")
        vector.append(min(1., max(0., value)))
    for label in LABELS:
        value = float(mood.get(label, 0.) or 0.)
        if not _finite(value):
            raise ValueError("affect mood 不合法")
        vector.append(min(1., max(0., value)))
    vector.append(min(1., max(0., float(tension))))
    vector.extend(min(1., max(-1., float(v))) for v in vad)
    vector.append(min(1., max(0., float(intensity))))
    vector.extend(1. if style == name else 0. for name in STYLES)
    if len(vector) != AFFECT_DIM:
        raise ValueError(f"affect 向量维度错误：{len(vector)}/{AFFECT_DIM}")
    return vector


def validate_affect_vector(value):
    """Strict layout validation shared by runtime and tests."""
    if not isinstance(value, (list, tuple)) or len(value) != AFFECT_DIM:
        raise ValueError(f"affect 需要 {AFFECT_DIM} 个数值")
    fast, slow = int(AFFECT["fast"]), int(AFFECT["slow"])
    tension = fast + slow
    vad = tension + int(AFFECT["tension"])
    intensity = vad + int(AFFECT["vad"])
    vector = []
    for index, item in enumerate(value):
        if not _finite(item):
            raise ValueError("affect 含非有限数值")
        number = float(item)
        low, high = (-1., 1.) if vad <= index < intensity else (0., 1.)
        if not low <= number <= high:
            raise ValueError("affect 数值超出布局范围")
        vector.append(number)
    style = vector[intensity + int(AFFECT["intensity"]):]
    if abs(sum(style) - 1.) > 1e-6:
        raise ValueError("affect style 必须是 one-hot")
    if len(style) != int(AFFECT["style"]):
        raise ValueError("affect style 维度错误")
    return vector
