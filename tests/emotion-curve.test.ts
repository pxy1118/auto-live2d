import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import test from 'node:test';
import {ControlError} from '../src/controller';
import {
 EmotionCurve,
 EMOTION_CURVE_SCHEMA,
 simulateEmotionCurve,
 validateEmotionTimeline,
 type EmotionTimelineV2,
} from '../src/emotion-curve';
import {EMOTION_LABELS, emotionEvidence} from '../src/emotion-config';
import thresholdsJson from '../models/multilingual-emotions-base/thresholds.json';

const THRESHOLDS = thresholdsJson as Record<string, number>;
const SID = 'b'.repeat(32);
const OTHER = 'c'.repeat(32);

/** 构造一条 v2 时间轴：文本由各点文本拼接，偏移/占比自动计算。 */
type PointInput = {
 text: string;
 probabilities?: Record<string, number>;
 policy_default?: boolean;
 quoted_text_excluded?: boolean;
 window_text?: string;
};
function timeline(points: PointInput[]): EmotionTimelineV2 {
 const text = points.map(point => point.text).join('');
 const chars = Array.from(text);
 let cursor = 0;
 const raw = points.map(point => {
  const start = cursor;
  cursor += Array.from(point.text).length;
  const value: any = {
   text: point.text,
   window_text: point.window_text ?? point.text,
   start,
   end: cursor,
   start_fraction: start / chars.length,
   probabilities: point.probabilities ?? {},
  };
  if (point.policy_default !== undefined) value.policy_default = point.policy_default;
  if (point.quoted_text_excluded !== undefined) value.quoted_text_excluded = point.quoted_text_excluded;
  return value;
 });
 return validateEmotionTimeline({schema: 'emotion.timeline.v2', labels: [...EMOTION_LABELS], thresholds: THRESHOLDS, points: raw}, text);
}

/** 构造概率，使 emotionEvidence 约为 strength（strength ≤ 0.9）。 */
function probabilityFor(label: string, strength = 0.8): number {
 const threshold = THRESHOLDS[label];
 const ratio = Math.min(1, (strength / 0.9) ** 2);
 return Math.min(1, threshold + ratio * (1 - threshold));
}

/** 从 startMs 播放到 endMs（audio_time 时钟）。 */
function play(curve: EmotionCurve, startMs: number, endMs: number, hz = 60, speechId = SID) {
 const dt = 1000 / hz;
 for (let t = startMs + dt; t <= endMs + 1e-6; t += dt) {
  curve.tick(1 / hz, {speech_id: speechId, phase: 'playing', audio_time_ms: Math.min(endMs, t)}, true);
 }
}

function boundary(tl: EmotionTimelineV2, index: number, duration: number) {
 return tl.points[index].start_fraction * duration;
}

const ZERO_LANES = Object.fromEntries(EMOTION_LABELS.map(label => [label, 0]));

test('证据只在阈值之上产生；等于阈值时为零，弱于 NEUTRAL_FLOOR 时主标签保持 neutral', () => {
 const below = new EmotionCurve();
 below.bind(timeline([{text: '嗯', probabilities: {joy: THRESHOLDS.joy - 0.02}}]), SID, 1000);
 play(below, 0, 1000);
 assert.equal(below.state().effective.joy, 0);

 const atThreshold = new EmotionCurve();
 atThreshold.bind(timeline([{text: '嗯', probabilities: {joy: THRESHOLDS.joy}}]), SID, 1000);
 play(atThreshold, 0, 1000);
 assert.equal(atThreshold.state().effective.joy, 0);

 const above = new EmotionCurve();
 above.bind(timeline([{text: '嗯', probabilities: {joy: probabilityFor('joy', 0.8)}}]), SID, 1000);
 play(above, 0, 1000);
 assert.ok(Math.abs(above.state().effective.joy - 0.8) < 1e-9);
 assert.ok(Math.abs(above.state().intensity - 0.8) < 1e-9);
 assert.equal(above.state().emotion, 'joy');

 const weak = new EmotionCurve();
 weak.bind(timeline([{text: '嗯', probabilities: {joy: probabilityFor('joy', 0.02)}}]), SID, 1000);
 play(weak, 0, 1000);
 assert.ok(weak.state().effective.joy > 0);
 assert.ok(weak.state().effective.joy < 0.035);
 assert.equal(weak.state().dominant_label, 'neutral');
 assert.equal(weak.state().emotion, 'neutral');
});

