/** Reproducible controller diagnostics, not an emotion-recognition benchmark. */
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {EmotionCurve,validateEmotionTimeline} from '../src/emotion-curve';
import {EMOTION_LABELS} from '../src/emotion-config';
import {PERFORMANCE_RUNTIME_VERSION} from '../src/performance-profile';

const thresholds: Record<string, number> = JSON.parse(await (await import('node:fs/promises')).readFile(join(import.meta.dirname, '..', 'models/multilingual-emotions-base/thresholds.json'), 'utf8'));
const parts: [string, number, Record<string, number>][] = [
  ['sustained joy', 5000, {joy: .7}], ['neutral bridge', 500, {}], ['continued joy', 3500, {joy: .7}],
  ['brief conflicting observation', 200, {anger: .2}], ['continued joy', 3800, {joy: .7}],
  ['sustained reversal', 4500, {anger: .8}], ['reassurance', 4500, {gratitude: .65, embarrassment: .1}],
];
const duration = parts.reduce((sum, p) => sum + p[1], 0), text = '段'.repeat(duration / 100);
let offset = 0;
const points = parts.map(([, ms, values]) => {
  const start = offset; offset += ms / 100;
  const probabilities: Record<string, number> = {};
  for (const label of EMOTION_LABELS) probabilities[label] = 0;
  for (const [label, value] of Object.entries(values)) probabilities[label] = value;
  return {text: text.slice(start, offset), window_text: text.slice(start, offset), start, end: offset, start_fraction: start / text.length, probabilities};
});
const curve = new EmotionCurve();
curve.bind(validateEmotionTimeline({schema: 'emotion.timeline.v2', labels: EMOTION_LABELS, thresholds, points}, text), 'probe', duration);
const trace: any[] = []; let previous = curve.state(), maxFrameChange = 0, switches = 0; const labels = ['neutral'];
for (let frame = 1; frame <= duration * 60 / 1000; frame++) {
  const time = frame * 1000 / 60;
  curve.tick(1 / 60, {speech_id: 'probe', phase: 'playing', audio_time_ms: time}, true);
  const state = curve.state();
  for (const label of EMOTION_LABELS) maxFrameChange = Math.max(maxFrameChange, Math.abs(state.effective[label] - previous.effective[label]));
  if (state.emotion !== previous.emotion) { switches++; labels.push(state.emotion); }
  if (frame % 3 === 0) trace.push({media_ms: time, affect: state});
  previous = state;
}
const reversalAt = parts.slice(0, 5).reduce((sum, p) => sum + p[1], 0);
const reversal = trace.find(row => row.media_ms >= reversalAt && row.affect.emotion === 'anger');
const result = {
  runtime: PERFORMANCE_RUNTIME_VERSION, kind: 'authored-control-signals', not_classifier_accuracy: true, not_old_runtime_ab_test: true, duration_ms: duration,
  parts: parts.map(([name, duration_ms, probabilities]) => ({name, duration_ms, probabilities})),
  metrics: {dominant_switches_including_initial: switches, labels, maximum_evidence_change_per_60hz_frame: maxFrameChange, reversal_label_response_ms: reversal ? reversal.media_ms - reversalAt : null},
  trace,
};
const out = join(import.meta.dirname, '..', 'test-results/emotion-catalog-v6');
mkdirSync(out, {recursive: true});
writeFileSync(join(out, 'curve-probe.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result.metrics, null, 2));
