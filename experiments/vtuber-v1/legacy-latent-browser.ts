import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const root = join(import.meta.dirname, '..');
const base = process.env.DEMO_URL ?? 'http://127.0.0.1:8765';
const experiment = join(root, JSON.parse(readFileSync(join(root, 'latent/default-run.json'), 'utf8')).path);
const examples = JSON.parse(readFileSync(join(experiment, 'predictions.json'), 'utf8'));
const run = JSON.parse(readFileSync(join(experiment, 'run.json'), 'utf8'));
const output = join(root, 'test-results');
mkdirSync(output, { recursive: true });
const candidates = [process.env.BROWSER_EXECUTABLE, 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].filter(Boolean) as string[];
const executablePath = candidates.find(path => existsSync(path));
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const errors: string[] = [];
const report: any = { base, experiment, checked: [], cases: [], started: new Date().toISOString(), held_out_evaluation: false };
async function request(path: string, body?: any, expected = 200) {
  const response = await fetch(base + path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data: any = await response.json();
  assert.equal(response.status, expected, `${path}: ${JSON.stringify(data)}`);
  return data;
}
async function command(method: string, params: any = {}) { return (await request('/api/command', { method, params })).result; }

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  await page.goto(base);
  await page.waitForFunction(() => (window as any).live2dDemo?.ready, { timeout: 60000 });
  const status = await request('/api/latent/status');
  assert.equal(status.ready, true);
  assert.ok(status.experiment.replaceAll('\\', '/').endsWith('latent-study/activity-balanced'));
  assert.equal(status.neutral_start_only, true);
  report.worker = status;
  const profile = await request('/api/profile');
  for (const [kind, label, axis] of [
    ['regression', 'nod', 1], ['regression', 'smile', 9],
    ['regression', 'point_index', -1], ['regression', 'hand_chest', -2], ['flow', 'nod', 1],
  ] as const) {
    const sample = examples[kind + '-' + label];
    await command('engine.reset', { paused: true });
    await command('behavior.set', { idle: false, breath: false, blink: false });
    const neutral = await command('state.get', { geometry: true });
    const prediction = await request('/api/latent/predict', { text: sample.text, context: sample.context, style: sample.style, kind });
    assert.equal(prediction.provenance.checkpoint_sha256, run.models[kind].checkpoint_sha256);
    assert.equal(prediction.provenance.source, 'latent_policy');
    assert.equal(prediction.values.length, 64);
    for (const frame of prediction.values) {
      assert.equal(frame.length, 12);
      frame.forEach((value: number, index: number) => assert.ok(Number.isFinite(value) && value >= profile.channels[index].min && value <= profile.channels[index].max));
    }
    let milliseconds: number;
    if (axis >= 0) {
      const peak = prediction.values.reduce((best: number, frame: number[], i: number) => Math.abs(frame[axis]) > Math.abs(prediction.values[best][axis]) ? i : best, 0);
      milliseconds = peak * 100 + 100;
    } else {
      const side = axis === -1 ? 'right' : 'left';
      const enter = prediction.command.params.events.find((event: any) => event.method === 'gesture.set' && event.params.side === side && event.params.pose !== 'default');
      assert.ok(enter, `learned ${label} must contain a hand entry`);
      milliseconds = enter.at_ms + 1250;
    }
    await request('/api/latent/execute', { prediction_id: prediction.prediction_id, paused: true });
    await command('engine.step', { frames: Math.ceil(milliseconds * 60 / 1000) });
    const state = await command('state.get', { geometry: true });
    const geometryDelta = Math.hypot(state.geometry.weighted_x - neutral.geometry.weighted_x, state.geometry.weighted_y - neutral.geometry.weighted_y);
    assert.ok(geometryDelta > 1, `${kind} ${label}: real mesh must move`);
    if (axis >= 0) {
      const id = profile.channels[axis].id;
      assert.ok(Math.abs(state.driver[id] - profile.channels[axis].neutral) > (id === 'EyeSmile' ? .2 : 1), `${id} must move`);
      if (id === 'EyeSmile') assert.ok(state.values.EyeSmile > .2);
      if (id === 'AngleY') assert.ok(Math.abs(state.values.ParamAngleY) > .5, 'physics output must move');
    } else assert.ok(state.values[axis === -1 ? 'Movement3' : 'Movement2'] > .95, 'native hand animation must reach the learned pose');
    await page.locator('#portrait-view').click();
    await page.locator('#stage').screenshot({ path: join(experiment, `rendered-${kind}-${label}.png`) });
    await request('/api/latent/execute', { prediction_id: prediction.prediction_id }, 400);
    report.cases.push({ kind, label, sample_id: sample.sample_id, timing: prediction.timing, constraints: prediction.constraints, milliseconds, geometry_delta: geometryDelta,
      driver: Object.fromEntries(profile.channels.map((channel: any) => [channel.id, state.driver[channel.id]])), native_angle_y: state.values.ParamAngleY,
      movement2: state.values.Movement2, movement3: state.values.Movement3 });
  }
  report.checked.push('both neural heads -> bounded 64x12 trajectory -> native physics/hand animation -> changed mesh and screenshot');
  report.checked.push('predictions have checkpoint provenance and execute only once');

  // Recording is explicit; the convenience execute endpoint protects an ongoing recording.
  const sample = examples['regression-nod'];
  const prediction = await request('/api/latent/predict', { text: sample.text, context: sample.context, style: sample.style });
  await command('recording.start', { paused: true, annotation: { source_type: 'model_generated', experimental_only: true } });
  await request('/api/latent/execute', { prediction_id: prediction.prediction_id }, 400);
  await command('behavior.set', { idle: false, breath: false, blink: false });
  await command(prediction.command.method, prediction.command.params);
  await command('engine.step', { frames: 480 });
  const recording = await command('recording.stop');
  assert.equal(recording.provenance[0].checkpoint_sha256, run.models.regression.checkpoint_sha256);
  assert.ok(recording.frames.length > 60 && recording.commands.some((c: any) => c.method === 'parameters.set'));
  await command('recording.replay', { recording, paused: true });
  await command('engine.step', { frames: 480 });
  assert.ok((await command('state.get', { geometry: true })).geometry.opacity_sum > 0);
  report.checked.push('generated trajectory recording retains provenance and replays; convenience reset protects active recording');

  await page.locator('#latent-text').fill(sample.text);
  await page.locator('#latent-context').fill(sample.context);
  await page.locator('#latent-predict').click();
  await page.waitForFunction(() => document.getElementById('latent-details')!.textContent!.includes('prediction_id'), { timeout: 60000 });
  const visiblePrediction = JSON.parse((await page.locator('#latent-details').textContent())!);
  assert.equal(visiblePrediction.kind, 'regression');
  assert.equal(visiblePrediction.provenance.checkpoint_sha256, run.models.regression.checkpoint_sha256);
  assert.equal(visiblePrediction.constraints.gesture_accepted, 0, 'the nod input must not acquire hand gestures through the UI');
  assert.equal(await page.locator('#latent-execute').isEnabled(), true);
  await page.locator('#latent-execute').click();
  await page.waitForFunction(() => document.getElementById('latent-result')!.textContent!.includes('正在播放'));
  const visibleState = await command('state.get');
  assert.equal(visibleState.gesture.right, 'default');
  assert.equal(visibleState.gesture.left, 'default');
  assert.equal(visibleState.values.Movement2, 0);
  assert.equal(visibleState.values.Movement3, 0);
  report.visible_prediction = { kind: visiblePrediction.kind, constraints: visiblePrediction.constraints, gestures: visibleState.gesture };
  assert.equal(await page.locator('#policy-panel, #research-panel').count(), 0);
  for (const path of ['/api/policy/status', '/api/dataset']) assert.equal((await fetch(base + path)).status, 404);
  await page.screenshot({ path: join(experiment, 'demo-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(experiment, 'demo-mobile.png'), fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  report.checked.push('visible prediction/execute controls, retired routes absent, 390px mobile layout');
  await command('engine.reset');
  assert.deepEqual(errors, []);
  report.ok = true;
} catch (error: any) {
  report.ok = false;
  report.error = error.stack;
  throw error;
} finally {
  report.browser_errors = errors;
  writeFileSync(join(output, 'latent-verification.json'), JSON.stringify(report, null, 2));
  writeFileSync(join(experiment, 'browser-verification.json'), JSON.stringify(report, null, 2));
  await browser.close();
  console.log(JSON.stringify(report, null, 2));
}