test('28 条证据车道同时存在并各自积分；simulate 也返回 28 类 response/mood', () => {
 const probabilities = Object.fromEntries(EMOTION_LABELS.map(label => [label, probabilityFor(label, 0.7)]));
 const tl = timeline([{text: '全部情绪同时出现', probabilities}]);
 const curve = new EmotionCurve();
 curve.bind(tl, SID, 4000);
 play(curve, 0, 4000);
 const state = curve.state();
 assert.equal(state.schema, EMOTION_CURVE_SCHEMA);
 assert.deepEqual(Object.keys(state.effective).sort(), [...EMOTION_LABELS].sort());
 assert.deepEqual(Object.keys(state.response).sort(), [...EMOTION_LABELS].sort());
 assert.deepEqual(Object.keys(state.mood).sort(), [...EMOTION_LABELS].sort());
 for (const label of EMOTION_LABELS) {
  assert.ok(state.effective[label] > 0, `${label} 应有效证据`);
  assert.ok(state.response[label] > 0, `${label} response 应上升`);
  assert.ok(state.mood[label] > 0, `${label} mood 应上升`);
 }
 const samples = simulateEmotionCurve(tl, 2000);
 assert.equal(samples.length, 3);
 for (const sample of samples) {
  assert.deepEqual(Object.keys(sample.response).sort(), [...EMOTION_LABELS].sort());
  assert.deepEqual(Object.keys(sample.mood).sort(), [...EMOTION_LABELS].sort());
 }
});

test('持续开心后快速反转：response 快速释放、mood 缓慢消化，单帧变化平滑', () => {
 const tl = timeline([
  {text: '开'.repeat(20), probabilities: {joy: probabilityFor('joy', 0.85)}},
  {text: '气'.repeat(20), probabilities: {anger: probabilityFor('anger', 0.85)}},
 ]);
 const duration = 6000;
 const curve = new EmotionCurve();
 curve.bind(tl, SID, duration);
 const swap = boundary(tl, 1, duration);
 play(curve, 0, swap);
 const before = curve.state();
 assert.equal(before.emotion, 'joy');
 assert.ok(before.response.joy > 0.7);
 assert.ok(before.mood.joy > 0.4);
 assert.ok(before.vad.valence > 0.3);

 let previousJoy = before.response.joy;
 let maxStep = 0;
 const dt = 1000 / 60;
 for (let t = swap + dt; t <= swap + 1600 + 1e-6; t += dt) {
  curve.tick(1 / 60, {speech_id: SID, phase: 'playing', audio_time_ms: Math.min(swap + 1600, t)}, true);
  maxStep = Math.max(maxStep, Math.abs(curve.state().response.joy - previousJoy));
  previousJoy = curve.state().response.joy;
 }
 const after = curve.state();
 assert.equal(after.emotion, 'anger');
 assert.ok(after.response.anger > 0.5, `anger=${after.response.anger}`);
 assert.ok(after.response.joy < 0.1, `joy response 应快速释放：${after.response.joy}`);
 assert.ok(after.mood.joy > 0.05, `mood 应缓慢消化：${after.mood.joy}`);
 assert.ok(after.vad.valence < -0.2);
 assert.ok(maxStep < 0.06, `单帧变化 ${maxStep}`);
});

