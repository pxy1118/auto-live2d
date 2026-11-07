"""Shared catalog validation. Model vocabulary is pinned by each checkpoint;
registering a runtime segment does not expand the trained output layer."""
import hashlib
import json
from pathlib import Path

from emotion_config import LABEL_SET

ROOT = Path(__file__).resolve().parents[1]
CATALOG_PATH = ROOT / "contracts/action-catalog.json"
SCHEMA = "action.catalog.v1"
KINDS = ("none", "gesture", "body", "segment")
GROUPS = ("arm", "body")


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _validate(value):
    if not isinstance(value, dict) or value.get("schema") != SCHEMA:
        raise ValueError("action-catalog: 未知 schema")
    actions = value.get("actions")
    if not isinstance(actions, list) or not actions:
        raise ValueError("action-catalog: actions 为空")
    ids = set()
    gesture_ids = set()
    body_ids = set()
    for action in actions:
        if not isinstance(action, dict):
            raise ValueError("action-catalog: 动作项不是对象")
        action_id = action.get("id")
        if not isinstance(action_id, str) or not action_id or action_id in ids:
            raise ValueError("action-catalog: id 重复或为空")
        ids.add(action_id)
        if action.get("kind") not in KINDS:
            raise ValueError(f"action-catalog: {action_id} kind 不合法")
        if action.get("cooldown_group") not in GROUPS:
            raise ValueError(f"action-catalog: {action_id} cooldown_group 不合法")
        if not isinstance(action.get("label"), str):
            raise ValueError(f"action-catalog: {action_id} label 不合法")
        variants = action.get("variants")
        if isinstance(variants, bool) or not isinstance(variants, int) or not 1 <= variants <= 3:
            raise ValueError(f"action-catalog: {action_id} variants 不合法")
        hold = action.get("default_hold_ms")
        if not _number(hold, 0, 8000):
            raise ValueError(f"action-catalog: {action_id} default_hold_ms 不合法")
        intensity = action.get("intensity")
        if not isinstance(intensity, list) or len(intensity) != 2 or not _number(intensity[0], 0, 1) or not _number(intensity[1], 0, 1) or intensity[0] > intensity[1]:
            raise ValueError(f"action-catalog: {action_id} intensity 不合法")
        phases = action.get("phases")
        if not isinstance(phases, list):
            raise ValueError(f"action-catalog: {action_id} phases 不合法")
        if action["kind"] == "gesture":
            gesture_ids.add(action_id)
        if action["kind"] == "body":
            body_ids.add(action_id)
        if action["kind"] == "segment":
            emotion = action.get("emotion")
            if not isinstance(emotion, str) or emotion not in LABEL_SET or emotion == "neutral":
                raise ValueError(f"action-catalog: {action_id} 需要非中性情绪标签")
            if not phases:
                raise ValueError(f"action-catalog: {action_id} 缺少 phases")
        if action["kind"] == "none" and action_id != "none":
            raise ValueError("action-catalog: none 动作只能叫 none")
        accents=action.get('eye_accents')
        if accents is not None and (not isinstance(accents,list) or len(accents)!=variants or any(v not in (None,'wink_left','wink_right','double_blink') for v in accents)):
            raise ValueError('action-catalog: eye accents 不合法')
        if 'repeat_window_ms' in action and not _number(action['repeat_window_ms'],0,60000):
            raise ValueError('action-catalog: repeat window 不合法')
        for phase in phases:
            if not isinstance(phase, dict) or not _number(phase.get("at_ms"), 0, action["default_hold_ms"] + 800):
                raise ValueError(f"action-catalog: {action_id} phase at_ms 不合法")
            if "gesture" in phase and phase["gesture"] not in gesture_ids:
                raise ValueError(f"action-catalog: {action_id} phase gesture 未知")
            if "body_motion" in phase and phase["body_motion"] not in body_ids:
                raise ValueError(f"action-catalog: {action_id} phase body_motion 未知")
            for key in ("gesture_variant", "body_variant"):
                if key in phase and (isinstance(phase[key], bool) or not isinstance(phase[key], int) or not 0 <= phase[key] <= 2):
                    raise ValueError(f"action-catalog: {action_id} {key} 不合法")
            for key in ("gesture_hold_ms", "body_hold_ms"):
                if key in phase and not _number(phase[key], 0, 6000):
                    raise ValueError(f"action-catalog: {action_id} {key} 不合法")
            for key in ("gesture_strength", "body_strength"):
                if key in phase and not _number(phase[key], 0, 1):
                    raise ValueError(f"action-catalog: {action_id} {key} 不合法")
    for kind in ("gesture", "body"):
        if not any(action["kind"] == kind for action in actions):
            raise ValueError(f"action-catalog: 缺少 {kind} 动作")
    if "none" not in ids:
        raise ValueError("action-catalog: 缺少 none 动作")
    return value


def _number(value, lo=None, hi=None):
    import math
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(float(value)) and (lo is None or value >= lo) and (hi is None or value <= hi)


def load(path=CATALOG_PATH):
    return _validate(json.loads(Path(path).read_text(encoding="utf-8")))


CATALOG = load()
ACTIONS = CATALOG["actions"]
ACTION_BY_ID = {action["id"]: action for action in ACTIONS}
MODEL_ACTION_IDS = [action['id'] for action in ACTIONS if action['kind'] in ('none','gesture','body')]


def catalog_sha256(path=CATALOG_PATH):
    return sha(path)
