import {ControlError} from './controller';
import rawConfig from '../contracts/emotion-config.json';
import {
 EMOTION_LABELS,
 EMOTION_LABEL_SET,
 NEUTRAL_FLOOR,
 emotionEvidence,
 emotionCurvePolicy,
 type EmotionTimelinePointV2,
 type EmotionTimelineV2,
} from './emotion-config';

/** v6 情绪配置：28 类原生分数 → 阈值证据 → 连续状态。参数全部来自 contracts/emotion-config.json。 */
export {emotionCurvePolicy};
export type {EmotionTimelinePointV2, EmotionTimelineV2};

export const EMOTION_CURVE_SCHEMA = 'emotion.curve.v2';

const LABELS: readonly string[] = [...EMOTION_LABELS];
const LABEL_COUNT = LABELS.length;
const LABEL_INDEX: Record<string, number> = Object.fromEntries(LABELS.map((label, index) => [label, index]));
const VAD_PRESETS: Record<string, readonly number[]> = ((rawConfig as any).vad_presets ?? {}) as Record<string, readonly number[]>;

/** 与 v5 相同的积分子步：60Hz；帧率只影响外部调用节奏，不影响积分结果。 */
const SUBSTEP_MS = 1000 / 60;
const MIX = emotionCurvePolicy.response_mix;

const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, Number.isFinite(x) ? x : 0));
const isPlainObject = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const numberIn = (value: unknown, lo = 0, hi = 1): value is number => typeof value === 'number' && Number.isFinite(value) && value >= lo && value <= hi;

const TOP_FIELDS = new Set(['schema', 'labels', 'thresholds', 'points']);
const POINT_FIELDS = new Set(['text', 'window_text', 'start', 'end', 'start_fraction', 'probabilities', 'policy_default', 'quoted_text_excluded']);
const WINDOW_LIMIT = 512;
// Match Python str.strip(): Unicode White_Space plus U+001C..001F; retain U+FEFF.
const OBSERVATION_PADDING = /^[\p{White_Space}\u001c-\u001f]+|[\p{White_Space}\u001c-\u001f]+$/gu;

/**
 * Validate an entire v2 observation timeline before any running state changes.
 * Atomic: either the full timeline is returned as a normalized copy, or a
 * ControlError('invalid_performance') is thrown (never a partial result).
 */