test('短中性短语承接上一情绪，长时间静默后彻底衰减', () => {
 const tl = timeline([
  {text: '开'.repeat(20), probabilities: {joy: probabilityFor('joy', 0.8)}},
  {text: '接着说吧。', policy_default: true, probabilities: {}},
  {text: '心'.repeat(20), probabilities: {joy: probabilityFor('joy', 0.8)}},
 ]);
 const duration = 8000;
 const curve = new EmotionCurve();
 curve.bind(tl, SID, duration);
 play(curve, 0, boundary(tl, 1, duration));
 const beforeNeutral = curve.state().response.joy;
 assert.ok(beforeNeutral > 0.7);
 play(curve, boundary(tl, 1, duration), boundary(tl, 2, duration));
 const duringNeutral = curve.state();
 assert.equal(duringNeutral.intensity, 0);
 assert.deepEqual(duringNeutral.effective, ZERO_LANES);
 assert.ok(duringNeutral.response.joy > beforeNeutral * 0.15, `承接：${duringNeutral.response.joy}/${beforeNeutral}`);
 assert.ok(duringNeutral.tension < 0.05);

 for (let i = 0; i < 60 * 15; i++) curve.tick(1 / 60, {speech_id: SID, phase: 'idle', audio_time_ms: duration}, true);
 const settled = curve.state();
 assert.ok(settled.response.joy < 0.01, `静默后应衰减：${settled.response.joy}`);
 assert.ok(settled.mood.joy < 0.05, `心境也应缓慢衰减：${settled.mood.joy}`);
 assert.equal(settled.emotion, 'neutral');
});

test('混合情绪共存：多标签证据、tension 来自 fear/nervousness、VAD 保留负 dominance', () => {
 const tl = timeline([{text: '又开心又紧张', probabilities: {joy: probabilityFor('joy', 0.7), nervousness: probabilityFor('nervousness', 0.6)}}]);
 const curve = new EmotionCurve();
 curve.bind(tl, SID, 3000);
 play(curve, 0, 3000);
 const state = curve.state();
 assert.ok(state.effective.joy > 0.6);
 assert.ok(state.effective.nervousness > 0.5);
 assert.ok(state.response.joy > 0.5 && state.response.nervousness > 0.4);
 assert.ok(state.tension > 0.3, `tension=${state.tension}`);
 assert.ok(state.vad.valence > 0);
 assert.ok(state.vad.dominance < 0);
 assert.equal(state.dominant_label, 'joy');
});

test('主标签迟滞：margin 内不切换，明显领先并驻留后切换，证据消失后回 neutral', () => {
 const tl = timeline([
  {text: '开心开心开心', probabilities: {joy: probabilityFor('joy', 0.8)}},
  {text: '有点紧张', probabilities: {joy: probabilityFor('joy', 0.55), nervousness: probabilityFor('nervousness', 0.6)}},
  {text: '非常紧张', probabilities: {joy: probabilityFor('joy', 0.1), nervousness: probabilityFor('nervousness', 0.85)}},
  {text: '平静', policy_default: true, probabilities: {}},
 ]);
 const duration = 8000;
 const curve = new EmotionCurve();
 curve.bind(tl, SID, duration);
 play(curve, 0, boundary(tl, 1, duration));
 assert.equal(curve.state().emotion, 'joy');

 // 有效证据差 0.05 < switch_margin 0.07：主标签不应切换。
 play(curve, boundary(tl, 1, duration), boundary(tl, 2, duration) - 200);
 assert.equal(curve.state().emotion, 'joy');
 assert.equal(curve.state().dominant_label, 'nervousness');

 play(curve, boundary(tl, 2, duration) - 200, boundary(tl, 3, duration) - 200);
 assert.equal(curve.state().emotion, 'nervousness');

 play(curve, boundary(tl, 3, duration) - 200, duration);
 assert.equal(curve.state().emotion, 'neutral');
 assert.equal(curve.state().dominant_label, 'neutral');
 assert.ok(curve.state().intensity < 0.035);
});

