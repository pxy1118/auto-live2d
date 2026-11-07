"""Emit ``tests/fixtures/emotion-curve-v2.json`` for the TS/Python parity test.

Each case is a validated ``emotion.timeline.v2`` plus a fixed duration and the
20 Hz response/mood samples produced by :func:`emotion_curve.simulate_timeline`
(60 Hz sub-steps).  The browser only has to compare whole-second samples, but
all 20 Hz rows are kept so the fixture doubles as a deterministic regression.
"""
import json
from pathlib import Path

from common import ROOT
from emotion import validate_timeline
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
        "duration_ms": float(duration_ms),
        "timeline": timeline,
        "samples": [
            {"t": round(sample["t"], 6),
             "response": [round(value, 6) for value in sample["response"]],
             "mood": [round(value, 6) for value in sample["mood"]]}
            for sample in samples
        ],
    }


def main():
    mixed = "今天真的好开心呀，可是这件事让我有点难过。"
    split_mixed = mixed.index("，") + 1
    fear = "天哪，这个变化太突然了，我有点害怕。"
    split_fear = fear.index("，") + 1
    calm = "好啦，已经没事了，我们平静下来。"
    split_calm = calm.index("，") + 1
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
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(fixture, ensure_ascii=False, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(OUTPUT.relative_to(ROOT)), "cases": len(fixture["cases"]), "bytes": OUTPUT.stat().st_size}, ensure_ascii=False))


if __name__ == "__main__":
    main()
