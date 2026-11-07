import raw from '../contracts/emotion-config.json';

export type EmotionLabel = string;
export type MotionStyle = 'restrained' | 'natural' | 'lively';

const config: any = raw;
if (config.schema !== 'emotion.config.v1') throw new Error('emotion-config: 未知 schema');
const labels: string[] = config.labels;
if (!Array.isArray(labels) || labels.length !== 28 || new Set(labels).size !== labels.length) throw new Error('emotion-config: 需要 28 个唯一情绪标签');

export const EMOTION_LABELS = labels as readonly string[];
export const EMOTION_LABEL_SET = new Set(labels);
export const EVIDENCE_GAIN: Record<string, number> = {...(config.gains ?? {})};
export const EVIDENCE_SCALE: number = config.evidence?.scale ?? .9;
export const EVIDENCE_MIN_SPAN: number = config.evidence?.minimum_threshold_span ?? .001;
export const NEUTRAL_FLOOR: number = config.expression?.neutral_floor ?? .035;
export const FACE_ATTACK_S: number = config.expression?.face_attack_s ?? .18;
export const FACE_RELEASE_S: number = config.expression?.face_release_s ?? .5;
export const OVERLAY_ATTACK_S: number = config.expression?.overlay_attack_s ?? .18;
export const OVERLAY_RELEASE_S: number = config.expression?.overlay_release_s ?? .5;
export const EYE_ENTER: number = config.expression?.eye_enter ?? .55;
export const EYE_RELEASE: number = config.expression?.eye_release ?? .22;
export const EYE_DWELL_MS: number = config.expression?.eye_dwell_ms ?? 400;
export const EYE_HOLD_MS: number = config.expression?.eye_hold_ms ?? 1500;
export const AFFECT_LAYOUT = config.affect as {fast: number; slow: number; tension: number; vad: number; intensity: number; style: number; dim: number; styles: MotionStyle[]};
export const AFFECT_DIM = AFFECT_LAYOUT.dim;
export const MOTION_POLICY = config.motion as {evaluate_ms: number; arm_threshold: number; body_threshold: number; same_action_window_ms: number; style_gap_fallback: {arm: number; body: number}};

export const emotionCurvePolicy = {
  spring: config.curve?.spring ?? 'critically_damped',
  response_attack_ms: config.curve?.response_attack_ms ?? 200,
  response_release_ms: config.curve?.response_release_ms ?? 650,
  reversal_release_ms: config.curve?.reversal_release_ms ?? 240,
  mood_attack_ms: config.curve?.mood_attack_ms ?? 1800,
  mood_release_ms: config.curve?.mood_release_ms ?? 3200,
  response_mix: config.curve?.response_mix ?? .75,
  switch_margin: config.curve?.switch_margin ?? .07,
  switch_dwell_ms: config.curve?.switch_dwell_ms ?? 350,
  initial_dwell_ms: config.curve?.initial_dwell_ms ?? 180,
  minimum_switch_ms: config.curve?.minimum_switch_ms ?? 500,
  clock: config.curve?.clock ?? 'audio',
  vad_source: config.curve?.vad_source ?? 'per-label prototype projection',
};

/** Per-label expression evidence from raw sigmoid scores and published thresholds. */
export function emotionEvidence(probabilities: Record<string, number>, thresholds: Record<string, number>): Record<string, number> {
  const evidence: Record<string, number> = {};
  for (const label of EMOTION_LABELS) {
    const probability = probabilities?.[label] ?? 0;
    const threshold = thresholds?.[label];
    const gain = EVIDENCE_GAIN[label] ?? 1;
    if (typeof threshold !== 'number' || !Number.isFinite(threshold)) { evidence[label] = 0; continue; }
    const span = Math.max(EVIDENCE_MIN_SPAN, 1 - threshold);
    evidence[label] = gain * EVIDENCE_SCALE * Math.sqrt(Math.max(0, (probability - threshold) / span));
  }
  return evidence;
}

/** Layout of the 64-dim affect vector consumed by the learned heads. */
export function buildAffectVector(state: {
  response: Record<string, number>;
  mood: Record<string, number>;
  tension: number;
  vad: {valence: number; arousal: number; dominance: number};
  intensity: number;
  style: MotionStyle;
}): number[] {
  const vector: number[] = [];
  for (const label of EMOTION_LABELS) vector.push(clamp01(state.response[label] ?? 0));
  for (const label of EMOTION_LABELS) vector.push(clamp01(state.mood[label] ?? 0));
  vector.push(clamp01(state.tension));
  vector.push(clamp(state.vad.valence, -1, 1), clamp(state.vad.arousal, -1, 1), clamp(state.vad.dominance, -1, 1));
  vector.push(clamp01(state.intensity));
  for (const style of AFFECT_LAYOUT.styles) vector.push(style === state.style ? 1 : 0);
  if (vector.length !== AFFECT_DIM) throw new Error(`affect 向量维度错误：${vector.length}/${AFFECT_DIM}`);
  return vector;
}

const clamp01 = (x: number) => clamp(x, 0, 1);
function clamp(x: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, Number.isFinite(x) ? x : 0)); }

export type EmotionTimelinePointV2 = {
  /** Original start/end slice with leading/trailing Python str.strip() whitespace removed. */
  text: string;
  window_text: string;
  /** Contiguous Unicode code-point offsets in the untouched utterance, including whitespace. */
  start: number;
  end: number;
  start_fraction: number;
  probabilities: Record<string, number>;
  policy_default?: boolean;
  quoted_text_excluded?: boolean;
};
export type EmotionTimelineV2 = {
  schema: 'emotion.timeline.v2';
  labels: string[];
  thresholds: Record<string, number>;
  points: EmotionTimelinePointV2[];
};
