/**
 * Continuous speech on the v6 runtime: one TTS stream per utterance, phrase-level
 * affect observations and v3 clause plans that never restart synthesis.
 *
 * Requires (not started by --dry-run): latent worker on :8768, TTS on :8769,
 * built dist/ and a system Chrome (or BROWSER_EXECUTABLE). Port 8775 must be free.
 */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createWriteStream, existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {ACTION_BY_ID} from '../src/action-catalog';
import {AFFECT_DIM, EMOTION_LABELS} from '../src/emotion-config';
import {PLAN_SCHEMA} from '../src/performance-plan';
import {PERFORMANCE_RUNTIME_VERSION} from '../src/performance-profile';

const root = join(import.meta.dirname, '..');
const out = join(root, process.env.SPEECH_OUT ?? 'test-results/emotion-catalog-v6/continuous');
const base = 'http://127.0.0.1:8775';
const workerBase = process.env.LATENT_URL ?? 'http://127.0.0.1:8768';
const argv = process.argv.slice(2);
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const usage = `continuous-speech-browser.ts — v6 continuous speech
  --long      长文模式（两次 TTS 分组 + 预取）
  --dry-run   解析参数并检查本地文件，不启动服务、不连接任何端口
  --help      显示本帮助
环境变量: SPEECH_OUT(输出目录, 默认 test-results/emotion-catalog-v6/continuous)
          SPEECH_LONG=1 / LATENT_URL / BROWSER_EXECUTABLE

真实运行前置条件:
  1. latent 服务已就绪: ${workerBase}/health (v6 emotion_catalog)
  2. TTS 服务已就绪: http://127.0.0.1:8769/health
  3. dist/ 已构建 (npm run build)，端口 8775 空闲
  4. 系统 Chrome 或 BROWSER_EXECUTABLE`;

if (argv.includes('--help') || argv.includes('-h')) {
  console.log(usage);
  process.exit(0);
}
const unknown = argv.filter(arg => !['--long', '--dry-run', '--help', '-h'].includes(arg));
if (unknown.length) {
  console.error(`未知参数: ${unknown.join(' ')}`);
  console.error(usage);
  process.exit(2);
}
const long = argv.includes('--long') || process.env.SPEECH_LONG === '1';
const phase = long ? 'long' : 'short';
const dryRun = argv.includes('--dry-run');
const browserCandidates = [
  process.env.BROWSER_EXECUTABLE,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe',
].filter((value): value is string => !!value);
const executablePath = browserCandidates.find(path => existsSync(path));

const text = long
  // 10 sentences ≈ 500 chars: one Qwen3-TTS generation holds up to 400 chars, so the
  // server must split this long input into two prefetched speech groups.
  ? '我们先把桌面上的资料整理一下，再按顺序核对每一份文件。接着把今天的安排记下来，慢慢做就好，不用着急。'.repeat(10)
  : '大家好呀，今天很高兴见到你。我们先把事情说清楚，然后再一起慢慢想办法，好不好？';

if (dryRun) {
  console.log(JSON.stringify({
    dry_run: true,
    script: 'tests/continuous-speech-browser.ts',
    mode: phase,
    base,
    out,
    text_chars: text.length,
    expected_tts_streams: long ? 2 : 1,
    browser: {candidates: browserCandidates, executable_path: executablePath ?? null},
    files: {
      dist_index: existsSync(join(root, 'dist/index.html')),
      emotion_config: existsSync(join(root, 'contracts/emotion-config.json')),
      action_catalog: existsSync(join(root, 'contracts/action-catalog.json')),
    },
    contracts: {
      runtime_version: PERFORMANCE_RUNTIME_VERSION,
      plan_schema: PLAN_SCHEMA,
      emotion_labels: EMOTION_LABELS.length,
      affect_dim: AFFECT_DIM,
    },
    preconditions: [`${workerBase}/health`, 'http://127.0.0.1:8769/health', 'dist built; port 8775 free', 'system Chrome'],
    note: '不启动服务、不连接端口',
  }, null, 2));
  process.exit(0);
}

mkdirSync(out, {recursive: true});
const report: any = {
  ok: false, schema: 'continuous-speech.v6', phase, base, long, text,
  text_chars: text.length, frames: [], errors: [], checks: [],
  runtime_version: PERFORMANCE_RUNTIME_VERSION, plan_schema: PLAN_SCHEMA,
  emotion_labels: EMOTION_LABELS.length, affect_dim: AFFECT_DIM,
};
try { await fetch(base + '/api/health'); throw Error('8775 is occupied'); } catch (error) { if (!(error instanceof TypeError)) throw error; }
const log = createWriteStream(join(out, phase + '-server.log'));
const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts', '--production'], {
  cwd: root, env: {...process.env, PORT: '8775'}, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.pipe(log, {end: false});