export function validateEmotionTimeline(value: any, text: string): EmotionTimelineV2 {
 const fail = (detail?: string): never => { throw new ControlError('invalid_performance', detail ? `情绪曲线观测不合法：${detail}` : '情绪曲线观测不合法'); };
 if (typeof text !== 'string') fail('text');
 const chars = Array.from(text);
 if (!chars.length) fail('text 为空');
 if (!isPlainObject(value)) fail('timeline');
 if (value.schema !== 'emotion.timeline.v2') fail('schema');
 for (const key of Object.keys(value)) if (!TOP_FIELDS.has(key)) fail(`未知字段 ${key}`);

 // labels: 恰好 28 个、唯一、且集合等于契约标签集合。
 if (!Array.isArray(value.labels) || value.labels.length !== LABEL_COUNT) fail('labels 数量');
 const seen = new Set<string>();
 for (const label of value.labels) {
  if (typeof label !== 'string' || !EMOTION_LABEL_SET.has(label) || seen.has(label)) fail('labels 内容');
  seen.add(label);
 }

 // thresholds: 覆盖全部标签，取值 0..1。
 if (!isPlainObject(value.thresholds)) fail('thresholds');
 const thresholdKeys = Object.keys(value.thresholds);
 if (thresholdKeys.length !== LABEL_COUNT || thresholdKeys.some(key => !EMOTION_LABEL_SET.has(key))) fail('thresholds 覆盖');
 const thresholds: Record<string, number> = {};
 for (const label of LABELS) {
  const threshold = value.thresholds[label];
  if (!numberIn(threshold)) fail(`thresholds.${label}`);
  thresholds[label] = threshold;
 }

 if (!Array.isArray(value.points) || value.points.length < 1 || value.points.length > 80) fail('points 数量');

 const points: EmotionTimelinePointV2[] = [];
 let cursor = 0;
 for (const point of value.points) {
  if (!isPlainObject(point)) fail('point');
  for (const key of Object.keys(point)) if (!POINT_FIELDS.has(key)) fail(`未知点字段 ${key}`);
  if (!Number.isInteger(point.start) || !Number.isInteger(point.end)) fail('start/end');
  if (point.start !== cursor || point.end <= point.start || point.end > chars.length) fail('start/end 偏移');
  if (typeof point.text !== 'string' || !point.text) fail('point.text');
  // Offsets cover the original text including padding; classifier text omits it.
  if (chars.slice(point.start, point.end).join('').replace(OBSERVATION_PADDING, '') !== point.text) fail('point.text 与原文不一致');
  if (!numberIn(point.start_fraction) || Math.abs(point.start_fraction - point.start / chars.length) > 1e-6) fail('start_fraction');

  const windowText = point.window_text === undefined ? point.text : point.window_text;
  if (typeof windowText !== 'string' || !windowText || windowText.length > WINDOW_LIMIT || !windowText.endsWith(point.text)) fail('window_text');
  if (point.policy_default !== undefined && typeof point.policy_default !== 'boolean') fail('policy_default');
  if (point.quoted_text_excluded !== undefined && typeof point.quoted_text_excluded !== 'boolean') fail('quoted_text_excluded');

  if (!isPlainObject(point.probabilities)) fail('probabilities');
  const probabilityKeys = Object.keys(point.probabilities);
  if (probabilityKeys.length > LABEL_COUNT || probabilityKeys.some(key => !EMOTION_LABEL_SET.has(key))) fail('probabilities 键');
  const probabilities: Record<string, number> = {};
  for (const key of probabilityKeys) {
   if (!numberIn(point.probabilities[key])) fail(`probabilities.${key}`);
   probabilities[key] = point.probabilities[key];
  }
  if (!probabilityKeys.length && point.policy_default !== true) fail('空 probabilities 需要 policy_default');

  const normalized: EmotionTimelinePointV2 = {
   text: point.text,
   window_text: windowText,
   start: point.start,
   end: point.end,
   start_fraction: point.start_fraction,
   probabilities,
  };
  if (point.policy_default !== undefined) normalized.policy_default = point.policy_default;
  if (point.quoted_text_excluded !== undefined) normalized.quoted_text_excluded = point.quoted_text_excluded;
  points.push(normalized);
  cursor = point.end;
 }
 if (cursor !== chars.length) fail('points 未覆盖全文');

 return {schema: 'emotion.timeline.v2', labels: [...LABELS], thresholds, points};
}

// ---------------------------------------------------------------------------
// 证据 / VAD / 弹簧积分（纯函数；simulateEmotionCurve 与 EmotionCurve 共用）
// ---------------------------------------------------------------------------

const zeroValues = () => new Array<number>(LABEL_COUNT).fill(0);

function recordValues(values: readonly number[]): Record<string, number> {
 const record: Record<string, number> = {};
 for (let index = 0; index < LABEL_COUNT; index++) record[LABELS[index]] = values[index] ?? 0;
 return record;
}

/** 时间轴点 → 28 维有效证据（阈值以上才有分数；policy_default 空概率 = 无证据）。 */
function evidenceValues(point: EmotionTimelinePointV2, thresholds: Record<string, number>): number[] {
 const evidence = emotionEvidence(point?.probabilities ?? {}, thresholds);
 const values = zeroValues();
 for (let index = 0; index < LABEL_COUNT; index++) values[index] = clamp(evidence[LABELS[index]] ?? 0);
 return values;
}