test('暂停/缓冲冻结状态；预取时间轴不提前推进', () => {
 const tl = timeline([
  {text: '先说开心。', probabilities: {joy: probabilityFor('joy', 0.7)}},
  {text: '再生气。', probabilities: {anger: probabilityFor('anger', 0.8)}},
 ]);
 const curve = new EmotionCurve();
 curve.bind(tl, SID, 8000);
 assert.equal(curve.state().enabled, true);
 assert.equal(curve.state().point_index, -1);
 assert.deepEqual(curve.state().effective, ZERO_LANES);
 curve.tick(2, {speech_id: SID, phase: 'buffering', audio_time_ms: 0}, true);
 curve.tick(2, {speech_id: SID, phase: 'prepared', audio_time_ms: 0}, true);
 assert.equal(curve.state().clock_ms, 0);
 assert.equal(curve.state().point_index, -1);

 play(curve, 0, 2500);
 const before = structuredClone(curve.state());
 curve.tick(2, {speech_id: SID, phase: 'paused', audio_time_ms: 7000}, true);
 assert.deepEqual(curve.state(), before);
 curve.tick(2, {speech_id: SID, phase: 'buffering', audio_time_ms: 7000}, true);
 assert.deepEqual(curve.state(), before);
 curve.tick(0.1, {speech_id: SID, phase: 'playing', audio_time_ms: 2600}, true);
 assert.ok(Math.abs(curve.state().clock_ms - before.clock_ms - 100) < 1e-6);
});

test('bind 新音频单元保留心境且不重放；时长修正只移动未来点', () => {
 const first = timeline([
  {text: '一直开心。', probabilities: {joy: probabilityFor('joy', 0.8)}},
  {text: '继续开心。', probabilities: {joy: probabilityFor('joy', 0.8)}},
 ]);
 const curve = new EmotionCurve();
 curve.bind(first, SID, 6000);
 play(curve, 0, 3000);
 const carried = structuredClone(curve.state());
 assert.ok(carried.mood.joy > 0.2);

 const second = timeline([{text: '现在生气。', probabilities: {anger: probabilityFor('anger', 0.8)}}]);
 curve.bind(second, OTHER, 4000);
 const rebound = curve.state();
 assert.equal(rebound.point_index, -1);
 assert.equal(rebound.enabled, true);
 assert.deepEqual(rebound.mood, carried.mood);
 assert.deepEqual(rebound.response, carried.response);
 assert.equal(rebound.clock_ms, carried.clock_ms);
 assert.deepEqual(rebound.effective, ZERO_LANES);

 play(curve, carried.clock_ms, carried.clock_ms + 1000, 60, OTHER);
 assert.ok(curve.state().effective.anger > 0.7);
 assert.ok(curve.state().mood.joy > 0.1, '心境跨单元保留');

 // 时长修正：边界从 4000ms 前移到 2000ms；已经触发的点不回放。
 const retimed = new EmotionCurve();
 const twoPoints = timeline([
  {text: '开开心心', probabilities: {joy: probabilityFor('joy', 0.8)}},
  {text: '气气气气', probabilities: {anger: probabilityFor('anger', 0.8)}},
 ]);
 retimed.bind(twoPoints, SID, 8000);
 play(retimed, 0, 2500);
 assert.equal(retimed.state().point_index, 0);
 const clockBefore = retimed.state().clock_ms;
 retimed.retime(SID, 4000);
 retimed.retime(OTHER, 12000); // 其他语音单元的修正被忽略
 retimed.tick(0.1, {speech_id: SID, phase: 'playing', audio_time_ms: 2600}, true);
 const corrected = retimed.state();
 assert.equal(corrected.point_index, 1);
 assert.ok(Math.abs(corrected.clock_ms - clockBefore - 100) < 1e-6, '不应补算被跳过的时间');
 assert.ok(corrected.effective.anger > 0.7);
 assert.equal(corrected.effective.joy, 0);
});