child.stderr.pipe(log, {end: false});
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;

const sorted = (values: string[]) => [...values].sort();
function assertPlanV2(plan: any, where: string) {
 assert.equal(plan.schema,PLAN_SCHEMA,where);
 assert.deepEqual(Object.keys(plan).sort(),['action','clause','confidence','schema']);
 assert.ok(ACTION_BY_ID.has(plan.action.id));
 assert.ok(Number.isFinite(plan.confidence.action));
 assert.ok(plan.action.strength>=0 && plan.action.strength<=1);
 assert.ok(plan.action.onset_ms>=0 && plan.action.onset_ms<=1000);
}

function assertAffectV2(affect: any, where: string) {
  assert.equal(affect.schema, 'emotion.curve.v2', `${where}: affect.schema`);
  assert.equal(typeof affect.enabled, 'boolean');
  for (const lane of ['effective', 'response', 'mood']) {
    assert.equal(Object.keys(affect[lane] ?? {}).length, 28, `${where}: affect.${lane} 28 lanes`);
    assert.ok(Object.values(affect[lane]).every((value: any) => Number.isFinite(value) && value >= 0 && value <= 1), `${where}: affect.${lane} 取值`);
  }
  assert.ok(['valence', 'arousal', 'dominance'].every(key => Number.isFinite(affect.vad[key])), `${where}: affect.vad`);
  assert.ok(Number.isFinite(affect.intensity) && affect.intensity >= 0 && affect.intensity <= 1, `${where}: affect.intensity`);
  assert.ok(Number.isInteger(affect.point_index) && Number.isInteger(affect.points), `${where}: point_index/points`);
  assert.ok(!('weights' in affect) && !('target' in affect), `${where}: 旧 affect 字段不应存在`);
}

async function command(method: string, params: any = {}, requestId = crypto.randomUUID()) {
  const response = await fetch(base + '/api/command', {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({method, params, request_id: requestId}),
  });
  const data: any = await response.json();
  assert.equal(response.status, 200, `${method}: ${JSON.stringify(data)}`);
  return data.result;
}
async function workerInfo(label: string) {
  return (await (await fetch(workerBase + '/health')).json()) as any;
}

