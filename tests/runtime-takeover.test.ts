import assert from 'node:assert/strict';
import test from 'node:test';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {PERFORMANCE_RUNTIME_VERSION} from '../src/performance-profile';

const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const next=(socket:WebSocket)=>new Promise<any>((resolve,reject)=>{socket.once('message',data=>resolve(JSON.parse(data.toString())));socket.once('error',reject);});
test('an explicit current-window claim retires old requests and preserves the new owner', {timeout:20000},async()=>{
 const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=(probe.address() as any).port;await new Promise<void>(r=>probe.close(()=>r()));
 const child=spawn(process.execPath,['--import','tsx','server/index.ts','--production'],{cwd:process.cwd(),env:{...process.env,PORT:String(port)},stdio:'ignore'});
 const sockets:WebSocket[]=[];const base=`http://127.0.0.1:${port}`;
 try{
  let manifest:any;
  for(let i=0;i<60;i++){try{manifest=await fetch(base+'/api/manifest').then(r=>r.json());break;}catch{await sleep(100);}}
  assert.ok(manifest,'isolated web service must start');
  const capabilities={action_profile:{sha256:manifest.actionProfile.sha256},methods:['speech.stream.begin'],performance:{runtime_version:PERFORMANCE_RUNTIME_VERSION},parameters:[],drawables:0};
  const a=new WebSocket(`ws://127.0.0.1:${port}/ws`);sockets.push(a);await once(a,'open');
  let answer=false,received!:()=>void;const held=new Promise<void>(r=>received=r);
  a.on('message',raw=>{const m=JSON.parse(raw.toString());if(m.type==='command'){if(!answer){received();return;}a.send(JSON.stringify({type:'result',request_id:m.request_id,response:{status:'applied',result:{owner:'old'}}}));}});
  let response=next(a);a.send(JSON.stringify({type:'hello',role:'runtime',capabilities}));assert.equal((await response).type,'connected');
  const b=new WebSocket(`ws://127.0.0.1:${port}/ws`);sockets.push(b);await once(b,'open');
  b.on('message',raw=>{const m=JSON.parse(raw.toString());if(m.type==='command')b.send(JSON.stringify({type:'result',request_id:m.request_id,response:{status:'applied',result:{owner:'current'}}}));});
  response=next(b);b.send(JSON.stringify({type:'hello',role:'runtime',capabilities}));assert.equal((await response).type,'busy');
  const pending=fetch(base+'/api/state').then(async r=>({status:r.status,body:await r.json()}));await held;
  response=next(b);b.send(JSON.stringify({type:'hello',role:'runtime',capabilities,takeover:true}));assert.equal((await response).type,'connected');
  assert.ok((await pending).status>=400,'old pending command must be rejected');
  await sleep(100);const state:any=await fetch(base+'/api/state').then(r=>r.json());assert.equal(state.result.owner,'current');
  assert.equal(a.readyState,WebSocket.CLOSED);answer=true;
 }finally{for(const socket of sockets)socket.terminate();child.kill();}
});