/** tension 车道目标 = max(fear, nervousness) 的有效证据；随后分别进入快/慢两层再混合。 */
function tensionOf(effective: readonly number[]): number {
 return Math.max(effective[LABEL_INDEX.fear] ?? 0, effective[LABEL_INDEX.nervousness] ?? 0);
}

/** VAD = 对有效证据加权求和（无归一化），最后 clamp 到 [-1,1]。 */
function vadOf(values: readonly number[]): {valence: number; arousal: number; dominance: number} {
 let valence = 0, arousal = 0, dominance = 0;
 for (let index = 0; index < LABEL_COUNT; index++) {
  const evidence = values[index];
  if (!(evidence > 0)) continue;
  const preset = VAD_PRESETS[LABELS[index]];
  if (!preset) continue;
  valence += evidence * preset[0];
  arousal += evidence * preset[1];
  dominance += evidence * preset[2];
 }
 return {valence: clamp(valence, -1, 1), arousal: clamp(arousal, -1, 1), dominance: clamp(dominance, -1, 1)};
}

/** v5 临界阻尼弹簧，完全复用：位置与速度连续，越界时钳位并清零速度。 */
function spring(value: number, velocity: number, target: number, dt: number, tau: number): [number, number] {
 const omega = 1 / tau;
 const offset = value - target;
 const term = velocity + omega * offset;
 const decay = Math.exp(-omega * dt);
 const next = target + (offset + term * dt) * decay;
 const speed = (velocity - omega * term * dt) * decay;
 return [clamp(next), next < 0 || next > 1 ? 0 : speed];
}

type CurveRig = {
 response: number[]; responseVelocity: number[];
 mood: number[]; moodVelocity: number[];
 tensionResponse: number; tensionResponseVelocity: number;
 tensionMood: number; tensionMoodVelocity: number;
 dominant: string; candidate: string; candidateMs: number; lastSwitch: number;
 clockMs: number;
};

const createRig = (): CurveRig => ({
 response: zeroValues(), responseVelocity: zeroValues(),
 mood: zeroValues(), moodVelocity: zeroValues(),
 tensionResponse: 0, tensionResponseVelocity: 0,
 tensionMood: 0, tensionMoodVelocity: 0,
 dominant: 'neutral', candidate: 'neutral', candidateMs: 0, lastSwitch: -1e9,
 clockMs: 0,
});

/** 主标签迟滞在有效证据上判定（v5 语义）：switch_margin + dwell + minimum_switch。 */
function updateMainLabel(rig: CurveRig, target: readonly number[], stepMs: number) {
 let best = -Infinity, bestIndex = 0;
 for (let index = 0; index < LABEL_COUNT; index++) {
  if (target[index] > best) { best = target[index]; bestIndex = index; }
 }
 const current = target[LABEL_INDEX[rig.dominant]] ?? 0;
 let wanted: string;
 if (best < NEUTRAL_FLOOR) wanted = 'neutral';
 else if (rig.dominant === 'neutral' || best > current + emotionCurvePolicy.switch_margin) wanted = LABELS[bestIndex];
 else wanted = rig.dominant;
 if (wanted === rig.dominant) { rig.candidate = wanted; rig.candidateMs = 0; return; }
 if (wanted !== rig.candidate) { rig.candidate = wanted; rig.candidateMs = 0; }
 rig.candidateMs += stepMs;
 const dwell = rig.dominant === 'neutral' ? emotionCurvePolicy.initial_dwell_ms : emotionCurvePolicy.switch_dwell_ms;
 if (rig.candidateMs >= dwell && rig.clockMs - rig.lastSwitch >= emotionCurvePolicy.minimum_switch_ms) {
  rig.dominant = wanted;
  rig.lastSwitch = rig.clockMs;
  rig.candidateMs = 0;
 }
}

