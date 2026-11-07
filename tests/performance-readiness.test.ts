import assert from 'node:assert/strict';
import test from 'node:test';
import {PerformanceService} from '../server/performance-service';

test('playback readiness waits for both motion and Qwen, including voice startup failure',async()=>{
 const original=globalThis.fetch;let ttsReady=false,failVoice=false;
 globalThis.fetch=(async (url:any)=>{
  if(String(url).endsWith('/stream/status'))return Response.json({ready:true,promoted:true,runtime_version:'test'});
  if(failVoice)throw Error('not listening yet');return Response.json({ready:ttsReady});
 }) as typeof fetch;
 try{
  const service=new PerformanceService(async()=>{throw Error('readiness must not mutate renderer');});
  assert.equal((await service.status()).ready,false);failVoice=true;assert.equal((await service.status()).ready,false);
  failVoice=false;ttsReady=true;const ready=await service.status();assert.equal(ready.ready,true);assert.equal(ready.promoted,true);assert.equal(ready.tts_ready,true);
 }finally{globalThis.fetch=original;}
});
