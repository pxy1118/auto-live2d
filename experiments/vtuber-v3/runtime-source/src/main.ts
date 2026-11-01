import './style.css';
import { Live2DEngine } from './engine';
import type { Parameter } from './controller';
import { mountLatent } from './latent-panel';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <header class="topbar">
    <a class="brand" href="/"><span class="brand-mark">a<span>↗</span></span><span>动作实验台<small>LIVE2D CONTROL LAB</small></span></a>
    <div class="top-right"><span class="version">DEMO / 01</span><span id="connection" class="connection"><i></i>正在载入</span></div>
  </header>
  <main>
    <div class="intro"><div><span class="eyebrow">从语言，到每一个动作</span><h1>让角色动起来<span>。</span></h1><p>探索表情、编排动作，建立可被程序调用的控制接口。</p></div><div class="model-label"><span class="model-dot"></span><div>大肥鱼<small>Live2D · 原画：神宫凉子</small></div></div></div>
    <div class="workbench">
      <section class="stage-shell">
        <div class="stage-top"><div class="stage-title"><span class="live-dot"></span>实时预览<span class="subtle">LOCAL</span></div><div class="stage-tools"><button id="full-view" class="seg active">全身</button><button id="portrait-view" class="seg">半身</button><span class="separator"></span><button class="swatch light active" data-bg="light" aria-label="浅色背景"></button><button class="swatch dark" data-bg="dark" aria-label="深色背景"></button><button class="swatch grid" data-bg="grid" aria-label="网格背景"></button></div></div>
        <div id="stage" class="stage grid-bg"><span class="stage-cross top-left">+</span><span class="stage-cross bottom-right">+</span><canvas id="model-canvas" aria-label="大肥鱼 Live2D 实时模型"></canvas><div class="stage-caption"><span>拖动画面，调整头部与视线</span><span id="fps">— FPS</span></div>
          <div id="loading" class="loading"><div class="loader-ring"></div><strong id="loading-label">正在准备模型</strong><div class="progress-track"><span id="progress"></span></div><p>首次载入需要上传 5 张贴图</p></div>
        </div>
        <div class="playbar"><div><button id="play-demo" class="primary" disabled><span>▶</span> 播放组合演示</button><button id="cancel-timeline" class="icon-button" title="取消时间轴" aria-label="取消时间轴" disabled>■</button><span id="play-status" class="play-status">10 秒 · 转头 / 表情 / 手势</span></div><button id="reset" class="text-button" disabled>↺ 恢复初始状态</button></div>
        <div class="stats"><div><strong id="parameter-count">—</strong><span>参数</span></div><div><strong>23</strong><span>表情</span></div><div><strong>8</strong><span>动画</span></div><div><strong>131</strong><span>物理组</span></div><div class="runtime-caption">CUBISM 5.1<span id="frame-number">FRAME —</span></div></div>
      </section>
      <aside class="controls-shell">
        <div class="controls-heading"><div><span class="eyebrow">CONTROL PANEL</span><h2>角色控制</h2></div><span class="control-indicator">实时生效</span></div>
        <div class="tabs" role="tablist"><button role="tab" aria-selected="true" class="tab active" data-tab="expressions">表情与外观</button><button role="tab" aria-selected="false" class="tab" data-tab="motions">动作</button><button role="tab" aria-selected="false" class="tab" data-tab="parameters">参数</button></div>
        <div class="panel-scroll">
          <section id="panel-expressions" class="tab-panel"><div class="section-line"><h3>面部与配饰</h3><button id="clear-expressions" class="small-link" disabled>清除表情</button></div><div id="face-expressions" class="expression-grid"></div><div class="section-line second"><h3>姿态与外观</h3><span class="section-note">选择或切换</span></div><div id="other-expressions" class="expression-grid"></div><div class="section-line second"><h3>常用控制</h3></div><div id="quick-controls"></div></section>
          <section id="panel-motions" class="tab-panel" hidden><div class="section-line"><h3>手势</h3><button id="stop-motions" class="small-link" disabled>停止动作</button></div><div class="gesture-block"><span class="gesture-side">右手</span><div class="gesture-row"><button data-gesture="right:default">默认手</button><button data-gesture="right:point_index">竖食指</button><button data-gesture="right:grass">狗尾草</button></div></div><div class="gesture-block"><span class="gesture-side">左手</span><div class="gesture-row"><button data-gesture="left:default">默认手</button><button data-gesture="left:chest">抚胸 / 举手</button></div></div><div class="section-line second"><h3>原始动画</h3><span class="section-note">完整 8 个文件</span></div><div id="motion-list" class="motion-list"></div><div class="motion-note">手势使用成对进出动画。原始动画播放会接管当前手势。</div></section>
          <section id="panel-parameters" class="tab-panel" hidden><label class="search-field"><span>⌕</span><input id="parameter-search" placeholder="搜索参数名称或 ID" aria-label="搜索参数" /></label><select id="parameter-group" aria-label="参数分组"><option value="">全部分组</option></select><div class="section-line"><span id="parameter-result-count" class="section-note">正在读取参数</span><button id="release-parameters" class="small-link" disabled>释放参数控制</button></div><div id="parameter-list"></div><button id="more-parameters" class="more-button" hidden>显示更多参数</button><p class="parameter-note">范围从模型运行时读取。物理输出参数在物理后锁定，释放后恢复联动。</p></section>
        </div>
        <div class="behavior-bar"><label><input type="checkbox" id="auto-breath" checked />呼吸</label><label><input type="checkbox" id="auto-blink" checked />眨眼</label><label><input type="checkbox" id="idle-motion" checked />待机</label><label><input type="checkbox" id="physics" checked />物理</label></div>
      </aside>
    </div>
    <section class="api-shell"><div class="api-top"><div><span class="eyebrow">PROGRAMMABLE</span><h2>同一个接口，接入你的程序</h2><p>这里的按钮与外部程序共用控制接口。组合演示由预设脚本驱动。</p></div><div class="recorder"><button id="record" disabled><span class="record-dot"></span>录制动作</button><button id="replay" disabled>↻ 回放</button><span id="record-state">记录控制指令与实际轨迹</span></div></div><div class="api-body"><div class="command-pane"><div class="code-heading"><span>POST /api/command</span><button id="send-command" class="small-link" disabled>执行命令 ↗</button></div><textarea id="command-editor" spellcheck="false" aria-label="JSON 控制命令">{
  "method": "parameters.set",
  "params": {
    "values": { "AngleX": 15, "AngleY": 5 },
    "duration_ms": 600
  }
}</textarea></div><div class="response-pane"><div class="code-heading"><span>执行结果</span><span id="response-status">WAITING</span></div><pre id="command-result">模型就绪后，可在此发送控制指令。</pre></div></div></section>
    <footer><span>AUTO LIVE2D <b>/</b> 本地动作控制 Demo</span><span>原画：神宫凉子 · 模型：大肥鱼</span></footer>
  </main><div id="toast" role="status"></div>`;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const engine = new Live2DEngine($<HTMLCanvasElement>('model-canvas'), (message, percent) => {
  $('loading-label').textContent = message; $('progress').style.width = `${percent}%`;
});
let capabilities: any;
let socket: WebSocket;
let isConnected = false;
let renderedLimit = 35;
let lastRecording: any = null;
let lastState: any = null;
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
function toast(message: string) {
  $('toast').textContent = message; $('toast').classList.add('visible');
  setTimeout(() => $('toast').classList.remove('visible'), 3500);
}
async function run(method: string, params: any = {}, quiet = false) {
  try {
    const response = await fetch('/api/command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method, params }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message ?? data.error);
    if (!quiet) {
      $('command-result').textContent = JSON.stringify(data, null, 2);
      $('response-status').textContent = 'APPLIED'; $('response-status').className = 'success-text';
    }
    updateUI(); return data;
  } catch (error: any) {
    $('response-status').textContent = 'ERROR'; $('response-status').className = 'error-text';
    $('command-result').textContent = error.message; toast(error.message); throw error;
  }
}
function connect() {
  socket = new WebSocket(`ws://${location.host}/ws`);
  socket.onopen = () => socket.send(JSON.stringify({ type: 'hello', role: 'runtime', capabilities }));
  socket.onmessage = async event => {
    const message = JSON.parse(event.data);
    if (message.type === 'connected') {
      isConnected = true; $('connection').innerHTML = '<i></i>本地已连接'; $('connection').classList.add('ready');
      document.querySelectorAll<HTMLButtonElement>('button[disabled]').forEach(b => { if (b.id !== 'replay' && !b.closest('#latent-panel')) b.disabled = false; });
    } else if (message.type === 'command') {
      try { const response = await engine.command(message); socket.send(JSON.stringify({ type: 'result', request_id: message.request_id, response })); }
      catch (error: any) { socket.send(JSON.stringify({ type: 'result', request_id: message.request_id, error: { code: error.code ?? 'command_failed', message: error.message } })); }
    } else if (message.type === 'busy') {
      $('connection').textContent = '已有其他模型窗口'; toast(message.message);
    }
  };
  socket.onclose = () => { isConnected = false; $('connection').textContent = '连接已断开，正在重连'; setTimeout(connect, 1500); };
}