/**
 * 单个积分子步。算法与 v5 完全一致，只是车道从 6 条扩到 28 条：
 * - response 快层：rising → response_attack_ms；反向（目标 VAD 与当前混合 VAD 极性相反且
 *   max target > .45）→ reversal_release_ms；其余 → response_release_ms。
 * - mood 慢层：rising → mood_attack_ms，否则 mood_release_ms。
 * - tension 作为额外车道，目标 = max(fear, nervousness)，两层分别积分。
 * - 主标签迟滞只看有效证据。
 */
function stepRig(rig: CurveRig, target: readonly number[], tensionTarget: number, ms: number) {
 let remaining = ms;
 while (remaining > 1e-7) {
  const step = Math.min(remaining, SUBSTEP_MS);
  const dt = step / 1000;
  remaining -= step;
  rig.clockMs += step;

  const mixed = new Array<number>(LABEL_COUNT);
  for (let index = 0; index < LABEL_COUNT; index++) mixed[index] = MIX * rig.response[index] + (1 - MIX) * rig.mood[index];
  const targetVad = vadOf(target);
  const currentVad = vadOf(mixed);
  let maxTarget = 0;
  for (let index = 0; index < LABEL_COUNT; index++) if (target[index] > maxTarget) maxTarget = target[index];
  const opposed = targetVad.valence * currentVad.valence < -0.025 && maxTarget > 0.45;

  for (let index = 0; index < LABEL_COUNT; index++) {
   const rising = target[index] > rig.response[index];
   const responseTau = (rising ? emotionCurvePolicy.response_attack_ms : opposed ? emotionCurvePolicy.reversal_release_ms : emotionCurvePolicy.response_release_ms) / 1000;
   [rig.response[index], rig.responseVelocity[index]] = spring(rig.response[index], rig.responseVelocity[index], target[index], dt, responseTau);
   const moodTau = (target[index] > rig.mood[index] ? emotionCurvePolicy.mood_attack_ms : emotionCurvePolicy.mood_release_ms) / 1000;
   [rig.mood[index], rig.moodVelocity[index]] = spring(rig.mood[index], rig.moodVelocity[index], target[index], dt, moodTau);
  }

  const tensionRising = tensionTarget > rig.tensionResponse;
  const tensionResponseTau = (tensionRising ? emotionCurvePolicy.response_attack_ms : opposed ? emotionCurvePolicy.reversal_release_ms : emotionCurvePolicy.response_release_ms) / 1000;
  [rig.tensionResponse, rig.tensionResponseVelocity] = spring(rig.tensionResponse, rig.tensionResponseVelocity, tensionTarget, dt, tensionResponseTau);
  const tensionMoodTau = (tensionTarget > rig.tensionMood ? emotionCurvePolicy.mood_attack_ms : emotionCurvePolicy.mood_release_ms) / 1000;
  [rig.tensionMood, rig.tensionMoodVelocity] = spring(rig.tensionMood, rig.tensionMoodVelocity, tensionTarget, dt, tensionMoodTau);

  updateMainLabel(rig, target, step);
 }
}

export type EmotionCurveState = {
 schema: 'emotion.curve.v2';
 enabled: boolean;
 clock_ms: number;
 emotion: string;
 dominant_label: string;
 strength: number;
 intensity: number;
 effective: Record<string, number>;
 response: Record<string, number>;
 mood: Record<string, number>;
 tension: number;
 vad: {valence: number; arousal: number; dominance: number};
 point_index: number;
 points: number;
 source: {text: string; window_text: string; start_fraction: number; probabilities: Record<string, number>} | null;
};

export type SpeechTick = {speech_id?: string | null; phase?: string; audio_time_ms?: number};

/**
 * 快反应 + 慢心境的连续情绪状态机（v2）。
 * 只有实际播放才推进：暂停/缓冲冻结、预取不提前、时长修正只移动未来点、已触发点不重放；
 * bind 新时间轴保留 response/mood（跨音频单元保留心境），reset 取消时清空全部状态。
 */
