import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {PerformanceController} from '../src/performance';
import {streamChannels, backgroundChannels, PERFORMANCE_RUNTIME_VERSION, faceKeys} from '../src/performance-profile';
import {EMOTION_LABELS, AFFECT_DIM} from '../src/emotion-config';
import {ACTION_BY_ID} from '../src/action-catalog';

const id = 'a'.repeat(32), speechId = 'b'.repeat(32);
const thresholds: Record<string, number> = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'models/multilingual-emotions-base/thresholds.json'), 'utf8'));
const parameters = streamChannels.map(name => ({id: name, label: name, group: '', min: name === 'AngleX' || name === 'AngleY' || name === 'AngleZ' ? -30 : -1, max: name === 'AngleX' || name === 'AngleY' || name === 'AngleZ' ? 30 : 1, default: 0, type: 0, physicsInput: false, physicsOutput: false}));
const base = () => Object.fromEntries(parameters.map(p => [p.id, p.default]));
/** Minimal motion manifest so the native arm clips used by emotion segments exist. */
const motions = [
  {name: '默认手切举手', data: {Meta: {Duration: .5}, Curves: []}},
  {name: '举手切默认手', data: {Meta: {Duration: .5}, Curves: []}},
];
function timeline(text: string, parts: { text: string; label?: string; value?: number }[], duration = 8000) {
  let offset = 0;
  const points = parts.map(part => {
    const start = offset; offset += Array.from(part.text).length;
    const probabilities: Record<string, number> = {};
    for (const label of EMOTION_LABELS) probabilities[label] = 0;
    probabilities.neutral = .02;
    if (part.label) probabilities[part.label] = part.value ?? .9;
    return {text: part.text, window_text: part.text, start, end: offset, start_fraction: start / Array.from(text).length, probabilities};
  });
  return {schema: 'emotion.timeline.v2', labels: EMOTION_LABELS, thresholds, points};
}
function session(parts: { text: string; label?: string; value?: number }[], requestExtra: any = {}, audioMs = 8000) {
  const text = parts.map(p => p.text).join('');
  const controller = new PerformanceController(parameters, motions as any);
  controller.start({session_id: id}, base());
  controller.utterance({
    session_id: id, speech_id: speechId, text, audio_duration_ms: audioMs, audio_duration_final: true,
    clauses: [{clause: 0, text, start_fraction: 0}],
    affect_timeline: timeline(text, parts, audioMs), ...requestExtra,
  });
  return {controller, text};
}
const speech = (time: number, phase = 'playing') => ({speech_id: speechId, audio_time_ms: time, phase});
function run(p: PerformanceController, from: number, to: number, step = 1000 / 60) {
  let values: any = {};
  for (let t = from; t <= to + 1e-6; t += step) values = p.tick(step / 1000, speech(t), base());
  return values;
}

test('start validates input and exposes the v6 capabilities', () => {
  const p = new PerformanceController(parameters);
  assert.throws(() => p.start({session_id: 'nope'}, base()));
  assert.throws(() => p.start({session_id: id, motion_style: 'wild'}, base()));
  p.start({session_id: id, motion_style: 'natural'}, base());
  const capabilities: any = p.capabilities();
  assert.equal(capabilities.runtime_version, PERFORMANCE_RUNTIME_VERSION);
  assert.equal(capabilities.plan_schema, 'performance.plan.v3');
  assert.deepEqual(capabilities.emotion_labels, EMOTION_LABELS);
  assert.equal(capabilities.affect.dim, AFFECT_DIM);
  assert.equal(capabilities.action_catalog.actions.length, 14);
  assert.ok(capabilities.action_catalog.actions.every((a: any) => a.kind !== 'segment'));
});

test('utterance validates duration, timestamps, plans and timeline atomically', () => {
  const {controller: p, text} = session([{text: '你好呀。'}]);
  const before = p.state();
  const request: any = {session_id: id, speech_id: speechId, text, audio_duration_ms: 8000, audio_duration_final: true, clauses: [{clause: 0, text, start_fraction: 0}], affect_timeline: timeline(text, [{text}])};
  assert.throws(() => p.utterance({...request, audio_duration_final: undefined}));
  assert.throws(() => p.utterance({...request, clauses: [{clause: 0, text, start_fraction: .2}]}));
  const legacyTimeline = {...request.affect_timeline, schema: 'emotion.timeline.v1'};
  assert.throws(() => p.utterance({...request, affect_timeline: legacyTimeline}));
  assert.deepEqual(p.state(), before);
});

test('28-label evidence drives continuous facial expressions and overlays', () => {
  const {controller: p} = session([{text: '太开心了，真的很开心。', label: 'joy', value: .92}]);
  const values = run(p, 100, 4000);
  const state = p.state();
  assert.equal(state.affect.enabled, true);
  assert.equal(state.affect.emotion, 'joy');
  assert.ok(state.affect.effective.joy > .4);
  assert.ok(state.affect.intensity > .4);
  assert.ok(values.EyeSmile > .05, 'smile offset is applied additively on the base pose');
  assert.ok(values.ParamMouthForm > .03);
  assert.equal(state.affect_vector.length, AFFECT_DIM);
  const anger = session([{text: '真的太过分了。', label: 'anger', value: .9}]);
  const angryValues = run(anger.controller, 100, 4000);
  assert.ok(angryValues.key1 > .2, 'anger evidence raises the black-face overlay');
});

