"""Learned continuous background-motion expert for the v6 runtime.

Inputs: frozen Qwen3.5-0.8B token features (16x1024), the 64-dim affect vector,
24x12 audio features + mask, current 38-dim pose, 20x38 pose history and a
4-dim motion phase.  Output: 24 future frames of the nine background channels
(AngleX/Y/Z, PositionX/Y/Z, LeanInput, ParamEyeBallX/Y) normalised to [-1, 1].

This is a same-shape reimplementation of the v5 ``StreamingExpert`` idea; the
frozen v5 module is left untouched for baseline evaluation.
"""
import torch
from torch import nn

from emotion_config import AFFECT_DIM, HORIZON

BACKGROUND_CHANNELS = [
    "AngleX",
    "AngleY",
    "AngleZ",
    "PositionX",
    "PositionY",
    "PositionZ",
    "LeanInput",
    "ParamEyeBallX",
    "ParamEyeBallY",
]
STATE_DIM = 38
HISTORY = 20
AUDIO_DIM = 12
PHASE_DIM = 4
SCHEMA = "vtuber.v6.continuous"


class ContinuousExpert(nn.Module):
    """Causal background expert; one decoder query per output frame."""

    def __init__(self, channels=len(BACKGROUND_CHANNELS), state_dim=STATE_DIM, history=HISTORY,
                 audio_dim=AUDIO_DIM, affect_dim=AFFECT_DIM, phase_dim=PHASE_DIM,
                 width=128, layers=2, heads=4, queries=HORIZON, dropout=0.05):
        super().__init__()
        self.channels = channels
        self.width = width
        self.semantic = nn.Linear(1024, width)
        self.history = nn.Linear(state_dim, width)
        self.state = nn.Linear(state_dim, width)
        self.affect = nn.Linear(affect_dim, width)
        self.phase = nn.Linear(phase_dim, width)
        self.audio = nn.Linear(audio_dim + 1, width)
        self.query = nn.Parameter(torch.randn(queries, width) * .02)
        self.position = nn.Parameter(torch.randn(history, width) * .02)
        block = nn.TransformerDecoderLayer(width, heads, width * 3, dropout=dropout, batch_first=True, norm_first=True)
        self.decoder = nn.TransformerDecoder(block, layers, norm=nn.LayerNorm(width))
        self.output = nn.Linear(width, channels)

    def forward(self, semantic, semantic_mask, affect, state, history, audio, audio_mask, motion_phase):
        batch = state.shape[0]
        if semantic.shape != (batch, 16, 1024):
            raise ValueError("语义特征形状不合法")
        if affect.shape != (batch, AFFECT_DIM) or state.shape != (batch, STATE_DIM):
            raise ValueError("affect/state 形状不合法")
        if history.shape != (batch, HISTORY, STATE_DIM):
            raise ValueError("history 形状不合法")
        if audio.shape != (batch, HORIZON, AUDIO_DIM) or audio_mask.shape != (batch, HORIZON):
            raise ValueError("audio 形状不合法")
        if motion_phase.shape != (batch, PHASE_DIM):
            raise ValueError("motion_phase 形状不合法")
        if not torch.isfinite(semantic).all() or not torch.isfinite(affect).all() or not torch.isfinite(state).all() \
                or not torch.isfinite(history).all() or not torch.isfinite(audio).all() or not torch.isfinite(motion_phase).all():
            raise ValueError("连续分支输入含非有限数值")
        memory = torch.cat([
            self.semantic(semantic),
            self.history(history) + self.position[None],
            self.state(state)[:, None],
            self.affect(affect)[:, None],
            self.phase(motion_phase)[:, None],
        ], dim=1)
        padding = torch.cat([
            semantic_mask,
            torch.zeros(batch, HISTORY + 3, device=state.device, dtype=torch.bool),
        ], dim=1)
        query = self.query[None] + self.audio(torch.cat([audio * audio_mask[:, :, None], audio_mask[:, :, None]], -1))
        decoded = self.decoder(query, memory, memory_key_padding_mask=padding)
        return torch.tanh(self.output(decoded))


def save_continuous(path, model, metadata=None):
    torch.save({
        "schema": SCHEMA,
        "state_dict": model.state_dict(),
        "channels": list(BACKGROUND_CHANNELS),
        "state_dim": STATE_DIM,
        "history": HISTORY,
        "audio_dim": AUDIO_DIM,
        "affect_dim": AFFECT_DIM,
        "phase_dim": PHASE_DIM,
        "width": model.width,
        "layers": len(model.decoder.layers),
        "queries": model.query.shape[0],
        **(metadata or {}),
    }, path)


def load_continuous(path, device="cpu"):
    saved = torch.load(path, map_location=device, weights_only=True)
    if saved.get("schema") != SCHEMA:
        raise ValueError("连续分支检查点 schema 不匹配")
    if list(saved.get("channels", [])) != list(BACKGROUND_CHANNELS):
        raise ValueError("连续分支输出通道契约不匹配")
    model = ContinuousExpert(channels=len(saved["channels"]), state_dim=saved["state_dim"], history=saved["history"],
                             audio_dim=saved["audio_dim"], affect_dim=saved["affect_dim"], phase_dim=saved["phase_dim"],
                             width=saved["width"], layers=saved["layers"], queries=saved["queries"])
    model.load_state_dict(saved["state_dict"])
    return model.to(device).eval(), saved
