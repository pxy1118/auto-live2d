import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {gzipSync, gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {PerformanceController} from '../../research/vtuber-v4-liveliness-r1/frozen/src/performance';
import {LivelinessPolicy, allowed, type Pose} from '../../research/vtuber-v4-liveliness-r1/policy';
const root = join(import.meta.dirname, '../..'), study = join(root, 'research/vtuber-v4-liveliness-r1'), out = join(root, 'test-results/v4-liveliness-r1');
mkdirSync(out, {recursive: true});
const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
const before = read(join(study, 'before.json')), protocol = read(join(study, 'protocol.json'));
for (const [p, hash] of Object.entries(before.protected)) assert.equal(sha(join(root, p)), hash, p);
const browser = await chromium.launch({headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const page = await browser.newPage({viewport: {width: 480, height: 720}, deviceScaleFactor: 1});
await page.addInitScript('window.__name=target=>target;');
const errors: string[] = [], writes: string[] = [], sockets: string[] = [];
page.on('pageerror', e => errors.push(e.message));
page.on('request', r => { if (r.method() !== 'GET') writes.push(r.method() + ' ' + r.url()); });
page.on('websocket', s => { if (new URL(s.url()).pathname === '/ws') sockets.push(s.url()); });
const result: any = {ok: false, trained: false, promoted: false, human_quality_accepted: false,
  semantic_model_used: false, online_integration_tested: false, protocol_sha256: sha(join(study, 'protocol.json')), clips: [], browser_version: browser.version()};
const faceIds = ['key1', 'key2', 'key7', 'key8', 'key9', 'key13'];
const hands = ['Param36', 'Param39', 'Param41', 'Param42', 'Param43', 'Param62', 'Param59', 'Param60', 'Param61', 'Movement1', 'Movement2', 'Movement3', 'Param40', 'RHand', 'RHand2', 'LHand', 'LHand2'];
const body = ['AngleX', 'AngleY', 'AngleZ', 'PositionX', 'PositionY', 'PositionZ', 'LeanInput'];
const wardrobe = ['key10', 'key11', 'key12', 'Clothes1', 'Clothes2', 'Clothes3', 'Clothes4', 'Clothes5'];
const percentile = (v: number[], q: number) => [...v].sort((a, b) => a - b)[Math.ceil(v.length * q) - 1] ?? 0;
try {
  await page.goto('http://127.0.0.1:8775/research/vtuber-v4-liveliness-r1/render.html');
  await page.waitForFunction(() => (window as any).livelinessCapture?.ready, undefined, {timeout: 90000});
  const desc = await page.evaluate(async () => (await (window as any).livelinessCapture.engine.command({method: 'model.describe', params: {}})).result);
  result.asset_hash = desc.asset_hash; writeFileSync(join(study, 'parameters.json'), JSON.stringify(desc.parameters, null, 2));
  const metadata = new Map<string, any>(desc.parameters.map((p: any) => [p.id, p]));
  const defaults: Pose = Object.fromEntries(desc.parameters.map((p: any) => [p.id, p.default]));
  for (const id of allowed) assert.equal(metadata.get(id).physicsOutput, false, id);
  const probe = {channels: ['AngleX', 'AngleY'], values: Array.from({length: 120}, (_, f) => [Math.sin(f / 30) * 4, -2]), hz: 60, image_hz: 60, full_update: true, images: false};
  const single = await page.evaluate(async params => (await (window as any).livelinessCapture.engine.command({method: 'performance.capture', params})).result, probe);
  await page.evaluate(params => (window as any).livelinessCapture.begin(params), probe);
  const batched = [];
  for (const start of [0, 60]) batched.push(...(await page.evaluate(start => (window as any).livelinessCapture.batch(start, 60), start)).actual);
  assert.deepEqual(batched, single.actual, 'Batching reset or changed native physics'); result.batching_matches_frozen_capture = true;
  for (const scene of protocol.scenes) {
    const archived = scene.cached_scene ? read(join(root, scene.cached_scene, 'scene.json')) : null;
    const original = scene.cached_scene ? JSON.parse(gunzipSync(readFileSync(join(root, scene.cached_scene, 'baseline.json.gz'))).toString()).params : null;
    const frames = original?.values.length ?? Math.ceil(scene.duration_ms / 1000 * 60);
    const channels = [...new Set<string>([...hands, ...body, ...allowed, ...faceIds, 'ParamMouthOpenY'])];
    const baseRows = Array.from({length: frames}, (_, f) => {
      const row: Pose = {...defaults, ...scene.initial};
      if (original) original.channels.forEach((id: string, i: number) => row[id] = original.values[f][i]);
      return row;
    });
    let referenceArms: number[][] | undefined;
    for (const mode of protocol.conditions) {
      const id = scene.id + '-' + mode, folder = join(out, id); mkdirSync(folder, {recursive: true});
      const legacy = new PerformanceController(desc.parameters), policy = new LivelinessPolicy(desc.parameters);
      const values: number[][] = [], face: number[][] = [], trace: any[] = [], computes: number[] = [];
      let nextEvent = 0;
      for (let f = 0; f < frames; f++) {
        const started = performance.now(), now = f / 60 * 1000;
        const playing = !!archived?.cues.some((c: any) => now >= c.at_ms && now < c.end_ms);
        legacy.tick(f ? 1 / 60 : 0, {phase: playing ? 'playing' : 'idle', audio_time_ms: now}, {});
        while (nextEvent < scene.events.length && scene.events[nextEvent].at_ms <= now + 1e-6) {
          const e = scene.events[nextEvent];
          legacy.direct({emotion: e.emotion, intensity: e.intensity, hold_ms: e.hold_ms, cue_id: 'event-' + nextEvent});
          policy.emotion(e.emotion, e.intensity, e.hold_ms, now, 'event-' + nextEvent); nextEvent++;
        }
        const legacyFace = legacy.tick(0, {phase: playing ? 'playing' : 'idle', audio_time_ms: now}, {});
        const baseline = {...baseRows[f], ...Object.fromEntries(faceIds.map(k => [k, legacyFace[k] ?? 0]))};
        let row = baseline;
        if (mode === 'state_idle') {
          row = policy.apply(now, {...baseline, key1: 0, key7: 0}, playing ? 'playing' : 'idle');
        }
        values.push(channels.map(k => row[k] ?? defaults[k])); face.push(faceIds.map(k => row[k] ?? 0));
        if (f % 3 === 0) trace.push({at_ms: now, playing, state: policy.state(now)});
        computes.push(performance.now() - started);
      }
      const armRows = values.map(row => hands.map(k => row[channels.indexOf(k)]));
      if (!referenceArms) referenceArms = armRows; else assert.deepEqual(armRows, referenceArms);
      for (const row of values) for (let i = 0; i < channels.length; i++) {
        const p = metadata.get(channels[i]); assert.ok(Number.isFinite(row[i]) && row[i] >= p.min - 1e-6 && row[i] <= p.max + 1e-6, `${id}:${p.id}`);
      }
      const params = {channels, values, face, mouth: original?.mouth ?? Array(frames).fill(0), eye: original?.eye ?? 0,
        hz: 60, image_hz: 60, full_update: true, verify_hands: true, images: true};
      writeFileSync(join(folder, 'input.json.gz'), gzipSync(JSON.stringify({params, trace, events: policy.events})));
      await page.evaluate(framing => (window as any).livelinessCapture.engine.framing = framing, scene.framing);
      await page.evaluate(params => (window as any).livelinessCapture.begin(params), params);
      const actual: any = {parameter_ids: desc.parameters.map((p: any) => p.id), actual: [], hz: 60, image_hz: 60};
      let imageCount = 0;
      for (let start = 0; start < frames; start += 90) {
        const batch = await page.evaluate(start => (window as any).livelinessCapture.batch(start, 90), start);
        actual.actual.push(...batch.actual);
        for (const image of batch.images) { writeFileSync(join(folder, `${String(image.frame).padStart(4, '0')}.png`), Buffer.from(image.png, 'base64')); imageCount++; }
      }
      assert.equal(imageCount, frames); assert.equal(actual.actual.length, frames);
      const index = (k: string) => actual.parameter_ids.indexOf(k);
      for (const k of wardrobe) assert.ok(actual.actual.every((r: number[]) => r[index(k)] === defaults[k]), `${id}: wardrobe ${k}`);
      for (const k of ['key3', 'key4', 'key5', 'key6']) assert.ok(actual.actual.every((r: number[]) => r[index(k)] === 0), `${id}: special eye ${k}`);
      assert.ok(actual.actual.every((r: number[]) => r.every(Number.isFinite)));
      writeFileSync(join(folder, 'actual.json.gz'), gzipSync(JSON.stringify(actual)));
      const range = (k: string) => { const v = actual.actual.map((r: number[]) => r[index(k)]); return {min: Math.min(...v), max: Math.max(...v)}; };
      result.clips.push({id, scene: scene.id, condition: mode, frames, image_hz: 60, arm_finger_inputs_identical: true,
        appearance_unchanged: true, special_eyes_unchanged: true, policy_events: policy.events,
        ranges: Object.fromEntries([...body, 'ParamEyeBallX', 'ParamEyeBallY', 'ParamEyeLOpen', 'ParamBrowLY', 'LEyeSquint', 'key1', 'key7'].map(k => [k, range(k)])),
        local_policy_compute_p95_ms: percentile(computes, .95), computation_scope: 'Offline JS policy only; excludes online semantic/TTS/render/network.',
        input_sha256: sha(join(folder, 'input.json.gz')), actual_sha256: sha(join(folder, 'actual.json.gz'))});
      writeFileSync(join(out, 'capture-progress.json'), JSON.stringify(result, null, 2));
      console.log(JSON.stringify({captured: id, frames, fps: 60, arm_inputs_unchanged: true}));
    }
  }
  assert.deepEqual(errors, []); assert.deepEqual(writes, []); assert.deepEqual(sockets, []);
  for (const [p, hash] of Object.entries(before.protected)) assert.equal(sha(join(root, p)), hash, p);
  result.ok = true; result.actual_frames = result.clips.reduce((sum: number, c: any) => sum + c.frames, 0);
} catch (error) { result.failure = String(error); throw error;
} finally {
  result.errors = errors; result.backend_writes = writes; result.actor_sockets = sockets;
  writeFileSync(join(out, 'capture.json'), JSON.stringify(result, null, 2)); await browser.close();
}
console.log(JSON.stringify({ok: result.ok, clips: result.clips.length, actual_frames: result.actual_frames}));