export class EmotionCurve {
 enabled = false;
 deltaMs = 0;
 private timeline: EmotionTimelineV2 | null = null;
 private speechId: string | null = null;
 private duration = 0;
 private index = -1;
 private audioMs = 0;
 private thresholds: Record<string, number> = {};
 private target: number[] = zeroValues();
 private tensionTarget = 0;
 private rig: CurveRig = createRig();

 bind(timeline: EmotionTimelineV2, speechId: string, duration: number) {
  this.timeline = timeline;
  this.thresholds = timeline?.thresholds ?? {};
  this.speechId = speechId;
  this.duration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  this.index = -1;
  this.audioMs = 0;
  this.deltaMs = 0;
  this.enabled = true;
  this.resetTarget();
 }

 /** 时长修正：仅调整当前语音单元的边界映射，已触发点不重放。 */
 retime(speechId: string, duration: number) {
  if (speechId === this.speechId && Number.isFinite(duration) && duration > 0) this.duration = duration;
 }

 unbind() {
  this.timeline = null;
  this.speechId = null;
  this.index = -1;
  this.audioMs = 0;
  this.enabled = false;
  this.deltaMs = 0;
  this.resetTarget();
 }

 /** 取消：清空包括心境在内的全部状态，回到初始。 */
 reset() {
  this.unbind();
  this.duration = 0;
  this.rig = createRig();
 }

 private resetTarget() {
  this.target = zeroValues();
  this.tensionTarget = 0;
 }

 private select(index: number) {
  const point = this.timeline!.points[index];
  this.index = index;
  this.target = evidenceValues(point, this.thresholds);
  this.tensionTarget = tensionOf(this.target);
 }

 private advance(ms: number) {
  if (!(ms > 1e-7)) return;
  this.deltaMs += ms;
  stepRig(this.rig, this.target, this.tensionTarget, ms);
 }

 tick(dt: number, speech: SpeechTick, active: boolean) {
  this.deltaMs = 0;
  if (!this.enabled || !(dt > 0) || !Number.isFinite(dt)) return;
  const matching = this.speechId !== null && this.speechId === speech?.speech_id;
  if (matching && active && speech.phase === 'playing') {
   const audio = Math.max(this.audioMs, Number.isFinite(speech.audio_time_ms) ? (speech.audio_time_ms as number) : 0);
   if (this.index < 0) this.select(0);
   while (this.timeline && this.duration > 0 && this.index + 1 < this.timeline.points.length && audio >= this.timeline.points[this.index + 1].start_fraction * this.duration) {
    const boundary = Math.max(this.audioMs, this.timeline.points[this.index + 1].start_fraction * this.duration);
    this.advance(boundary - this.audioMs);
    this.audioMs = boundary;
    this.select(this.index + 1);
   }
   this.advance(audio - this.audioMs);
   this.audioMs = audio;
  } else if (speech?.phase !== 'paused' && speech?.phase !== 'buffering' && !(active && this.timeline && this.index < 0)) {
   this.resetTarget();
   this.advance(dt * 1000);
  }
 }

 state(): EmotionCurveState {
  const effective = recordValues(this.target);
  const response = recordValues(this.rig.response);
  const mood = recordValues(this.rig.mood);
  let intensity = 0, bestIndex = -1;
  for (let index = 0; index < LABEL_COUNT; index++) {
   if (this.target[index] > intensity) { intensity = this.target[index]; bestIndex = index; }
  }
  const dominant_label = intensity < NEUTRAL_FLOOR ? 'neutral' : LABELS[Math.max(bestIndex, 0)];
  const point = this.timeline?.points[this.index];
  return {
   schema: EMOTION_CURVE_SCHEMA,
   enabled: this.enabled,
   clock_ms: this.rig.clockMs,
   emotion: this.rig.dominant,
   dominant_label,
   strength: intensity,
   intensity,
   effective,
   response,
   mood,
   tension: clamp(MIX * this.rig.tensionResponse + (1 - MIX) * this.rig.tensionMood),
   vad: vadOf(this.target),
   point_index: this.index,
   points: this.timeline?.points.length ?? 0,
   source: point ? {text: point.text, window_text: point.window_text, start_fraction: point.start_fraction, probabilities: {...point.probabilities}} : null,
  };
 }
}

