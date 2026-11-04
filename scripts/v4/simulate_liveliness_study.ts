import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {gzipSync} from 'node:zlib';
import {LivelinessPolicy, StudyClock, allowed, type Activity, type Pose} from '../../research/vtuber-v4-liveliness-r1/policy';
const root = join(import.meta.dirname, '../..'), out = join(root, 'test-results/v4-liveliness-r1'); mkdirSync(out, {recursive: true});
const metadata = JSON.parse(readFileSync(join(root, 'research/vtuber-v4-mapping-r1/parameters.json'), 'utf8'));
const base: Pose = Object.fromEntries(metadata.map((p: any) => [p.id, p.default]));
const results: any[] = [];
for (const mode of ['idle', 'mixed']) {
  const p = new LivelinessPolicy(metadata), clock = new StudyClock(), trace: any[] = [], computes: number[] = [];
  const bounds = new Map<string, any>(metadata.map((p: any) => [p.id, p]));
  let audio = 0, previousClause = -1, emotions = 0, last = base, pauses = 0, buffers = 0, lateRejected = false;
  for (let f = 0; f <= 36000; f++) {
    const wall = f / 60 * 1000, local = wall % 45000, clause = Math.floor(wall / 45000);
    let phase: Activity = mode === 'idle' || local >= 12000 ? 'idle' : local >= 2000 && local < 2800 ? 'paused' : local >= 6000 && local < 7500 ? 'buffering' : 'playing';
    if (clause !== previousClause) {audio = 0; previousClause = clause;}
    if (phase === 'playing') audio += f ? 1000 / 60 : 0;
    const now = clock.step(f ? 1000 / 60 : 0, phase, mode === 'mixed' && phase !== 'idle' ? 'speech-' + clause : null, audio);
    if (mode === 'mixed' && f % 2700 === 30) { p.emotion(clause % 2 ? 'shy' : 'angry', .55, 4000, now, 'emotion-' + clause); emotions++; }
    if (mode === 'mixed' && f % 2700 === 90) p.direct({ParamEyeBallX: -.16}, now, 600);
    if (mode === 'mixed' && f === 18000) { const epoch = p.epoch; p.cancel(now); lateRejected = !p.emotion('shy', 1, 6000, now, 'late', epoch); }
    if (mode === 'mixed' && f === 18120) p.resume();
    const eventStart = p.events.length;
    const start = performance.now(), row = p.apply(now, {...base, AngleX: 6, AngleZ: -3, PositionX: 2, LeanInput: -2.5}, phase);
    for (const e of p.events.slice(eventStart)) if (e.kind === 'idle_start') assert.equal(phase, 'idle');
    computes.push(performance.now() - start);
    for (const [id, value] of Object.entries(row)) { const m = bounds.get(id); assert.ok(Number.isFinite(value) && value >= m.min - 1e-6 && value <= m.max + 1e-6, id); }
    if (phase === 'paused' && mode === 'mixed' && local > 2010) { for (const id of allowed) assert.equal(row[id], last[id], id); pauses++; }
    if (phase === 'buffering') buffers++;
    for (const id of Object.keys(base)) if (!allowed.includes(id)) assert.equal(row[id], base[id], id);
    if (f % 12 === 0) trace.push({wall_ms: wall, phase, clock_ms: now, state: p.state(), values: allowed.map(id => row[id])});
    last = row;
  }
  const events = p.events.filter(e => e.kind === 'idle_start');
  for (const e of events) if (mode === 'mixed') assert.ok(e.at >= 0);
  assert.ok(events.length > 10 && events.length <= 61);
  if (mode === 'mixed') assert.ok(lateRejected && pauses > 0 && buffers > 0);
  computes.sort((a, b) => a - b);
  const report = {mode, simulated_wall_ms: 600000, evaluated_frames: 36001, action_clock_ms: clock.now,
    idle_count: events.length, idle_starts: events, emotion_events: emotions, pause_comparisons: pauses, buffering_frames: buffers,
    late_result_rejected: mode === 'mixed' ? lateRejected : null, bounds_violations: 0, other_owner_changes: 0, idle_starts_while_busy: 0,
    local_policy_compute_p95_ms: computes[Math.ceil(computes.length * .95) - 1],
    scope: 'Offline policy simulation, not ten minutes of online Cubism/TTS/model inference.'};
  results.push(report); writeFileSync(join(out, 'simulation-' + mode + '.json.gz'), gzipSync(JSON.stringify({report, channels: allowed, trace})));
  console.log(JSON.stringify({...report, idle_starts: undefined}));
}
writeFileSync(join(out, 'simulation.json'), JSON.stringify({ok: true, simulations: results, promoted: false, trained: false}, null, 2));