test('取消清空全部状态（包括心境与时钟）', () => {
 const tl = timeline([{text: '一直开心。', probabilities: {joy: probabilityFor('joy', 0.8)}}]);
 const curve = new EmotionCurve();
 curve.bind(tl, SID, 4000);
 play(curve, 0, 3000);
 curve.reset();
 const state = curve.state();
 assert.equal(state.enabled, false);
 assert.equal(state.emotion, 'neutral');
 assert.equal(state.dominant_label, 'neutral');
 assert.equal(state.strength, 0);
 assert.equal(state.intensity, 0);
 assert.equal(state.clock_ms, 0);
 assert.equal(state.point_index, -1);
 assert.equal(state.source, null);
 assert.deepEqual(state.effective, ZERO_LANES);
 assert.deepEqual(state.response, ZERO_LANES);
 assert.deepEqual(state.mood, ZERO_LANES);
 assert.deepEqual(state.vad, {valence: 0, arousal: 0, dominance: 0});
});

test('非法时间轴原子拒绝：v1/NaN/标签缺失/偏移错误/未知字段', () => {
 const validRaw = () => ({
  schema: 'emotion.timeline.v2',
  labels: [...EMOTION_LABELS],
  thresholds: {...THRESHOLDS},
  points: [{
   text: '你好',
   window_text: '你好',
   start: 0,
   end: 2,
   start_fraction: 0,
   probabilities: {joy: probabilityFor('joy', 0.8)},
  }],
 });
 const text = '你好';
 const rejects = (mutate: (value: any) => void) => {
  const value = validRaw();
  mutate(value);
  assert.throws(() => validateEmotionTimeline(value, text), (error: any) => error instanceof ControlError && error.code === 'invalid_performance');
 };
 assert.equal(validateEmotionTimeline(validRaw(), text).schema, 'emotion.timeline.v2');
 rejects(value => { value.schema = 'emotion.timeline.v1'; });
 rejects(value => { value.labels = value.labels.slice(1); });
 rejects(value => { value.labels[1] = value.labels[0]; });
 rejects(value => { delete value.thresholds.joy; });
 rejects(value => { value.thresholds.joy = 1.2; });
 rejects(value => { value.thresholds.joy = NaN; });
 rejects(value => { value.points = []; });
 rejects(value => { value.points = Array.from({length: 81}, () => validRaw().points[0]); });
 rejects(value => { value.points[0].start = 1; });
 rejects(value => { value.points[0].end = 1; });
 rejects(value => { value.points[0].start_fraction = 0.5; });
 rejects(value => { value.points[0].text = '你'; });
 rejects(value => { value.points[0].probabilities.angry = 0.5; });
 rejects(value => { value.points[0].probabilities.joy = NaN; });
 rejects(value => { value.points[0].probabilities = {}; });
 rejects(value => { value.points[0].window_text = '别的话'; });
 rejects(value => { value.points[0].policy_default = 'yes'; });
 rejects(value => { value.extra = 1; });
 rejects(value => { value.points[0].extra = 1; });
 rejects(value => { value.thresholds.positive = 0.5; });

 // 校验失败不会改变任何正在运行的曲线状态（原子性）。
 const curve = new EmotionCurve();
 const good = timeline([{text: '开开心心', probabilities: {joy: probabilityFor('joy', 0.8)}}]);
 curve.bind(good, SID, 4000);
 play(curve, 0, 1200);
 const before = structuredClone(curve.state());
 const bad = validRaw();
 bad.schema = 'emotion.timeline.v1';
 assert.throws(() => curve.bind(validateEmotionTimeline(bad, text), SID, 4000));
 assert.deepEqual(curve.state(), before);
});