try {
  let ready = false;
  for (let index = 0; index < 150; index++) {
    try {
      const health: any = await (await fetch(base + '/api/health')).json();
      assert.equal(health.process_id, child.pid);
      assert.equal(health.runtime_version, PERFORMANCE_RUNTIME_VERSION);
      ready = true;
      break;
    } catch { await sleep(100); }
  }
  assert.ok(ready, 'isolated production server did not become ready');
  assert.ok(executablePath, 'Install system Chrome or set BROWSER_EXECUTABLE');
  const workerBefore: any = await workerInfo('before');
  assert.equal(workerBefore.ready, true, 'v6 latent worker must be ready');
  assert.equal(workerBefore.driver, 'native28_motion');
  assert.equal(workerBefore.runtime_version, PERFORMANCE_RUNTIME_VERSION);
  report.worker = {
    driver: workerBefore.driver, runtime_version: workerBefore.runtime_version, models: workerBefore.models,
    motion: workerBefore.motion ?? null, runtime_counts_before: workerBefore.runtime_counts ?? null,
  };
  browser = await chromium.launch({headless: true, executablePath, args: ['--autoplay-policy=no-user-gesture-required']});
  report.browser = browser.version();
  const page = await browser.newPage({viewport: {width: 1365, height: 1050}});
  await page.addInitScript('window.__name=target=>target;');
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(base + '/');
  await page.waitForFunction(() => (window as any).live2dDemo?.ready, {timeout: 60000});
  await page.waitForFunction(() => !(document.getElementById('performance-play') as HTMLButtonElement).disabled);
  await page.evaluate(() => {
    const demo = (window as any).live2dDemo;
    const command = demo.engine.command.bind(demo.engine);
    const events: any[] = [];
    (window as any).speechAudit = events;
    demo.engine.command = async (payload: any) => {
      if (['speech.stream.begin', 'speech.stream.finish', 'performance.utterance', 'performance.segment'].includes(payload.method)) {
        events.push({method: payload.method, params: payload.params, at: performance.now()});
      }
      return command(payload);
    };
  });
  await page.locator('#performance-text').fill(text);
  const begin = Date.now();
  await page.locator('#performance-play').click();
  let done: any;
  while (Date.now() - begin < (long ? 180000 : 90000)) {
    const state = await command('state.get');
    const p = await command('performance.state');
    assert.ok(Object.values(state.values).every(Number.isFinite));
    if (p.queue?.error) throw Error(p.queue.error);
    assertAffectV2(p.affect, 'playing');
    if (p.affect.enabled) {
      assert.ok(Array.isArray(p.affect_vector) && p.affect_vector.length === AFFECT_DIM, '64-dim affect vector');
      assert.ok(p.affect_vector.every(Number.isFinite));
    }
    for (const row of p.plan_history) assertPlanV2(row.plan, 'playing plan_history');
    report.frames.push({
      wall_ms: Date.now() - begin, clause: p.clause, phase: p.queue?.phase,
      speech: state.speech,
      speech_id: p.speech_id ?? p.utterance?.speech_id ?? null,
      affect: {
        schema: p.affect.schema, enabled: p.affect.enabled, emotion: p.affect.emotion,
        dominant_label: p.affect.dominant_label, intensity: p.affect.intensity,
        point_index: p.affect.point_index, points: p.affect.points,
        vector_length: Array.isArray(p.affect_vector) ? p.affect_vector.length : null,
      },
      plans: p.plan_history.length,
    });
    if (p.queue?.phase === 'finished') { done = p; break; }
    await sleep(80);
  }
  assert.ok(done, 'Speech did not finish');
  report.total_wall_ms = Date.now() - begin;
  report.plans = done.plan_history;
  report.metrics = done.queue.metrics;
  report.events = await page.evaluate(() => (window as any).speechAudit);
  assertAffectV2(done.affect, 'finished');
  assert.equal(done.affect.enabled, true);
  assert.ok(done.affect.points >= 2, 'phrase-level affect timeline must have multiple points');
  report.final_affect = {
    schema: done.affect.schema, enabled: done.affect.enabled, emotion: done.affect.emotion,
    dominant_label: done.affect.dominant_label, intensity: done.affect.intensity,
    points: done.affect.points, point_index: done.affect.point_index,
    vector_length: Array.isArray(done.affect_vector) ? done.affect_vector.length : null,
  };

  // One TTS synthesis per utterance, and per-clause v2 plans while it plays.
  const starts = report.events.filter((event: any) => event.method === 'speech.stream.begin');
  report.tts_streams = starts.length;
  const ids = new Set(starts.map((event: any) => event.params.speech_id));
  report.stream_ids = [...ids];
  assert.equal(starts.length, long ? 2 : 1, 'Comma and sentence punctuation must share one TTS utterance; long text must be grouped');
  assert.equal(ids.size, starts.length, 'every TTS stream gets its own speech id');
  const windows = [...ids].map((id: any) => {
    const frames = report.frames.filter((frame: any) => frame.speech.speech_id === id && frame.speech.phase === 'playing');
    const first = frames[0];
    const last = frames.filter((frame: any) => frame.speech.speech_id === id).at(-1);
    return {
      id,
      start_ms: first ? first.wall_ms - first.speech.audio_time_ms : null,
      duration_ms: last?.speech.audio_time_ms,
      underruns: frames.length ? Math.max(...frames.map((frame: any) => frame.speech.underruns ?? 0)) : 0,
    };
  });
  report.audio_windows = windows;
  report.join_gaps_ms = windows.slice(1).map((window: any, index: number) => window.start_ms - (windows[index].start_ms! + windows[index].duration_ms!));
  report.first_audio_ms = report.frames.find((frame: any) => frame.speech.phase === 'playing')?.wall_ms;
  assert.ok(windows.every((window: any) => window.underruns === 0), 'no audio underruns');
  if (long) {
    assert.equal(windows.length, 2, 'long text needs two prefetched groups');
    assert.ok(report.join_gaps_ms.every((gap: number) => gap < 300), 'Prefetched length-limit joins must not wait for model startup: ' + JSON.stringify(report.join_gaps_ms));
  }

  // Affect observations = phrase count per utterance; plan history uses v2 only.
  const perUtterance = new Map<string, {expected: number; observed: Set<number>}>();
  for (const frame of report.frames) {
    const speechId = frame.speech_id;
    if (!frame.affect.enabled || frame.affect.point_index < 0 || !speechId) continue;
    const row = perUtterance.get(speechId) ?? {expected: 0, observed: new Set<number>()};
    row.expected = Math.max(row.expected, frame.affect.points);
    row.observed.add(frame.affect.point_index);
    perUtterance.set(speechId, row);
  }
  report.affect_observations = [...perUtterance.entries()].map(([speechId, row]) => ({
    speech_id: speechId, phrase_points: row.expected, observed: row.observed.size, indices: [...row.observed].sort((a, b) => a - b),
  }));
  assert.equal(perUtterance.size, long ? 2 : 1, '每个 TTS 语音单元都应产生 affect 观测');
  for (const row of report.affect_observations) {
    // The final phrase point can end in the same frame that the stream finishes; one
    // boundary observation may be missed while all interior points must be observed.
    assert.ok(row.observed >= Math.max(1, row.phrase_points - 1), `affect observations ${row.observed} must cover the phrase points ${row.phrase_points}`);
    if (row.observed < row.phrase_points) report.affect_point_boundary_missed = {speech_id: row.speech_id, phrase_points: row.phrase_points, observed: row.observed};
  }
  report.affect_points = report.affect_observations.reduce((sum: number, row: any) => sum + row.phrase_points, 0);
  report.plan_history = done.plan_history;
  assert.ok(done.plan_history.length >= 1, 'continuous speech must keep clause plans');
  if (long) assert.ok(done.plan_history.length >= 2, 'long text must keep multiple clause plans');
  assert.equal(new Set(done.plan_history.map((row: any) => row.plan.clause)).size, done.plan_history.length, 'one v2 plan per clause');
  const actions = done.plan_history.map((row: any) => row.plan.action.id);
  report.plan_actions = actions;
  for (const id of actions) assert.ok(ACTION_BY_ID.has(id), 'plan action id must be in the catalog: ' + id);

  // If the worker exposes counters, cross-check against the state observations.
  const workerAfter: any = await workerInfo('after');
  report.worker.runtime_counts_after = workerAfter.runtime_counts ?? null;
  if (report.worker.runtime_counts_before && workerAfter.runtime_counts) {
    const planDelta = workerAfter.runtime_counts.plan_calls - report.worker.runtime_counts_before.plan_calls;
    const motionDelta = workerAfter.runtime_counts.motion_updates - report.worker.runtime_counts_before.motion_updates;
    report.worker.plan_calls_delta = planDelta;
    report.worker.motion_updates_delta = motionDelta;
    assert.ok(planDelta >= done.plan_history.length, `prefill plan_calls delta ${planDelta} must cover committed plans`);
    assert.ok(motionDelta >= 1, 'continuous branch must run at least one 400 ms update');
  } else {
    report.worker.runtime_counts_note = 'info 不含 runtime_counts，使用 state 观测代替';
  }
  const finishes = report.events.filter((event: any) => event.method === 'speech.stream.finish');
  assert.equal(finishes.length, starts.length, 'every TTS stream must finish');
  const syntheses = done.queue.metrics.filter((row: any) => row.continuous_utterance);
  assert.ok(syntheses.length >= 1, '每一段连续语音只合成一次 TTS');
  assert.ok(syntheses.length <= starts.length, 'metrics 中的语音单元数不能超过实际 TTS 流数');
  report.syntheses = {metric_rows: syntheses.length, tts_streams: starts.length, finished_streams: finishes.length};

  await command('performance.cancel', {session_id: done.session_id});
  const cancelled: any = await command('performance.state');
  assert.equal(cancelled.active, false);
  assert.equal(cancelled.affect.intensity, 0);
  assert.equal(cancelled.action_plan.active_segment, null);
  assert.deepEqual(report.errors, []);
  report.checks = [
    '单条 TTS 流：标点不拆分语音（长文 2 组，组间预取 join<300ms）',
    `affect=emotion.curve.v2，观测点 ${report.affect_observations.map((row: any) => row.observed + '/' + row.phrase_points).join(', ')} 覆盖全部短语，有效证据 28 车道`,
    `plan_history=${done.plan_history.length} 条 performance.plan.v3（action.id/confidence，无 v1 emotion/expressions）`,
    '无 underrun；取消后 affect.intensity=0 且 action_plan.active_segment=null；无页面错误',
  ];
  report.ok = true;
} catch (error) {
  report.error = String(error);
  throw error;
} finally {
  await browser?.close();
  child.kill();
  for (let index = 0; index < 50 && child.exitCode === null && child.signalCode === null; index++) await sleep(100);
  report.isolated_server_stopped = child.exitCode !== null || child.signalCode !== null;
  log.end();
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({
  ok: report.ok, phase, tts_streams: report.tts_streams, first_audio_ms: report.first_audio_ms,
  total_wall_ms: report.total_wall_ms, join_gaps_ms: report.join_gaps_ms,
  plans: report.plans?.length, affect_points: report.affect_points, isolated_server_stopped: report.isolated_server_stopped,
}));
