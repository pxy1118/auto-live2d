import http from 'node:http';
import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import type { Manifest } from '../src/controller';
import { LatentBridge } from './latent-bridge';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const modelRoot = join(root, 'live2d', 'DeepSeek', 'DeepSeek');
const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
const vts = readJson(join(modelRoot, '大肥鱼.vtube.json'));
const expressions = readdirSync(join(modelRoot, 'Exp3')).filter(f => f.endsWith('.exp3.json')).sort().map(file => ({ name: file.slice(0, -10), file, data: readJson(join(modelRoot, 'Exp3', file)) }));
const motions = readdirSync(join(modelRoot, 'Animation')).filter(f => f.endsWith('.motion3.json')).sort().map(file => ({ name: file.slice(0, -13), file, data: readJson(join(modelRoot, 'Animation', file)), hold: vts.Hotkeys.some((h: any) => h.File === file && h.StopsOnLastFrame) }));
const modelSetting = readJson(join(modelRoot, '大肥鱼.model3.json'));
const assetHasher = createHash('sha256');
assetHasher.update(readFileSync(join(modelRoot, modelSetting.FileReferences.Moc)));
for (const texture of modelSetting.FileReferences.Textures) assetHasher.update(readFileSync(join(modelRoot, texture)));
const manifest: Manifest = {
  name: vts.Name, assetHash: '', baseUrl: '/model/', modelUrl: '/model/' + encodeURIComponent('大肥鱼.model3.json'),
  display: readJson(join(modelRoot, '大肥鱼.cdi3.json')), physics: readJson(join(modelRoot, '大肥鱼.physics3.json')), expressions, motions,
};
assetHasher.update(JSON.stringify(manifest)); manifest.assetHash = assetHasher.digest('hex');
const activeExperiment = readJson(join(root, 'latent/default-run.json')).path;
const activeProfile = process.env.LIVE2D_PROFILE ? resolve(root,process.env.LIVE2D_PROFILE) : join(root, activeExperiment, 'profile.json');
manifest.actionProfile = readJson(existsSync(activeProfile) ? activeProfile : join(root, 'latent/profile.json'));
const port = Number(process.env.PORT || 8765);
const production = process.argv.includes('--production');
let runtime: WebSocket | null = null;
let capabilities: any = null;
let latestState: any = null;
const pending = new Map<string, { resolve: (data: any) => void; reject: (error: any) => void; timer: NodeJS.Timeout }>();
const requests = new Map<string, { key: string; promise: Promise<any> }>();
const json = (res: http.ServerResponse, status: number, data: any) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data));
};
function invoke(command: any): Promise<any> {
  if (!command || typeof command.method !== 'string' || command.method.length > 100) return Promise.reject({ code: 'invalid_command', message: 'method 必须为字符串' });
  const requestId = command.request_id ?? randomUUID();
  if (typeof requestId !== 'string' || !requestId.length || requestId.length > 128) return Promise.reject({ code: 'invalid_request_id', message: 'request_id 长度必须为 1～128' });
  const key = JSON.stringify([command.method, command.params ?? {}]);
  const old = requests.get(requestId);
  if (old) return old.key === key ? old.promise : Promise.reject({ code: 'request_id_conflict', message: '相同 request_id 不得用于不同命令' });
  if (!runtime || runtime.readyState !== WebSocket.OPEN || !capabilities) return Promise.reject({ code: 'runtime_offline', message: '请先打开控制台，等待模型加载完成' });
  if (pending.size >= 256) return Promise.reject({ code: 'queue_full', message: '待执行请求过多' });
  const promise = new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => { pending.delete(requestId); reject({ code: 'runtime_timeout', message: '模型页面未及时执行命令；请保持页面打开' }); }, 20000);
    pending.set(requestId, { resolve: resolvePromise, reject, timer });
    runtime!.send(JSON.stringify({ type: 'command', request_id: requestId, method: command.method, params: command.params ?? {} }));
  }).then((response: any) => ({ request_id: requestId, ...response }));
  requests.set(requestId, { key, promise });
  while (requests.size > 512) {
    const finishedId = [...requests.keys()].find(id => !pending.has(id));
    if (!finishedId) break; requests.delete(finishedId);
  }
  return promise;
}
function serveFile(res: http.ServerResponse, base: string, relative: string) {
  const target = resolve(base, relative);
  if (!(target === base || target.startsWith(base + sep)) || !existsSync(target) || !statSync(target).isFile()) { json(res, 404, { error: 'not_found' }); return; }
  const types: Record<string, string> = { '.json': 'application/json', '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.moc3': 'application/octet-stream', '.wasm': 'application/wasm' };
  res.writeHead(200, { 'Content-Type': (types[extname(target)] ?? 'application/octet-stream') + (['.json', '.html', '.js', '.css'].includes(extname(target)) ? '; charset=utf-8' : ''), 'Content-Length': statSync(target).size, 'Cache-Control': 'no-cache' });
  createReadStream(target).pipe(res);
}
const latent = new LatentBridge(manifest, () => capabilities, invoke);
const vite = !production ? await import('vite').then(v => v.createServer({ root, server: { middlewareMode: true, hmr: false }, appType: 'spa' })) : null;
const server = http.createServer(async (req, res) => {
  try {
    const host = req.headers.host ?? `127.0.0.1:${port}`;
    if (req.headers.origin && ![`http://${host}`, `http://localhost:${port}`, `http://127.0.0.1:${port}`].includes(req.headers.origin)) { json(res, 403, { error: 'origin_not_allowed' }); return; }
    const path = decodeURIComponent(new URL(req.url!, `http://${host}`).pathname);
    if (req.method === 'GET' && path === '/api/health') return json(res, 200, { ok: true, runtime_ready: !!capabilities, model: manifest.name, sdk: 'CubismSdkForWeb-5-r.4' });
    if (req.method === 'GET' && path === '/api/manifest') return json(res, 200, manifest);
    if (req.method === 'GET' && path === '/api/capabilities') return json(res, capabilities ? 200 : 503, capabilities ?? { error: 'runtime_offline' });
    if (req.method === 'GET' && path === '/api/state') return json(res, 200, await invoke({ method: 'state.get' }));
    if (req.method === 'GET' && path === '/api/latent/status') return json(res, 200, await latent.status());
    if (req.method === 'GET' && path === '/api/profile') return json(res, 200, manifest.actionProfile);
    if (req.method === 'POST' && ['/api/latent/predict', '/api/latent/execute'].includes(path)) {
      let total = 0; const chunks: Buffer[] = [];
      for await (const chunk of req) { total += chunk.length; if (total > 16000) throw new Error('请求过大'); chunks.push(chunk); }
      const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      return json(res, 200, path.endsWith('/predict') ? await latent.predict(input) : await latent.execute(input));
    }
    if (req.method === 'POST' && path === '/api/command') {
      let total = 0; const chunks: Buffer[] = [];
      for await (const chunk of req) { total += chunk.length; if (total > 64 * 1024 * 1024) { json(res, 413, { error: 'payload_too_large' }); return; } chunks.push(chunk); }
      let command: any;
      try { command = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { json(res, 400, { error: 'invalid_json', message: '请求内容不是有效 JSON' }); return; }
      const response = await invoke(command); return json(res, 200, response);
    }
    if (path.startsWith('/api/')) return json(res, 404, { error: 'unknown_endpoint' });
    const datasetPath = /^\/dataset\/(vtuber-v[123])\/(.*)$/.exec(path);
    if (datasetPath) return serveFile(res, join(root, 'datasets', datasetPath[1]), datasetPath[2]);
    if (path.startsWith('/model/')) return serveFile(res, modelRoot, path.slice(7));
    if (path === '/vendor/cubism/Core/live2dcubismcore.min.js') return serveFile(res, join(root, 'vendor', 'cubism', 'Core'), 'live2dcubismcore.min.js');
    if (vite) vite.middlewares(req, res);
    else serveFile(res, join(root, 'dist'), path === '/' ? 'index.html' : path.slice(1));
  } catch (error: any) {
    if (!res.headersSent) json(res, ['runtime_offline', 'runtime_timeout', 'runtime_disconnected'].includes(error.code) ? 503 : 400, { error: error.code ?? 'request_failed', message: error.message ?? String(error) });
    else res.end();
  }
});
const sockets = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 * 1024 });
sockets.on('connection', (socket, req) => {
  if (req.headers.origin && ![`http://localhost:${port}`, `http://127.0.0.1:${port}`].includes(req.headers.origin)) { socket.close(1008, 'origin_not_allowed'); return; }
  let isRuntime = false;
  socket.on('message', async raw => {
    try {
      const message = JSON.parse(raw.toString());
      if (message.type === 'hello' && message.role === 'runtime') {
        if (message.capabilities?.action_profile?.sha256 !== manifest.actionProfile.sha256 || !message.capabilities?.methods?.includes('trajectory.play')) { socket.send(JSON.stringify({ type: 'busy', message: '控制台版本已更新，请刷新页面后继续' })); return; }
        if (runtime && runtime.readyState === WebSocket.OPEN && runtime !== socket) { socket.send(JSON.stringify({ type: 'busy', message: '另一个模型页面正在执行控制；请关闭它后重试' })); return; }
        runtime = socket; isRuntime = true; capabilities = message.capabilities;
        socket.send(JSON.stringify({ type: 'connected' })); console.log(`Runtime ready: ${capabilities.parameters.length} parameters / ${capabilities.drawables} drawables`);
      } else if (message.type === 'result' && isRuntime) {
        const p = pending.get(message.request_id);
        if (p) { clearTimeout(p.timer); pending.delete(message.request_id); message.error ? p.reject(message.error) : p.resolve(message.response); }
      } else if (message.type === 'state' && isRuntime) latestState = message.state;
      else if (message.type === 'command' && !isRuntime) {
        try { const response = await invoke(message); socket.send(JSON.stringify({ type: 'result', ...response })); }
        catch (error: any) { socket.send(JSON.stringify({ type: 'result', request_id: message.request_id, error: { code: error.code ?? 'request_failed', message: error.message } })); }
      }
    } catch { socket.send(JSON.stringify({ type: 'error', error: 'invalid_message' })); }
  });
  socket.on('close', () => {
    if (runtime === socket) {
      runtime = null; capabilities = null; latestState = null;
      for (const p of pending.values()) { clearTimeout(p.timer); p.reject({ code: 'runtime_disconnected', message: '模型页面已断开' }); }
      pending.clear(); requests.clear();
    }
  });
});
server.listen(port, '127.0.0.1', () => console.log(`\n  动作实验台  http://127.0.0.1:${port}/\n  API         http://127.0.0.1:${port}/api/command\n`));
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
async function stop() { for (const socket of sockets.clients) socket.close(); sockets.close(); await vite?.close(); server.close(() => process.exit(0)); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
