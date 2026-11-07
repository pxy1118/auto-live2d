"""28-lane critically damped emotion curve.

Numerically identical to the browser ``simulateEmotionCurve``: fixed 60 Hz
sub-steps, per-lane evidence targets, fast response + slow mood springs, a
tension lane, and an explicit VAD/intensity projection.  This module is used
for training conditions, fixtures and parity tests; it holds no model weights.
"""
import math

from emotion_config import (
    LABELS, RESPONSE_ATTACK_S, RESPONSE_RELEASE_S, REVERSAL_RELEASE_S,
    MOOD_ATTACK_S, MOOD_RELEASE_S, RESPONSE_MIX, THRESHOLDS, VAD_PRESETS,
    build_affect_vector, evidence,
)

SUBSTEP_MS = 1000. / 60.
LANE_COUNT = len(LABELS)


def _clamp(value, low=0., high=1.):
    return low if value < low else high if value > high else value


def _vad_projection(lanes):
    """Explicit per-label prototype projection; never normalised by lane sum."""
    valence = arousal = dominance = 0.
    for label, value in zip(LABELS, lanes):
        if value <= 0.:
            continue
        preset = VAD_PRESETS[label]
        valence += value * preset[0]
        arousal += value * preset[1]
        dominance += value * preset[2]
    return (_clamp(valence, -1., 1.), _clamp(arousal, -1., 1.), _clamp(dominance, -1., 1.))


def timeline_targets(point, thresholds=None):
    """Evidence targets for one timeline point; tension is max(fear, nervousness)."""
    probabilities = point.get("probabilities") or {}
    if not probabilities:
        return [0.] * LANE_COUNT
    values = evidence(probabilities, thresholds or THRESHOLDS)
    return [values[label] for label in LABELS]


class CurveSimulator:
    """Stateful 28-lane simulation; ``advance_to`` never rewinds."""

    def __init__(self, timeline, duration_ms, thresholds=None):
        self.timeline = timeline
        self.duration_ms = float(duration_ms)
        self.thresholds = thresholds or THRESHOLDS
        self.points = timeline["points"]
        self.boundaries = [float(point["start_fraction"]) * self.duration_ms for point in self.points]
        self.index = 0
        self.t = 0.
        self.response = [0.] * LANE_COUNT
        self.mood = [0.] * LANE_COUNT
        self.response_velocity = [0.] * LANE_COUNT
        self.mood_velocity = [0.] * LANE_COUNT
        self.response_tension = 0.
        self.mood_tension = 0.
        self.response_tension_velocity = 0.
        self.mood_tension_velocity = 0.
        self.targets = self._targets()
        self._select(0)

    def _targets(self):
        target = timeline_targets(self.points[0], self.thresholds)
        return target

    def _select(self, index):
        self.index = index
        self.targets = timeline_targets(self.points[index], self.thresholds)
        self.target_tension = max(self.targets[LABELS.index("fear")], self.targets[LABELS.index("nervousness")])

    def _index_for(self, time_ms):
        index = 0
        for position, boundary in enumerate(self.boundaries):
            if boundary <= time_ms + 1e-9:
                index = position
            else:
                break
        return index

    @staticmethod
    def spring(value, velocity, target, dt, tau):
        omega = 1. / tau
        offset = value - target
        term = velocity + omega * offset
        decay = math.exp(-omega * dt)
        nxt = target + (offset + term * dt) * decay
        speed = (velocity - omega * term * dt) * decay
        if nxt < 0. or nxt > 1.:
            nxt = _clamp(nxt)
            speed = 0.
        return nxt, speed

    def _integrate(self, step_ms):
        """Exact critically damped step for the currently selected point target."""
        dt = step_ms / 1000.
        self.t += step_ms
        effective = [RESPONSE_MIX * r + (1. - RESPONSE_MIX) * m for r, m in zip(self.response, self.mood)]
        mixed_vad = _vad_projection(effective)
        target_vad = _vad_projection(self.targets)
        opposed = target_vad[0] * mixed_vad[0] < -0.025 and max(self.targets) > 0.45
        response_fall = REVERSAL_RELEASE_S if opposed else RESPONSE_RELEASE_S
        for lane in range(LANE_COUNT):
            target = self.targets[lane]
            value = self.response[lane]
            tau = RESPONSE_ATTACK_S if target > value else response_fall
            value, speed = self.spring(value, self.response_velocity[lane], target, dt, tau)
            self.response[lane] = value
            self.response_velocity[lane] = speed
            value = self.mood[lane]
            tau = MOOD_ATTACK_S if target > value else MOOD_RELEASE_S
            value, speed = self.spring(value, self.mood_velocity[lane], target, dt, tau)
            self.mood[lane] = value
            self.mood_velocity[lane] = speed
        value, speed = self.spring(self.response_tension, self.response_tension_velocity, self.target_tension, dt,
                                   RESPONSE_ATTACK_S if self.target_tension > self.response_tension else response_fall)
        self.response_tension, self.response_tension_velocity = value, speed
        value, speed = self.spring(self.mood_tension, self.mood_tension_velocity, self.target_tension, dt,
                                   MOOD_ATTACK_S if self.target_tension > self.mood_tension else MOOD_RELEASE_S)
        self.mood_tension, self.mood_tension_velocity = value, speed

    def advance_to(self, time_ms):
        """Advance exactly to ``time_ms``, switching points only at their boundaries.

        The integrator is exact for a constant target, so the only thing that can
        diverge between implementations is *when* a boundary switch happens.  Each
        chunk is integrated with the old target up to (and including) the boundary;
        the next chunk then runs with the new point's target.
        """
        target = max(0., float(time_ms))
        while self.t < target - 1e-9:
            boundary = self.boundaries[self.index + 1] if self.index + 1 < len(self.boundaries) else float("inf")
            stop = min(target, boundary)
            remaining = stop - self.t
            while remaining > 1e-9:
                step = min(SUBSTEP_MS, remaining)
                self._integrate(step)
                remaining = stop - self.t
            self.t = stop
            if boundary <= self.t + 1e-9 and self.index + 1 < len(self.boundaries):
                self._select(self.index + 1)

    def sample(self):
        effective = [_clamp(RESPONSE_MIX * r + (1. - RESPONSE_MIX) * m) for r, m in zip(self.response, self.mood)]
        return {
            "t": round(self.t, 6),
            "response": list(self.response),
            "mood": list(self.mood),
            "tension": _clamp(RESPONSE_MIX * self.response_tension + (1. - RESPONSE_MIX) * self.mood_tension),
            "vad": list(_vad_projection(effective)),
            "intensity": max(effective),
            "dominant": LABELS[max(range(LANE_COUNT), key=lambda lane: effective[lane])] if max(effective) > 0. else "neutral",
        }


