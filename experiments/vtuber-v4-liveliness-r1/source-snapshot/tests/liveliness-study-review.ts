import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const root = join(import.meta.dirname, '..'), out = join(root, 'test-results/v4-liveliness-r1'); mkdirSync(out, {recursive: true});
const read = (p: string) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const sha = (p: string) => createHash('sha256').update(readFileSync(join(root, p))).digest('hex');
const before = read('research/vtuber-v4-liveliness-r1/before.json');
const browser = await chromium.launch({headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--autoplay-policy=no-user-gesture-required']});
const page = await browser.newPage({viewport: {width: 1280, height: 1040}}); await page.addInitScript('window.__name=target=>target;');
await page.addInitScript(() => {
  const a = {sets: [] as number[], seeks: [] as number[], frames: [] as any[], start: 0}; (window as any).studyAudit = a;
  const d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime')!;
  Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {...d, set(value: number) {a.sets.push(performance.now()); d.set!.call(this, value);}});
  document.addEventListener('seeking', () => a.seeks.push(performance.now()), true);
  document.addEventListener('play', e => {
    const v = e.target as HTMLVideoElement; if (v.tagName !== 'VIDEO' || (v as any).__audited) return; (v as any).__audited = true;
    const frame = (at: number, meta: VideoFrameCallbackMetadata) => {a.frames.push({at, media: meta.mediaTime}); v.requestVideoFrameCallback(frame);}; v.requestVideoFrameCallback(frame);
  }, true);
});
const errors: string[] = [], writes: string[] = [], sockets: string[] = [];
page.on('pageerror', e => errors.push(e.message)); page.on('request', r => {if (r.method() !== 'GET') writes.push(r.method() + ' ' + r.url());});
page.on('websocket', s => sockets.push(s.url()));
const result: any = {ok: false, browser_version: browser.version(), pacing: [], human_votes_created: 0};
try {
  await page.goto('http://127.0.0.1:8765/dataset/vtuber-v4/review/liveliness-study.html');
  await page.waitForFunction(() => !(document.getElementById('play') as HTMLButtonElement).disabled);
  assert.equal(await page.locator('video').count(), 1); assert.equal(await page.locator('audio').count(), 0);
  assert.equal(await page.locator('#scene option').count(), 3); assert.equal(await page.locator('#variant option').count(), 2);
  const scenes = read('datasets/vtuber-v4/review/liveliness-study-scenes.json');
  for (const scene of scenes) {assert.ok(scene.paired_audio_identical && scene.arm_inputs_identical); for (const variant of scene.variants) {assert.equal(variant.fps, 60); assert.equal(sha('datasets/vtuber-v4/review/' + variant.video), variant.video_sha256);}}
  for (const mode of ['current', 'state_idle']) {
    await page.selectOption('#variant', mode); await page.waitForFunction(() => !(document.getElementById('play') as HTMLButtonElement).disabled);
    await page.evaluate(() => {const a = (window as any).studyAudit; a.sets = []; a.seeks = []; a.frames = []; a.start = performance.now();});
    await page.locator('#restart').click(); await page.waitForTimeout(7300); await page.locator('#pause').click();
    const a = await page.evaluate(() => (window as any).studyAudit), frames = a.frames.filter((r: any) => r.at - a.start > 1000);
    const gaps = frames.slice(1).map((r: any, i: number) => r.at - frames[i].at).sort((x: number, y: number) => x - y);
    const row = {mode, presented_frames: frames.length, p95_presentation_ms: gaps[Math.ceil(gaps.length * .95) - 1],
      max_gap_ms: Math.max(...gaps), gaps_over_100_ms: gaps.filter((g: number) => g > 100).length,
      automatic_time_writes: a.sets.filter((t: number) => t - a.start > 1000).length, automatic_seeks: a.seeks.filter((t: number) => t - a.start > 1000).length};
    assert.equal(row.automatic_time_writes, 0); assert.equal(row.automatic_seeks, 0); assert.ok(row.p95_presentation_ms < 40); assert.ok(frames.length > 270);
    result.pacing.push(row); writeFileSync(join(out, 'playback-' + mode + '.json'), JSON.stringify(a)); console.log(JSON.stringify(row));
  }
  const at = await page.locator('video').evaluate(v => (v as HTMLVideoElement).currentTime);
  await page.waitForTimeout(200); assert.equal(await page.locator('video').evaluate(v => (v as HTMLVideoElement).currentTime), at);
  await page.selectOption('#variant', 'current'); await page.waitForFunction(() => !(document.getElementById('play') as HTMLButtonElement).disabled && !document.querySelector('video')!.seeking);
  assert.ok(Math.abs(await page.locator('video').evaluate(v => (v as HTMLVideoElement).currentTime) - at) < .06);
  await page.selectOption('#scene', 'quiet'); await page.selectOption('#variant', 'state_idle'); await page.waitForFunction(() => !(document.getElementById('play') as HTMLButtonElement).disabled);
  await page.locator('#highlight').click(); await page.waitForTimeout(800); await page.locator('#pause').click();
  assert.ok(await page.locator('video').evaluate(v => (v as HTMLVideoElement).currentTime) > 16);
  await page.selectOption('#scene', 'anger'); await page.waitForFunction(() => !(document.getElementById('play') as HTMLButtonElement).disabled);
  await page.locator('#highlight').click(); await page.waitForTimeout(1100); await page.locator('#pause').click(); await page.waitForTimeout(150);
  await page.locator('article summary').click();
  await page.screenshot({path: join(out, 'review-desktop.png'), fullPage: true}); await page.setViewportSize({width: 390, height: 844});
  await page.screenshot({path: join(out, 'review-mobile.png'), fullPage: true});
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  for (const [p, hash] of Object.entries(before.protected)) assert.equal(sha(p), hash, p);
  assert.deepEqual(errors, []); assert.deepEqual(writes, []); assert.deepEqual(sockets, []);
  result.ok = true; result.checks = ['three scenes, two versions, genuine 60-fps inputs and identical paired audio',
    'one media clock; no automatic seeks; explicit switches keep time; pause and reaction jump work',
    'desktop/mobile layout and optional actual-parameter plot', 'no backend writes, actor socket, human votes or protected-source changes'];
} catch (error) {result.failure = String(error); throw error;
} finally {result.errors = errors; writeFileSync(join(out, 'review-browser.json'), JSON.stringify(result, null, 2)); await browser.close();}