test('VAD 为有效证据加权和并 clamp；intensity/strength = max 有效证据', () => {
 const tl = timeline([{text: '非常开心', probabilities: {joy: probabilityFor('joy', 0.8)}}]);
 const curve = new EmotionCurve();
 curve.bind(tl, SID, 3000);
 play(curve, 0, 3000);
 const state = curve.state();
 const evidence = emotionEvidence(tl.points[0].probabilities, THRESHOLDS);
 assert.ok(Math.abs(state.intensity - evidence.joy) < 1e-12);
 assert.equal(state.strength, state.intensity);
 assert.ok(state.vad.valence > 0.4 && state.vad.valence <= 1);
 assert.ok(state.vad.arousal > 0.2 && state.vad.arousal <= 1);
 assert.ok(state.vad.dominance > 0 && state.vad.dominance <= 1);

 // 28 类全部接近 1：加权和必须被 clamp 到 [-1,1]。
 const everything = Object.fromEntries(EMOTION_LABELS.map(label => [label, 1]));
 const saturated = new EmotionCurve();
 saturated.bind(timeline([{text: '所有概率拉满', probabilities: everything}]), SID, 3000);
 play(saturated, 0, 3000);
 const clamped = saturated.state();
 assert.ok(clamped.vad.valence >= -1 && clamped.vad.valence <= 1);
 assert.ok(clamped.vad.arousal >= -1 && clamped.vad.arousal <= 1);
 assert.ok(clamped.vad.dominance >= -1 && clamped.vad.dominance <= 1);
 assert.equal(clamped.vad.valence, 1);
 assert.equal(clamped.vad.arousal, 1);
 assert.ok(Math.abs(clamped.intensity - 0.9) < 1e-9);
});

test('20/60/120Hz 帧率下曲线一致', () => {
 const tl = timeline([
  {text: '开开心心', probabilities: {joy: probabilityFor('joy', 0.7)}},
  {text: '难难过过', probabilities: {sadness: probabilityFor('sadness', 0.8)}},
  {text: '谢谢你呀', probabilities: {gratitude: probabilityFor('gratitude', 0.65), love: probabilityFor('love', 0.4)}},
 ]);
 const duration = 12000;
 const states = [20, 60, 120].map(hz => {
  const curve = new EmotionCurve();
  curve.bind(tl, SID, duration);
  play(curve, 0, duration, hz);
  return curve.state();
 });
 for (const state of states) {
  for (const label of EMOTION_LABELS) {
   assert.ok(Math.abs(state.response[label] - states[1].response[label]) < 0.003, `response.${label} 帧率不一致`);
   assert.ok(Math.abs(state.mood[label] - states[1].mood[label]) < 0.003, `mood.${label} 帧率不一致`);
  }
 }
 assert.equal(states[0].point_index, states[1].point_index);
});

test('simulateEmotionCurve 每秒采样且与 EmotionCurve 播放路径一致', () => {
 const tl = timeline([
  {text: '开开心心开开心心', probabilities: {joy: probabilityFor('joy', 0.85)}},
  {text: '气气气气气气气气', probabilities: {anger: probabilityFor('anger', 0.9)}},
 ]);
 const duration = 6000;
 const samples = simulateEmotionCurve(tl, duration);
 assert.deepEqual(samples.map(sample => sample.t), [0, 1000, 2000, 3000, 4000, 5000, 6000]);
 const curve = new EmotionCurve();
 curve.bind(tl, SID, duration);
 for (const sample of samples) {
  if (sample.t === 0) continue;
  play(curve, sample.t - 1000, sample.t);
  const state = curve.state();
  for (const label of EMOTION_LABELS) {
   assert.ok(Math.abs(sample.response[label] - state.response[label]) < 2e-4, `t=${sample.t} response.${label}`);
   assert.ok(Math.abs(sample.mood[label] - state.mood[label]) < 2e-4, `t=${sample.t} mood.${label}`);
  }
 }
});

const FIXTURE_PATH = join(import.meta.dirname, 'fixtures/emotion-curve-v2.json');

/** fixture 的 response/mood 可能是 record，也可能是按 timeline.labels 顺序的 28 元数组。 */
function labeledValues(values: any, labels: readonly string[]): Record<string, number> | null {
 if (!values) return null;
 if (Array.isArray(values)) {
  const mapped: Record<string, number> = {};
  labels.forEach((label, index) => { if (typeof values[index] === 'number') mapped[label] = values[index]; });
  return mapped;
 }
 if (typeof values === 'object') return values as Record<string, number>;
 return null;
}

function normalizeProbabilities(probabilities: any, labels: readonly string[]): Record<string, number> {
 if (!probabilities) return {};
 if (Array.isArray(probabilities)) {
  const mapped: Record<string, number> = {};
  labels.forEach((label, index) => { if (typeof probabilities[index] === 'number') mapped[label] = probabilities[index]; });
  return mapped;
 }
 return {...probabilities};
}

