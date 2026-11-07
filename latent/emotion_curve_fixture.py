"""Emit ``tests/fixtures/emotion-curve-v2.json`` for the TS/Python parity test.

Each case is a validated ``emotion.timeline.v2`` plus a fixed duration and the
20 Hz response/mood samples produced by :func:`emotion_curve.simulate_timeline`
(60 Hz sub-steps).  The browser only has to compare whole-second samples, but
all 20 Hz rows are kept so the fixture doubles as a deterministic regression.
"""
import json
from pathlib import Path

from common import ROOT
from emotion import build_timeline, emotion_inputs, emotion_spans, validate_timeline
from emotion_config import LABELS, THRESHOLDS
from emotion_curve import curve_policy, simulate_timeline

ROOT_DIR = Path(__file__).resolve().parents[1]
OUTPUT = ROOT_DIR / "tests/fixtures/emotion-curve-v2.json"
STEP_MS = 50.


def make_timeline(text, pieces):
    """``pieces``: [(end_char_index, {label: probability})]; every point covers text[start:end]."""
    points = []
    start = 0
    for end, probabilities in pieces:
        points.append({
            "text": text[start:end].strip(),
            "window_text": text[start:end].strip(),
            "start": start,
            "end": end,
            "start_fraction": start / len(text),
            "probabilities": {label: float(probabilities.get(label, 0.)) for label in LABELS},
            "policy_default": False,
            "quoted_text_excluded": False,
        })
        start = end
    timeline = {"schema": "emotion.timeline.v2", "labels": list(LABELS), "thresholds": dict(THRESHOLDS), "points": points}
    validate_timeline(timeline, text)
    return timeline


def case(name, text, duration_ms, pieces):
    timeline = make_timeline(text, pieces)
    samples = simulate_timeline(timeline, duration_ms, STEP_MS)
    return {
        "name": name,
        "text": text,
        "duration_ms": float(duration_ms),
        "timeline": timeline,
        "samples": [
            {"t": round(sample["t"], 6),
             "response": [round(value, 6) for value in sample["response"]],
             "mood": [round(value, 6) for value in sample["mood"]]}
            for sample in samples
        ],
    }


def observation_case(name, text):
    """Real observation assembly, without loading a classifier or sampling curves."""
    spans = emotion_spans(text)
    windows = emotion_inputs(text, spans)
    timeline = build_timeline(text, spans, windows, [{} for _ in spans])
    return {"name": name, "text": text, "timeline": timeline}


def main():
    mixed = "今天真的好开心呀，可是这件事让我有点难过。"
    split_mixed = mixed.index("，") + 1
    fear = "天哪，这个变化太突然了，我有点害怕。"
    split_fear = fear.index("，") + 1
    calm = "好啦，已经没事了，我们平静下来。"
    split_calm = calm.index("，") + 1
    confession = (
        "我......不太擅长说漂亮话。所以只能直接说了。\n"
        "从第一次见面开始，我就一直在看着你。\n"
        "你认真的样子、偷懒的样子、假装不在意其实很在意的样子......我都看见了。\n"
        "如果可以的话......我想成为你最特别的那个人。\n"
        "不是朋友，也不是普通的同学。\n"
        "......可以吗？"
    )
    fixture = {
        "schema": "emotion.curve.fixture.v2",
        "step_ms": STEP_MS,
        "policy": curve_policy(),
        "thresholds": dict(THRESHOLDS),
        "cases": [
            case("mixed-joy-grief", mixed, 3200., [
                (split_mixed, {"joy": .90, "amusement": .55, "neutral": .10}),
                (len(mixed) - 1, {"grief": .82, "sadness": .70, "neutral": .05}),
                (len(mixed), {"neutral": .55, "relief": .12}),
            ]),
            case("fear-spike", fear, 2400., [
                (split_fear, {"fear": .86, "nervousness": .80, "surprise": .55}),
                (len(fear), {"fear": .30, "nervousness": .40, "neutral": .45}),
            ]),
            case("calm-down", calm, 2600., [
                (split_calm, {"surprise": .78, "fear": .30, "neutral": .20}),
                (len(calm), {"neutral": .62, "relief": .40, "caring": .20}),
            ]),
        ],
        "observation_cases": [
            observation_case("multiline-confession-lf", confession),
            observation_case("multiline-confession-crlf", confession.replace("\n", "\r\n")),
            observation_case("blank-lines-indent-and-emoji", " \t\n\n  你好😀。\n\n\t今天  真的很开心，\n\u3000一起聊聊吧！\n\n  "),
            observation_case("python-strip-whitespace", "\x1c\x85\u00a0你好。\x1f\n\u3000再见。\x1e\t"),
            observation_case("bom-is-text", "\ufeff你好。\n\ufeff再见。"),
        ],
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(fixture, ensure_ascii=False, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(OUTPUT.relative_to(ROOT)), "cases": len(fixture["cases"]), "bytes": OUTPUT.stat().st_size}, ensure_ascii=False))


if __name__ == "__main__":
    main()