def simulate_timeline(timeline, duration_ms, step_ms=50., thresholds=None):
    """20 Hz (default) samples with 60 Hz sub-steps; t=0 is the initial zero state."""
    duration_ms = float(duration_ms)
    step_ms = float(step_ms)
    if not math.isfinite(duration_ms) or duration_ms <= 0.:
        raise ValueError("duration 必须为正数")
    if not math.isfinite(step_ms) or step_ms <= 0.:
        raise ValueError("step 必须为正数")
    simulator = CurveSimulator(timeline, duration_ms, thresholds)
    samples = [simulator.sample()]
    count = int(math.floor(duration_ms / step_ms + 1e-9))
    for index in range(1, count + 1):
        simulator.advance_to(index * step_ms)
        samples.append(simulator.sample())
    return samples


def simulate_affect(timeline, duration_ms, step_ms=50., thresholds=None, style="natural"):
    """Per-sample 64-dim affect vectors plus the raw spring state."""
    samples = simulate_timeline(timeline, duration_ms, step_ms, thresholds)
    result = []
    for sample in samples:
        vector = build_affect_vector(
            dict(zip(LABELS, sample["response"])),
            dict(zip(LABELS, sample["mood"])),
            sample["tension"],
            sample["vad"],
            sample["intensity"],
            style,
        )
        result.append({"t": sample["t"], "affect": vector, **sample})
    return result


def simulate_affect_after(timeline, duration_ms, thresholds=None, style="natural"):
    """Final affect vector after simulating ``duration_ms`` (event-branch conditioning)."""
    samples = simulate_affect(timeline, duration_ms, step_ms=50., thresholds=thresholds, style=style)
    return samples[-1]


def curve_policy():
    return {
        "spring": "critically_damped",
        "response_attack_ms": RESPONSE_ATTACK_S * 1000.,
        "response_release_ms": RESPONSE_RELEASE_S * 1000.,
        "reversal_release_ms": REVERSAL_RELEASE_S * 1000.,
        "mood_attack_ms": MOOD_ATTACK_S * 1000.,
        "mood_release_ms": MOOD_RELEASE_S * 1000.,
        "response_mix": RESPONSE_MIX,
        "substep_ms": SUBSTEP_MS,
        "vad": "per-label prototype projection",
    }