test('mixed emotions blend without sum normalization and stay clamped', () => {
  const text = '又开心又害羞。';
  const p = new PerformanceController(parameters);
  p.start({session_id: id}, base());
  const probabilities: Record<string, number> = {};
  for (const label of EMOTION_LABELS) probabilities[label] = 0;
  probabilities.joy = .95; probabilities.embarrassment = .95;
  p.utterance({
    session_id: id, speech_id: speechId, text, audio_duration_ms: 6000, audio_duration_final: true,
    clauses: [{clause: 0, text, start_fraction: 0}],
    affect_timeline: {schema: 'emotion.timeline.v2', labels: EMOTION_LABELS, thresholds, points: [{text, window_text: text, start: 0, end: Array.from(text).length, start_fraction: 0, probabilities}]},
  });
  const values = run(p, 100, 5000);
  assert.ok(values.EyeSmile > .05);
  assert.ok(values.key7 > .1, 'embarrassment drives the blush overlay');
  const state = p.state();
  assert.ok(Math.min(1, state.affect.effective.joy + state.affect.effective.embarrassment) > .5);
});

test('explicit eye drawing remains available without masking automatic deformation', () => {
  const {controller: p} = session([{text: '我好喜欢你呀。', label: 'love', value: .95}]);
  const auto = run(p, 100, 3000);
  assert.equal(auto.key4, 0);
  p.direct({expression:'爱心眼',intensity:1});
  const values = run(p, 3020, 3300);
  const state = p.state();
  assert.equal(state.emotion_pose['爱心眼'], 1);
  assert.equal(values.key4, 1, 'love-eye drawing is enabled as an exclusive expression');
  assert.doesNotThrow(() => run(p, 3000, 3600));
  const keys = Object.entries(faceKeys).filter(([name]) => ['＞＜', '圈圈眼', '爱心眼', '屑屑眼'].includes(name));
  const active = keys.filter(([, key]) => values[key] > .5);
  assert.equal(active.length, 1, 'only one special eye type is active');
});

test('background trajectory chunks only own the 9 continuous channels', () => {
  const {controller: p} = session([{text: '继续说下去。', label: 'neutral'}]);
  const before = run(p, 100, 500);
  const motionMs = p.state().motion_ms;
  assert.throws(() => p.chunk({session_id: id, start_ms: motionMs, channels: ['NotAParam'], values: [[0]]}), /动作通道不合法/);
  const rows = Array.from({length: 24}, () => backgroundChannels.map(() => 6));
  const accepted = p.chunk({session_id: id, start_ms: motionMs, channels: [...backgroundChannels], values: rows});
  assert.equal(accepted.accepted, true);
  const next = run(p, 500, 900);
  assert.ok(Math.abs((next.AngleX ?? 0) - 6) < 1e-6, 'background track replaces the sparse output');
  assert.ok(Math.abs((next.EyeSmile ?? 0) - (before.EyeSmile ?? 0)) < .01, 'chunk does not write face channels; the emotion layer keeps smoothing');
});

test('director cues take priority and release returns to the automatic emotion', () => {
  const {controller: p} = session([{text: '我其实有点难过。', label: 'sadness', value: .9}]);
  run(p, 100, 3000);
  const cue = p.direct({session_id: id, emotion: 'anger', intensity: .8, hold_ms: 1500});
  const values = run(p, 3000, 4500);
  assert.ok(values.key1 > .3, 'director anger overrides the automatic sad expression');
  p.release({cue_id: cue.cue_id});
  const after = run(p, 4500, 7000);
  const state = p.state();
  assert.ok(after.key1 < .2, 'released director returns to emotion');
  assert.equal(state.affect.emotion, 'sadness');
});

test('cancel clears the emotion, scheduler and expression state', () => {
  const {controller: p} = session([{text: '好难过。', label: 'sadness', value: .9}]);
  run(p, 100, 2000);
  p.cancel(id);
  const state = p.state();
  assert.equal(state.affect.enabled, false);
  assert.equal(state.affect.intensity, 0);
  assert.equal(state.action_plan.active_segment, null);
  assert.throws(() => p.utterance({session_id: id, speech_id: speechId, text: '迟到。', audio_duration_ms: 1000, audio_duration_final: true, clauses: [], affect_timeline: timeline('迟到。', [{text: '迟到。'}])}));
});

test('appearance only changes on explicit update and survives cancellation', () => {
  const {controller: p} = session([{text: '你好。', label: 'joy', value: .7}]);
  p.updateAppearance({glasses: 'black'});
  assert.equal(p.getAppearance().glasses, 'black');
  assert.throws(() => p.updateAppearance({glasses: 'red'}));
  p.cancel(id);
  assert.equal(p.getAppearance().glasses, 'black');
  p.detach();
  assert.equal(p.getAppearance().glasses, 'black');
});
