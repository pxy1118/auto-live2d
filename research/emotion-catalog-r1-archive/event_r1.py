"""Learned clause-level event expert for the v6 runtime.

Inputs: pooled 1024-dim text feature, 64-dim affect vector, 44-dim acting-state
vector.  Outputs: arm action over the catalog's ``cooldown_group=arm`` ids
(the ``none`` action plus gestures and emotion segments), body overlay over
``none`` + the six body actions, 3+3 variant logits and five normalised
strength/hold/onset regressions.  ``decode`` turns that into performance.plan.v2.
"""
import torch
from torch import nn

from emotion_config import AFFECT_DIM, LABELS
from planner_contract import STATE_DIM

SCHEMA = "vtuber.v6.event"
VALUES = 5  # action_strength, action_hold_ms, onset_ms, body_strength, body_hold_ms
HOLD_MIN_MS, HOLD_SPAN_MS = 200., 3400.
ONSET_MIN_MS, ONSET_SPAN_MS = 40., 760.
BODY_HOLD_MIN_MS, BODY_HOLD_SPAN_MS = 400., 3000.


class EventExpert(nn.Module):
    def __init__(self, arm_classes, body_classes, width=192, dropout=0.1):
        super().__init__()
        self.arm_classes = arm_classes
        self.body_classes = body_classes
        self.width = width
        self.semantic = nn.Sequential(nn.Linear(1024, width), nn.GELU(), nn.Dropout(dropout))
        self.affect = nn.Linear(AFFECT_DIM, width)
        self.state = nn.Linear(STATE_DIM, width)
        self.shared = nn.Sequential(nn.Linear(width * 3, width), nn.GELU(), nn.Dropout(dropout / 2))
        self.arm = nn.Linear(width, arm_classes)
        self.body = nn.Linear(width, body_classes)
        self.arm_variant = nn.Linear(width, 3)
        self.body_variant = nn.Linear(width, 3)
        self.values = nn.Linear(width, VALUES)

    def forward(self, semantic, affect, state):
        if semantic.shape[1] != 1024 or affect.shape[1] != AFFECT_DIM or state.shape[1] != STATE_DIM:
            raise ValueError("事件分支输入维度不合法")
        if not torch.isfinite(semantic).all() or not torch.isfinite(affect).all() or not torch.isfinite(state).all():
            raise ValueError("事件分支输入含非有限数值")
        hidden = self.shared(torch.cat([self.semantic(semantic), self.affect(affect), self.state(state)], dim=-1))
        return {
            "arm": self.arm(hidden),
            "body": self.body(hidden),
            "arm_variant": self.arm_variant(hidden),
            "body_variant": self.body_variant(hidden),
            "values": self.values(hidden).sigmoid(),
        }


def values_target(target, arm_entry):
    """Map legacy planner targets (or authored segment targets) into 5 normalised values."""
    strength = float(target.get("body_strength", .5) or 0.)
    if "action_strength" in target:
        strength = float(target["action_strength"])
    return [
        _clamp(strength),
        _clamp((float(target.get("arm_hold_ms", arm_entry.get("default_hold_ms", 1400))) - HOLD_MIN_MS) / HOLD_SPAN_MS),
        _clamp((float(target.get("onset_ms", 180)) - ONSET_MIN_MS) / ONSET_SPAN_MS),
        _clamp(float(target.get("body_strength", 0.))),
        _clamp((float(target.get("body_hold_ms", 2200)) - BODY_HOLD_MIN_MS) / BODY_HOLD_SPAN_MS),
    ]


def _clamp(value, low=0., high=1.):
    return low if value < low else high if value > high else float(value)


def decode(output, arm_ids, body_ids, catalog_by_id, thresholds=None, seed=None):
    """Turn one batch row into a ``performance.plan.v2`` action payload."""
    thresholds = thresholds or {}
    arm_probabilities = torch.softmax(output["arm"], dim=-1)
    body_probabilities = torch.softmax(output["body"], dim=-1)
    arm_index = int(arm_probabilities.argmax())
    body_index = int(body_probabilities.argmax())
    if thresholds.get("arm"):
        if arm_index > 0 and float(arm_probabilities[arm_index]) < float(thresholds["arm"]):
            arm_index = 0
    if thresholds.get("body"):
        if body_index > 0 and float(body_probabilities[body_index]) < float(thresholds["body"]):
            body_index = 0
    values = output["values"].detach().cpu().tolist()
    action_id = arm_ids[arm_index]
    body_id = body_ids[body_index]
    action_entry = catalog_by_id[action_id]
    body_entry = catalog_by_id[body_id]
    arm_variant = int(output["arm_variant"].argmax()) % max(1, int(action_entry["variants"]))
    body_variant = int(output["body_variant"].argmax()) % max(1, int(body_entry["variants"]))
    strength = _clamp(values[0])
    if action_entry.get("intensity"):
        low, high = action_entry["intensity"]
        strength = min(1., max(float(low), strength))
    action = {
        "id": action_id,
        "variant": arm_variant,
        "strength": round(strength, 4),
        "hold_ms": round(HOLD_MIN_MS + _clamp(values[1]) * HOLD_SPAN_MS, 1),
        "onset_ms": round(ONSET_MIN_MS + _clamp(values[2]) * ONSET_SPAN_MS, 1),
    }
    body_overlay = None
    if body_id != "none":
        body_overlay = {
            "id": body_id,
            "variant": body_variant,
            "strength": round(_clamp(values[3]), 4),
            "hold_ms": round(BODY_HOLD_MIN_MS + _clamp(values[4]) * BODY_HOLD_SPAN_MS, 1),
        }
    return {
        "action": action,
        "body_overlay": body_overlay,
        "confidence": {"action": round(float(arm_probabilities[arm_index]), 4), "body": round(float(body_probabilities[body_index]), 4)},
    }


def plan_v2(decoded, clause, clause_fraction):
    return {"schema": "performance.plan.v2", "clause": int(clause), "clause_fraction": float(clause_fraction), **decoded}


def save_event(path, model, metadata=None):
    torch.save({
        "schema": SCHEMA,
        "state_dict": model.state_dict(),
        "arm_classes": model.arm_classes,
        "body_classes": model.body_classes,
        "width": model.width,
        **(metadata or {}),
    }, path)


def load_event(path, device="cpu"):
    saved = torch.load(path, map_location=device, weights_only=True)
    if saved.get("schema") != SCHEMA:
        raise ValueError("事件分支检查点 schema 不匹配")
    model = EventExpert(saved["arm_classes"], saved["body_classes"], width=saved["width"])
    model.load_state_dict(saved["state_dict"])
    return model.to(device).eval(), saved