export type EmotionCurveSample = {t: number; response: Record<string, number>; mood: Record<string, number>};

/**
 * 与 latent/emotion_curve.py 对齐的离散化网格（20Hz）。
 * response 车道的 reversal tau 与 mood 的 attack/release 选择依赖离散子步上的状态判定
 * （尤其是 polarity reversal 的 opposed 标志）；Python 仿真在每个 20Hz 采样点切分积分子步，
 * 若 TS 只在 1Hz 采样点切分，点边界之后的子步相位会与 Python 相差最多一个子步，
 * 使 opposed 翻转检测最多偏移 ~16.7ms，造成 ~5e-4 的 parity 偏差。
 * 因此这里也在 20Hz 网格处切分 chunk（不改变连续动力学，只对齐离散判定时刻），
 * 对外仍只按 1Hz 返回采样。
 */
const ALIGN_MS = 1000 / 20;

/**
 * 纯函数仿真，供 Python ↔ TS parity 使用。与 EmotionCurve.tick 的播放路径算法相同：
 * - 积分子步 ≤ stepMs（默认 1000/60）；chunk 在时间轴点边界、1Hz 采样时刻和 20Hz
 *   对齐网格处切分，与 Python 仿真的子步划分逐点一致；
 * - 采样时刻 t = 0, 1000, 2000, …（不超过 durationMs），返回 28 类 response/mood 记录；
 * - 时间轴点按 start_fraction * durationMs 映射到音频时钟，到边界才切换目标，不回放。
 */
export function simulateEmotionCurve(timeline: EmotionTimelineV2, durationMs: number, stepMs = 1000 / 60): EmotionCurveSample[] {
 const duration = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0;
 const step = Number.isFinite(stepMs) && stepMs > 0 ? stepMs : 1000 / 60;
 const points = timeline?.points ?? [];
 const thresholds = timeline?.thresholds ?? {};
 const rig = createRig();
 const target = zeroValues();
 let tensionTarget = 0;
 let index = -1;
 let t = 0;
 const samples: EmotionCurveSample[] = [];
 // 采样 t 记录名义整数毫秒（0,1000,2000,…），与 Python 仿真的采样时刻完全对齐。
 const sample = (at: number) => samples.push({t: at, response: recordValues(rig.response), mood: recordValues(rig.mood)});
 const select = (next: number) => {
  index = next;
  const values = evidenceValues(points[next], thresholds);
  for (let lane = 0; lane < LABEL_COUNT; lane++) target[lane] = values[lane];
  tensionTarget = tensionOf(target);
 };
 if (!points.length) { sample(0); return samples; }
 select(0);
 sample(0);
 let nextSample = 1000;
 while (t < duration - 1e-9) {
  const boundary = index + 1 < points.length ? points[index + 1].start_fraction * duration : Infinity;
  if (boundary <= t + 1e-9) { select(index + 1); continue; }
  let chunk = Math.min(step, duration - t, boundary - t);
  const untilSample = nextSample - t;
  if (untilSample < chunk) chunk = untilSample;
  const gridIndex = Math.floor((t + 1e-9) / ALIGN_MS);
  const untilAlign = (gridIndex + 1) * ALIGN_MS - t;
  if (untilAlign > 0 && untilAlign < chunk) chunk = untilAlign;
  stepRig(rig, target, tensionTarget, chunk);
  t += chunk;
  if (t >= nextSample - 1e-9) { sample(nextSample); nextSample += 1000; }
 }
 return samples;
}