function slider(parameter: Parameter, quick = false) {
  const step = parameter.max === parameter.min ? 1 : Math.max((parameter.max - parameter.min) / 200, 0.001);
  return `<div class="parameter-row ${quick ? 'quick-row' : ''}" data-row="${escapeHtml(parameter.id)}"><div class="parameter-label"><span title="${escapeHtml(parameter.label)}">${escapeHtml(parameter.label.replace(/^\d+\.\s*/, ''))}</span><output data-value="${escapeHtml(parameter.id)}">${parameter.default.toFixed(2)}</output></div>${quick ? '' : `<div class="parameter-id">${escapeHtml(parameter.id)}${parameter.physicsOutput ? '<span>物理输出</span>' : ''}</div>`}<input type="range" data-param="${escapeHtml(parameter.id)}" min="${parameter.min}" max="${parameter.max}" step="${step}" value="${parameter.default}" aria-label="${escapeHtml(parameter.id)}" ${parameter.min === parameter.max ? 'disabled' : ''} /><div class="parameter-range"><span>${Number(parameter.min.toFixed(3))}</span><span>${Number(parameter.max.toFixed(3))}</span></div></div>`;
}
function wireSliders(container: HTMLElement) {
  container.querySelectorAll<HTMLInputElement>('[data-param]').forEach(input => {
    let sentAt = 0;
    const send = () => { sentAt = performance.now(); run('parameters.set', { values: { [input.dataset.param!]: Number(input.value) } }, true).catch(() => {}); };
    input.addEventListener('input', () => {
      container.querySelector<HTMLOutputElement>(`output[data-value="${input.dataset.param}"]`)!.value = Number(input.value).toFixed(2);
      if (performance.now() - sentAt > 65) send();
    });
    input.addEventListener('change', send);
  });
}
function renderParameters() {
  if (!capabilities) return;
  const query = $<HTMLInputElement>('parameter-search').value.trim().toLowerCase();
  const group = $<HTMLSelectElement>('parameter-group').value;
  const matching = capabilities.parameters.filter((p: Parameter) => (!group || p.group === group) && `${p.id} ${p.label}`.toLowerCase().includes(query));
  $('parameter-result-count').textContent = `${matching.length} 个参数 · 显示 ${Math.min(renderedLimit, matching.length)} 个`;
  $('parameter-list').innerHTML = matching.slice(0, renderedLimit).map((p: Parameter) => slider(p)).join('') || '<p class="empty">没有匹配的参数</p>';
  $('more-parameters').hidden = matching.length <= renderedLimit; wireSliders($('parameter-list')); updateUI();
}
function populate() {
  $('parameter-count').textContent = String(capabilities.parameters.length);
  const face = capabilities.expressions.filter((e: any) => e.parameters.some((p: any) => /^key\d+$/.test(p.Id)));
  const other = capabilities.expressions.filter((e: any) => !face.includes(e));
  for (const [id, expressions] of [['face-expressions', face], ['other-expressions', other]] as [string, any[]][]) {
    $(id).innerHTML = expressions.map(e => `<button class="expression" data-expression="${escapeHtml(e.name)}" aria-pressed="false">${escapeHtml(e.name)}</button>`).join('');
  }
  document.querySelectorAll<HTMLButtonElement>('[data-expression]').forEach(button => button.onclick = () => {
    const name = button.dataset.expression!;
    if (['默认体型', '体型1', '体型2'].includes(name)) run('appearance.set', { body: { 默认体型: 'default', 体型1: 'preset1', 体型2: 'preset2' }[name] }).catch(() => {});
    else if (['竖食指开', '竖食指关'].includes(name)) run('gesture.set', { side: 'right', pose: name === '竖食指开' ? 'point_index' : 'default' }).catch(() => {});
    else run('expressions.set', { name, enabled: !lastState?.expressions.some((e: any) => e.name === name) }).catch(() => {});
  });
  const quickLabels = { AngleX: '左右转头', AngleY: '抬头 / 低头', AngleZ: '左右歪头', ParamMouthOpenY: '嘴巴开合' };
  $('quick-controls').innerHTML = Object.entries(quickLabels).map(([id, label]) => slider({ ...capabilities.parameters.find((p: Parameter) => p.id === id), label }, true)).join('');
  wireSliders($('quick-controls'));
  $('motion-list').innerHTML = capabilities.motions.map((m: any) => `<button class="motion-item" data-motion="${escapeHtml(m.name)}"><span class="motion-play">▷</span><span>${escapeHtml(m.name)}<small>${m.hold ? '进入并保持' : ['IDLE', '脱捕'].includes(m.name) ? '循环动画' : '过渡并结束'}</small></span><time>${m.duration.toFixed(2)}s</time></button>`).join('');
  document.querySelectorAll<HTMLButtonElement>('[data-motion]').forEach(button => button.onclick = () => run('motions.play', { name: button.dataset.motion }).catch(() => {}));
  for (const group of new Set<string>(capabilities.parameters.map((p: Parameter) => p.group))) {
    const option = document.createElement('option'); option.value = group; option.textContent = group; $('parameter-group').append(option);
  }
  renderParameters();
}
function updateUI() {
  if (!engine.ready) return;
  const state = engine.control.state(true); lastState = state;
  $('fps').textContent = `${engine.fps || '—'} FPS`; $('frame-number').textContent = `FRAME ${state.frame}`;
  $('play-status').textContent = state.timeline ? `正在演示 · ${(state.time_ms / 1000).toFixed(1)} s` : state.paused ? '已暂停 · 可通过接口逐帧前进' : '10 秒 · 转头 / 表情 / 手势';
  $('play-demo').classList.toggle('playing', state.timeline);
  document.querySelectorAll<HTMLButtonElement>('[data-expression]').forEach(button => {
    const name = button.dataset.expression!;
    const bodyValue = { 默认体型: 0, 体型1: 0.4, 体型2: 1 }[name];
    const active = bodyValue !== undefined ? Math.abs(state.values.Clothes2 - bodyValue) < 0.02 : name === '竖食指开' ? state.gesture.right === 'point_index' : name === '竖食指关' ? state.gesture.right === 'default' : state.expressions.some(e => e.name === name);
    button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll<HTMLButtonElement>('[data-gesture]').forEach(button => {
    const [side, pose] = button.dataset.gesture!.split(':'); button.classList.toggle('active', state.gesture[side] === pose);
  });
  document.querySelectorAll<HTMLInputElement>('[data-param]').forEach(input => {
    const value = state.values[input.dataset.param!];
    if (typeof value !== 'number' || document.activeElement === input) return;
    input.value = String(value);
    input.closest('.parameter-row')!.querySelector('output')!.textContent = value.toFixed(2);
  });
  for (const [id, key] of [['auto-breath', 'breath'], ['auto-blink', 'blink'], ['idle-motion', 'idle'], ['physics', 'physicsEnabled']]) $<HTMLInputElement>(id).checked = state.behavior[key];
  $('record').classList.toggle('recording', !!state.recording);
  $('record').innerHTML = `<span class="record-dot"></span>${state.recording ? '结束并下载' : '录制动作'}`;
  $('record-state').textContent = state.recording ? `${state.recording.frames} 帧 · ${state.recording.commands} 条指令${state.recording.limitReached ? ' · 已达上限' : ''}` : '记录控制指令与实际轨迹';
}

document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(button => button.onclick = () => {
  document.querySelectorAll<HTMLElement>('[data-tab]').forEach(b => { b.classList.toggle('active', b === button); b.setAttribute('aria-selected', String(b === button)); });
  document.querySelectorAll<HTMLElement>('.tab-panel').forEach(panel => panel.hidden = panel.id !== `panel-${button.dataset.tab}`); updateUI();
});
$('full-view').onclick = () => { engine.framing = 'full'; $('full-view').classList.add('active'); $('portrait-view').classList.remove('active'); };
$('portrait-view').onclick = () => { engine.framing = 'portrait'; $('portrait-view').classList.add('active'); $('full-view').classList.remove('active'); };
document.querySelectorAll<HTMLButtonElement>('[data-bg]').forEach(button => button.onclick = () => {
  document.querySelectorAll('[data-bg]').forEach(b => b.classList.toggle('active', b === button));
  $('stage').className = `stage ${button.dataset.bg}-bg`;
});
$('play-demo').onclick = async () => { try { if (!lastState?.recording) await run('engine.reset'); await run('demo.play'); } catch { /* run() displays the failure. */ } };
$('cancel-timeline').onclick = () => run('timeline.cancel').catch(() => {});
$('reset').onclick = () => run('engine.reset').catch(() => {});
$('clear-expressions').onclick = () => run('expressions.clear').catch(() => {});
$('stop-motions').onclick = () => run('motions.stop').catch(() => {});
$('release-parameters').onclick = () => run('parameters.release').catch(() => {});
$('send-command').onclick = () => { try { const command = JSON.parse($<HTMLTextAreaElement>('command-editor').value); run(command.method, command.params).catch(() => {}); } catch { toast('请输入有效的 JSON 命令'); } };
for (const [id, key] of [['auto-breath', 'breath'], ['auto-blink', 'blink'], ['idle-motion', 'idle'], ['physics', 'physicsEnabled']]) $<HTMLInputElement>(id).onchange = event => run('behavior.set', { [key]: (event.target as HTMLInputElement).checked }).catch(() => {});
document.querySelectorAll<HTMLButtonElement>('[data-gesture]').forEach(button => button.onclick = () => { const [side, pose] = button.dataset.gesture!.split(':'); run('gesture.set', { side, pose }).catch(() => {}); });
$<HTMLInputElement>('parameter-search').oninput = () => { renderedLimit = 35; renderParameters(); };
$<HTMLSelectElement>('parameter-group').onchange = () => { renderedLimit = 35; renderParameters(); };
$('more-parameters').onclick = () => { renderedLimit += 50; renderParameters(); };
$('record').onclick = async () => {
  if (!lastState?.recording) { await run('recording.start'); toast('已从初始状态开始录制'); }
  else {
    const data = await run('recording.stop', {}, true); lastRecording = data.result; $<HTMLButtonElement>('replay').disabled = false;
    const url = URL.createObjectURL(new Blob([JSON.stringify(lastRecording)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = `live2d-recording-${Date.now()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast('录制已保存，可点击回放');
  }
};
$('replay').onclick = () => run('recording.replay').catch(() => {});
let dragging = false, pointerSent = 0;
const stage = $('stage');
stage.onpointerdown = event => { if (!engine.ready) return; dragging = true; stage.setPointerCapture(event.pointerId); };
stage.onpointermove = event => {
  if (!dragging || !isConnected || performance.now() - pointerSent < 70) return;
  pointerSent = performance.now(); const rect = stage.getBoundingClientRect();
  const x = Math.max(-1, Math.min(1, (event.clientX - rect.left) / rect.width * 2 - 1));
  const y = Math.max(-1, Math.min(1, 1 - (event.clientY - rect.top) / rect.height * 2));
  run('parameters.set', { values: { AngleX: x * 30, AngleY: y * 25, ParamEyeBallX: x, ParamEyeBallY: y }, duration_ms: 80 }, true).catch(() => {});
};
stage.onpointerup = stage.onpointercancel = () => { if (!dragging) return; dragging = false; run('parameters.set', { values: { AngleX: 0, AngleY: 0, ParamEyeBallX: 0, ParamEyeBallY: 0 }, duration_ms: 350 }, true).catch(() => {}); };

try {
  capabilities = await engine.initialize(); populate(); $('loading').hidden = true; connect();
  mountLatent();
  setInterval(updateUI, 250);
} catch (error: any) {
  console.error(error); $('loading').classList.add('failed'); $('loading-label').textContent = '模型载入失败';
  $('loading').querySelector('p')!.textContent = error.message; $('connection').textContent = '运行时错误';
}
// The HTTP/WebSocket API remains the public control surface; this handle is for local inspection.
(window as any).live2dDemo = { engine, run, get ready() { return engine.ready && isConnected; } };
