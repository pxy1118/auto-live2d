import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import WebSocket from 'ws';

const base = process.env.DEMO_URL ?? 'http://127.0.0.1:8765';
const resultDir = join(import.meta.dirname, '..', 'test-results'); mkdirSync(resultDir, { recursive: true });
const browserCandidates = [process.env.BROWSER_EXECUTABLE, 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].filter(Boolean) as string[];
const executablePath = browserCandidates.find(path => existsSync(path));
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const report: any = { base, checked: [], started: new Date().toISOString() };
const errors: string[] = [];
async function command(method: string, params: any = {}, request_id?: string) {
  const response = await fetch(`${base}/api/command`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method, params, request_id }) });
  const data: any = await response.json();
  assert.equal(response.status, 200, `${method}: ${JSON.stringify(data)}`);
  return data.result;
}
const reset = async () => {
  await command('engine.reset', { paused: true });
  await command('behavior.set', { idle: false, blink: false, breath: false });
};
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(base); await page.waitForFunction(() => (window as any).live2dDemo?.ready, { timeout: 60000 });
  const cap: any = await (await fetch(`${base}/api/capabilities`)).json();
  writeFileSync(join(resultDir, 'runtime-capabilities.json'), JSON.stringify(cap, null, 2));
  assert.equal(cap.parameters.length, 509); assert.equal(cap.parts.length, 147); assert.equal(cap.drawables, 715);
  assert.equal(cap.expressions.length, 23); assert.equal(cap.motions.length, 8); assert.equal(cap.physics_groups, 131); assert.equal(cap.mask_buffers, 2);
  report.capabilities = { parameters: cap.parameters.length, parts: cap.parts.length, drawables: cap.drawables, expressions: 23, motions: 8, physics_groups: 131, mask_buffers: cap.mask_buffers };
  await reset(); await command('engine.step', { frames: 60 });
  const neutral = await command('state.get', { geometry: true });
  await page.screenshot({ path: join(resultDir, 'demo-desktop.png'), fullPage: true });
  await page.locator('#portrait-view').click();
  await command('parameters.set', { values: { AngleX: 20, ParamMouthOpenY: 0.6 }, duration_ms: 300 });
  await command('engine.step', { frames: 90 });
  const moved = await command('state.get', { geometry: true });
  assert.ok(moved.values.ParamAngleX > 5, 'head driver must propagate through actual physics');
  assert.ok(Math.abs(moved.geometry.weighted_x - neutral.geometry.weighted_x) > 1, 'rendered mesh positions must change');
  report.checked.push('raw parameter -> physics -> changed mesh geometry');
  await command('parameters.set', { values: { ParamAngleX: 25 }, stage: 'post' });
  await command('engine.step', { frames: 3 });
  assert.equal((await command('state.get')).values.ParamAngleX, 25);
  report.checked.push('post-physics lock and native bounds');

  // Full asset coverage: use the public API and read back real model parameters.
  const clamp = (value: number, p: any) => Math.max(p.min, Math.min(p.max, value));
  for (const expression of cap.expressions) {
    await reset();
    await command('expressions.set', { name: expression.name, enabled: true, fade_ms: 0 });
    await command('engine.step', { frames: 60 });
    const state = await command('state.get', { geometry: true });
    for (const item of expression.parameters) {
      const p = cap.parameters.find((p: any) => p.id === item.Id);
      const expected = clamp(item.Blend === 'Add' ? p.default + item.Value : item.Value, p);
      assert.ok(Math.abs(state.values[item.Id] - expected) < 1e-5, `${expression.name}: ${item.Id}`);
    }
    assert.ok(state.geometry.opacity_sum > 0);
    await page.locator('#stage').screenshot({ path: join(resultDir, `expression-${expression.name}.png`) });
  }
  report.checked.push('all 23 original expression files, readback + rendered frames');
  await command('expressions.set', { name: '圈圈眼', enabled: true, fade_ms: 0 });
  await command('expressions.set', { name: '爱心眼', enabled: true, fade_ms: 0 });
  const eyeState = await command('state.get'); assert.equal(eyeState.values.key3, 0); assert.equal(eyeState.values.key4, 1);
  await command('appearance.set', { body: 'preset2' }); await command('engine.step', { frames: 30 });
  await command('appearance.set', { body: 'default' }); await command('engine.step', { frames: 30 });
  assert.equal((await command('state.get')).values.Clothes2, 0);
  report.checked.push('eye mutual exclusion and body default restoration');
  for (const motion of cap.motions) {
    await reset(); await command('motions.play', { name: motion.name, loop: false });
    let frames = Math.ceil(motion.duration * 60);
    while (frames > 0) { const chunk = Math.min(frames, 600); await command('engine.step', { frames: chunk }); frames -= chunk; }
    const state = await command('state.get', { geometry: true });
    assert.ok(state.geometry.opacity_sum > 0); assert.ok(Object.values(state.values).every(Number.isFinite));
    if (motion.hold) assert.ok(state.motions.some((m: any) => m.name === motion.name && m.holding));
  }
  report.checked.push('all 8 original motions and enter-pose hold behavior');
  await reset();
  await command('gesture.set', { side: 'right', pose: 'point_index' });
  await command('gesture.set', { side: 'left', pose: 'chest' });
  await command('engine.step', { frames: 100 });
  let state = await command('state.get'); assert.equal(state.values.Movement2, 1); assert.equal(state.values.Movement3, 1);
  await page.locator('#stage').screenshot({ path: join(resultDir, 'gesture-both-arms.png') });
  await command('gesture.set', { side: 'right', pose: 'grass' }); await command('engine.step', { frames: 100 });
  state = await command('state.get'); assert.equal(state.values.Movement1, 1); assert.equal(state.values.Movement3, 0);
  await page.locator('#stage').screenshot({ path: join(resultDir, 'gesture-grass.png') });
  await command('gesture.set', { side: 'right', pose: 'default' }); await command('engine.step', { frames: 100 });
  assert.equal((await command('state.get')).values.Movement1, 0);
  report.checked.push('independent arms, right-hand exclusion, enter/hold/exit');

  const beforeInvalid = await command('state.get');
  const invalid = await fetch(`${base}/api/command`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method: 'parameters.set', params: { values: { AngleX: 5, Missing: 1 } } }) });
  assert.equal(invalid.status, 400); assert.equal((await command('state.get')).driver.AngleX, beforeInvalid.driver.AngleX);
  await command('parameters.set', { values: { AngleX: 12 } }, 'test-dedup');
  const repeated = await command('parameters.set', { values: { AngleX: 12 } }, 'test-dedup'); assert.equal(repeated.values.AngleX, 12);
  report.checked.push('atomic validation and request ID deduplication');

  await command('recording.start', { paused: true });
  await command('parameters.set', { values: { AngleX: 15 }, duration_ms: 400 });
  await command('engine.step', { frames: 31 });
  await command('expressions.set', { name: '脸红', enabled: true, fade_ms: 200 });
  await command('engine.step', { frames: 41 });
  await command('gesture.set', { side: 'right', pose: 'point_index' });
  await command('engine.step', { frames: 130 });
  const recordedFinal = await command('state.get', { geometry: true });
  const recording = await command('recording.stop'); assert.ok(recording.frames.length > 20); assert.ok(recording.commands.length >= 3);
  writeFileSync(join(resultDir, 'sample-recording.json'), JSON.stringify(recording));
  await command('recording.replay', { paused: true }); await command('engine.step', { frames: 202 });
  const replayed = await command('state.get', { geometry: true });
  const maxReplayError = Math.max(...cap.parameters.map((p: any) => Math.abs(replayed.values[p.id] - recordedFinal.values[p.id])));
  report.max_replay_parameter_error = maxReplayError;
  assert.ok(maxReplayError < 1e-4, `fixed-step recording replay drift: ${maxReplayError}`);
  report.checked.push('recording export and fixed-step replay of actual parameters');

  await reset(); await command('demo.play'); await command('engine.step', { frames: 160 });
  await page.locator('#stage').screenshot({ path: join(resultDir, 'demo-action.png') });
  await command('engine.step', { frames: 450 });
  state = await command('state.get'); assert.equal(state.timeline, false); assert.equal(state.values.Movement2, 0); assert.equal(state.values.Movement3, 0);
  report.checked.push('10-second composed timeline finishes and returns gestures');
  await command('engine.reset', { paused: true }); assert.equal((await command('state.get')).overrides, 0);
  const [part] = cap.parts; await command('parts.set', { values: { [part.id]: 0 } }); await command('engine.reset', { paused: true });

  // Exercise visible controls, not just their API counterparts.
  await page.getByRole('button', { name: '脸红', exact: true }).click(); await command('engine.step', { frames: 30 });
  await page.getByRole('tab', { name: '参数', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索参数', exact: true }).fill('ParamAngleX');
  assert.ok(await page.locator('#parameter-list [data-param="ParamAngleX"]').isVisible());
  await page.getByRole('tab', { name: '动作', exact: true }).click();
  await page.getByRole('button', { name: '竖食指', exact: true }).click(); await command('engine.step', { frames: 100 });
  assert.equal((await command('state.get')).values.Movement3, 1);
  await page.getByRole('button', { name: '↺ 恢复初始状态', exact: true }).click(); await command('engine.pause', { paused: true });
  await page.getByRole('tab', { name: '表情与外观', exact: true }).click(); await page.locator('#full-view').click();
  await page.screenshot({ path: join(resultDir, 'demo-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(resultDir, 'demo-mobile.png'), fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'mobile page must not overflow horizontally');
  report.checked.push('visible controls and responsive layout');
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(base.replace('http', 'ws') + '/ws');
    const timer = setTimeout(() => { ws.close(); reject(new Error('WebSocket client timed out')); }, 10000);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'command', method: 'state.get', request_id: 'ws-client-test' })));
    ws.on('message', data => {
      try { const message = JSON.parse(data.toString()); assert.equal(message.request_id, 'ws-client-test'); assert.equal(message.status, 'applied'); clearTimeout(timer); ws.close(); resolve(); }
      catch (error) { clearTimeout(timer); ws.close(); reject(error); }
    });
    ws.on('error', reject);
  });
  await page.setViewportSize({ width: 1440, height: 1100 });
  const python = await promisify(execFile)('python', [join(import.meta.dirname, '..', 'examples', 'control_demo.py'), '--url', base], { timeout: 45000, encoding: 'utf8' });
  assert.ok(python.stdout.includes('Demo completed.')); report.python_client = '10-second demo completed';
  report.checked.push('external WebSocket client and Python HTTP client');
  await command('engine.reset');
  assert.deepEqual(errors, []);
  report.browser_errors = errors; report.ok = true;
  console.log(JSON.stringify(report, null, 2));
} catch (error: any) {
  report.ok = false; report.error = error.stack; report.browser_errors = errors; throw error;
} finally {
  writeFileSync(join(resultDir, 'verification.json'), JSON.stringify(report, null, 2)); await browser.close();
}