function fixtureCases(fixture: any): any[] {
 if (Array.isArray(fixture?.cases)) return fixture.cases;
 const flatTimeline = fixture?.timeline ?? fixture?.input?.timeline;
 if (flatTimeline) return [{
  name: 'default',
  duration_ms: fixture.duration_ms ?? fixture.durationMs ?? fixture.input?.duration_ms ?? fixture.input?.durationMs,
  timeline: flatTimeline,
  samples: fixture.samples ?? fixture.expected ?? [],
 }];
 return [];
}

if (!existsSync(FIXTURE_PATH)) {
 test('python↔ts parity fixture', {skip: `缺少 ${FIXTURE_PATH}；由 latent/emotion_curve_fixture.py 生成后自动启用`}, () => {});
 console.log(`[emotion-curve] parity fixture 不存在，已跳过：${FIXTURE_PATH}`);
} else {
 test('python↔ts parity fixture', () => {
  const fixture: any = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
  const cases = fixtureCases(fixture);
  assert.ok(cases.length, 'fixture 需要 cases[] 或 timeline+samples');
  let compared = 0;
  let comparedCases = 0;
  for (const item of cases) {
   const rawTimeline = item?.timeline;
   const duration = item?.duration_ms ?? item?.durationMs ?? fixture.duration_ms;
   const expected: any[] = item?.samples ?? item?.expected ?? [];
   if (!rawTimeline || typeof duration !== 'number' || !expected.length) continue;
   const labels: string[] = Array.isArray(rawTimeline.labels) ? rawTimeline.labels : [...EMOTION_LABELS];
   const rawPoints: any[] = Array.isArray(rawTimeline.points) ? rawTimeline.points : [];
   const normalized: any = {
    ...rawTimeline,
    thresholds: rawTimeline.thresholds ?? THRESHOLDS,
    points: rawPoints.map((point: any) => ({...point, probabilities: normalizeProbabilities(point.probabilities, labels)})),
   };
   const text = typeof item.text === 'string' ? item.text : rawPoints.map((point: any) => point.text ?? '').join('');
   let tl: EmotionTimelineV2;
   try {
    tl = validateEmotionTimeline(normalized, text);
   } catch (error) {
    console.warn(`[emotion-curve] fixture case ${item.name ?? '?'} 的 timeline 未通过 v2 校验，退化为直接仿真：${(error as Error).message}`);
    tl = normalized as EmotionTimelineV2;
   }
   const ours = simulateEmotionCurve(tl, duration);
   const byTime = new Map(ours.map(sample => [sample.t, sample]));
   let caseCompared = 0;
   for (const sample of expected) {
    const t = sample?.t ?? sample?.time ?? sample?.t_ms;
    if (!Number.isFinite(t) || t % 1000 !== 0) continue; // 20Hz fixture：只要求整秒采样点
    const mine = byTime.get(t);
    if (!mine) continue;
    const response = labeledValues(sample.response, labels);
    const mood = labeledValues(sample.mood, labels);
    for (const [layer, values] of [['response', response], ['mood', mood]] as const) {
     if (!values) continue;
     for (const label of EMOTION_LABELS) {
      const expectedValue = values[label];
      if (typeof expectedValue !== 'number') continue;
      const difference = Math.abs(mine[layer][label] - expectedValue);
      assert.ok(difference <= 1e-4, `case=${item.name ?? '?'} t=${t} ${layer}.${label}: ts=${mine[layer][label]} python=${expectedValue} diff=${difference}`);
      compared++;
      caseCompared++;
     }
    }
   }
   if (caseCompared) comparedCases++;
  }
  assert.ok(compared > 0, 'fixture 中没有可比对的整秒采样值');
  console.log(`[emotion-curve] parity fixture 比对通过：${comparedCases} 个 case / ${compared} 个值（±1e-4）`);
 });
}
