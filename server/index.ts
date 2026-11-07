import http from 'node:http';
import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import type { Manifest } from '../src/controller';
import { PerformanceService } from './performance-service';
import { PERFORMANCE_RUNTIME_VERSION } from '../src/performance-profile';
import { RequestLedger } from './request-ledger';
import {PerformanceReview} from './performance-review';

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
manifest.actionProfile = readJson(process.env.LIVE2D_PROFILE ? resolve(root,process.env.LIVE2D_PROFILE) : join(root,'latent/runtime-profile.json'));
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
  const types: Record<string, string> = { '.json': 'application/json', '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.mp4':'video/mp4', '.moc3': 'application/octet-stream', '.wasm': 'application/wasm', '.wav':'audio/wav' };
  res.writeHead(200, { 'Content-Type': (types[extname(target)] ?? 'application/octet-stream') + (['.json', '.html', '.js', '.css'].includes(extname(target)) ? '; charset=utf-8' : ''), 'Content-Length': statSync(target).size, 'Cache-Control': 'no-cache' });
  createReadStream(target).pipe(res);
}
const performanceService = new PerformanceService(invoke);
const performanceReview=new PerformanceReview(performanceService,invoke,process.env.LIVE2D_REVIEW_ROOT?resolve(process.env.LIVE2D_REVIEW_ROOT):join(root,'datasets/emotion-acting-review-v1'),root);
const reviewMethods=['review.list','review.get','review.create','review.play','review.stop','review.rate'];
const publicMethods=new Set(['performance.start','performance.append','performance.finish','performance.cancel','performance.state','performance.status','performance.direct','performance.release','appearance.update','appearance.get','capabilities.get','state.get','engine.pause','speech.unlock',...reviewMethods]);
const publicRequests=new RequestLedger();
const publicCommand=(command:any)=>{
  if(!publicMethods.has(command?.method)&&!reviewMethods.includes(command?.method))return Promise.reject(Object.assign(new Error('不支持的控制方法'),{code:'unknown_method',httpStatus:404}));
  const id=command?.request_id??randomUUID();if(typeof id!=='string'||!id.length||id.length>128)return Promise.reject(new Error('request_id 不合法'));
  const key=JSON.stringify([command?.method,command?.params??{}]);
  return publicRequests.execute(id,key,()=>{
    if(performanceReview.busy&&['performance.start','performance.append','performance.finish','performance.direct','performance.release','appearance.update'].includes(command.method))throw Error('正在比较候选，请先停止评分播放');
    return (reviewMethods.includes(command.method)?performanceReview.command(command.method,command.params??{}).then(result=>({status:'applied',request_id:id,result})):performanceService.handles(command?.method)?performanceService.command({...command,request_id:id}):invoke({...command,request_id:id})).then(async response=>{
    const audit=join(root,'test-results/v4/audit/capabilities.json');
    if(command?.method==='capabilities.get'&&existsSync(audit)){
      const evidence=readJson(audit);
      if(evidence.asset_hash===manifest.assetHash){
        const byId=new Map(evidence.parameters.map((p:any)=>[p.id,p]));
        response.result.parameters=response.result.parameters.map((p:any)=>({...p,...byId.get(p.id) as any}));
        response.result.channels=response.result.channels.map((p:any)=>({...p,...byId.get(p.id) as any}));
        response.result.verification=evidence.visible_change_method;
      }
    }
    if(command?.method==='capabilities.get'){
      response.result.methods=[...publicMethods];
      const active=await performanceService.status();
      response.result.experimental=active.experimental??true;response.result.promoted=active.promoted??false;
      response.result.active_performance={stage:active.stage??null,driver:active.driver??'emotion_catalog',runtime_version:active.runtime_version??null,models:active.models??[],emotion_classifier:active.emotion_classifier??null,affect:active.affect??null,action_catalog:active.action_catalog??null};
    }
    return response;
  });});
};
const vite = !production ? await import('vite').then(v => v.createServer({ root, server: { middlewareMode: true, hmr: false }, appType: 'spa' })) : null;
const server = http.createServer(async (req, res) => {
  try {
    const host = req.headers.host ?? `127.0.0.1:${port}`;
    if (req.headers.origin && ![`http://${host}`, `http://localhost:${port}`, `http://127.0.0.1:${port}`].includes(req.headers.origin)) { json(res, 403, { error: 'origin_not_allowed' }); return; }
    const path = decodeURIComponent(new URL(req.url!, `http://${host}`).pathname);
    if (req.method === 'GET' && path === '/api/health') return json(res, 200, { ok: true, runtime_ready: !!capabilities, process_id:process.pid,port,runtime_version:PERFORMANCE_RUNTIME_VERSION,model: manifest.name, sdk: 'CubismSdkForWeb-5-r.4' });
    if (req.method === 'GET' && path === '/api/manifest') return json(res, 200, manifest);
    if (req.method === 'GET' && path === '/api/capabilities') return json(res, capabilities ? 200 : 503, capabilities ? {...capabilities,methods:[...publicMethods]} : { error: 'runtime_offline' });
    if (req.method === 'GET' && path === '/api/state') return json(res, 200, await invoke({ method: 'state.get' }));
    if (req.method === 'POST' && path === '/api/command') {
      let total = 0; const chunks: Buffer[] = [];
      for await (const chunk of req) { total += chunk.length; if (total > 64 * 1024 * 1024) { json(res, 413, { error: 'payload_too_large' }); return; } chunks.push(chunk); }
      let command: any;
      try { command = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { json(res, 400, { error: 'invalid_json', message: '请求内容不是有效 JSON' }); return; }
      const response = await publicCommand(command); return json(res, 200, response);
    }
    if (path.startsWith('/api/')) return json(res, 404, { error: 'unknown_endpoint' });
    if (path.startsWith('/model/')) return serveFile(res, modelRoot, path.slice(7));
    if (path === '/vendor/cubism/Core/live2dcubismcore.min.js') return serveFile(res, join(root, 'vendor', 'cubism', 'Core'), 'live2dcubismcore.min.js');
    if (vite) vite.middlewares(req, res);
    else serveFile(res, join(root, 'dist'), path === '/'||path==='/review' ? 'index.html' : path.slice(1));
  } catch (error: any) {
    if (!res.headersSent) json(res, error.httpStatus??(['runtime_offline', 'runtime_timeout', 'runtime_disconnected'].includes(error.code) ? 503 : 400), { error: error.code ?? 'request_failed', message: error.message ?? String(error) });
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
        if (message.capabilities?.action_profile?.sha256 !== manifest.actionProfile.sha256 || !message.capabilities?.methods?.includes('speech.stream.begin') || message.capabilities?.performance?.runtime_version!==PERFORMANCE_RUNTIME_VERSION) { socket.send(JSON.stringify({ type: 'busy', message: '控制台版本已更新，请刷新页面后继续' })); return; }
        if (runtime && runtime.readyState === WebSocket.OPEN && runtime !== socket) {
          if(message.takeover!==true){socket.send(JSON.stringify({ type: 'busy', message: '另一个模型页面正在执行控制；点击开始表演可切换到当前窗口' }));return;}
          const previous=runtime;
          performanceService.disconnect();
          performanceReview.disconnect();
          for(const p of pending.values()){clearTimeout(p.timer);p.reject({code:'runtime_replaced',message:'控制权已切换到另一个角色窗口'});}
          pending.clear();requests.clear();publicRequests.retireAll();latestState=null;
          // Assign the new owner before the old socket's asynchronous close event.
          runtime=socket;previous.close(1000,'runtime_transferred');
        }
        runtime = socket; isRuntime = true; capabilities = message.capabilities;
        socket.send(JSON.stringify({ type: 'connected' })); console.log(`Runtime ready: ${capabilities.parameters.length} parameters / ${capabilities.drawables} drawables`);
      } else if (message.type === 'result' && isRuntime && runtime===socket) {
        const p = pending.get(message.request_id);
        if (p) { clearTimeout(p.timer); pending.delete(message.request_id); message.error ? p.reject(message.error) : p.resolve(message.response); }
      } else if (message.type === 'state' && isRuntime && runtime===socket) latestState = message.state;
      else if (message.type === 'command' && !isRuntime) {
        try { const response = await publicCommand(message); socket.send(JSON.stringify({ type: 'result', ...response })); }
        catch (error: any) { socket.send(JSON.stringify({ type: 'result', request_id: message.request_id, error: { code: error.code ?? 'request_failed', message: error.message } })); }
      }
    } catch { socket.send(JSON.stringify({ type: 'error', error: 'invalid_message' })); }
  });
  socket.on('close', () => {
    if (runtime === socket) {
      runtime = null; capabilities = null; latestState = null;
      for (const p of pending.values()) { clearTimeout(p.timer); p.reject({ code: 'runtime_disconnected', message: '模型页面已断开' }); }
      pending.clear(); requests.clear();
      performanceService.disconnect();
      performanceReview.disconnect();
      publicRequests.retireAll();
    }
  });
});
server.listen(port, '127.0.0.1', () => console.log(`\n  Live2D      http://127.0.0.1:${port}/\n  API         http://127.0.0.1:${port}/api/command\n`));
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
async function stop() { for (const socket of sockets.clients) socket.close(); sockets.close(); await vite?.close(); server.close(() => process.exit(0)); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
if(process.platform==='win32')process.on('SIGBREAK', stop);
