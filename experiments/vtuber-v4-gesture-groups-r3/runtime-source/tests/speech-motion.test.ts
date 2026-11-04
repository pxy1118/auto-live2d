import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SpeechMotionClock,speechAccents } from '../src/speech-motion';
import { jsonLines } from '../server/ndjson';
import { SpeechBridge } from '../server/speech-bridge';

test('body duration follows audio and final duration correction never rewinds phase',()=>{
  const c=new SpeechMotionClock(6400,8000);
  assert.equal(c.at(2000),1600);
  c.finish(10000,2000);assert.equal(c.at(2000),1600);
  assert.equal(c.at(6000),4000);assert.equal(c.at(10000),6400);assert.equal(c.at(15000),6400);
  // Native authored actions keep their physical timing rather than speeding up.
  const native=new SpeechMotionClock(13800,2000,true);assert.equal(native.at(1800),1800);
  native.finish(2500,1000);assert.equal(native.at(2000),2000);
  const provisional=new SpeechMotionClock(6400,1000,false,true);
  assert.ok(provisional.at(4000)<6400);const before=provisional.at(4000);
  provisional.finish(8000,4000);assert.equal(provisional.at(4000),before);assert.equal(provisional.at(8000),6400);
});

test('motion failure aborts the already-open TTS stream; truncation stops its owned session',async t=>{
  const id='a'.repeat(32),commands:any[]=[];let signal:AbortSignal|undefined;
  const response=(lines:any[])=>new Response(new ReadableStream({start(c){for(const line of lines)c.enqueue(new TextEncoder().encode(JSON.stringify(line)+'\n'));c.close();}}),{status:200});
  const fetchMock=t.mock.method(globalThis,'fetch',async(_url:any,options:any)=>{signal=options.signal;return response([{type:'start',speech_id:id}]);});
  const invoke=async(command:any)=>{commands.push(command);return {result:{speech:{enabled:true},recording:null}};};
  const brokenMotion=new SpeechBridge({predict:async()=>{throw new Error('motion failed');}} as any,invoke);
  await assert.rejects(()=>brokenMotion.perform({text:'你好。'},()=>{},new AbortController().signal),/motion failed/);
  assert.ok(signal?.aborted,'failed motion must cancel the concurrent GPU generation');assert.equal(commands.length,1);
  commands.length=0;
  const truncated=new SpeechBridge({} as any,invoke);
  await assert.rejects(()=>truncated.perform({text:'你好。',with_motion:false},()=>{},new AbortController().signal),/中断/);
  assert.deepEqual(commands.map(c=>c.method),['state.get','speech.stream.begin','speech.stop']);
  assert.equal(commands.at(-1).params.speech_id,id);assert.ok(signal?.aborted);
  fetchMock.mock.mockImplementation(async(_url:any,options:any)=>{signal=options.signal;return response([{type:'start',speech_id:id},{type:'end',speech_id:id,total_samples:1},{type:'chunk',speech_id:id}]);});
  commands.length=0;
  await assert.rejects(()=>truncated.perform({text:'你好。',with_motion:false},()=>{},new AbortController().signal),/结束后/);
  assert.equal(commands.at(-1).method,'speech.stop');
});

test('speech emphasis is coupled across head/chest and does not add hand or face switches',()=>{
  const silence=speechAccents(0,0,0);assert.ok(Object.values(silence).every(v=>v===0));
  const onset=speechAccents(.7,.8,0),lagged=speechAccents(.7,.3,.8);
  assert.ok(onset.AngleY<lagged.AngleY);assert.ok(lagged.PositionY<onset.PositionY);
  assert.ok(!Object.keys(onset).some(id=>/Movement|key|Clothes/.test(id)));
});

test('stream parser handles split UTF8 and rejects truncated or oversized data',async()=>{
  const raw=new TextEncoder().encode('{"text":"语音"}\n{"type":"end"}\n');
  const stream=(parts:Uint8Array[])=>new ReadableStream<Uint8Array>({start(c){parts.forEach(p=>c.enqueue(p));c.close();}});
  const parsed=[];for await(const event of jsonLines(stream([raw.slice(0,10),raw.slice(10,13),raw.slice(13)])))parsed.push(event);
  assert.deepEqual(parsed,[{text:'语音'},{type:'end'}]);
  await assert.rejects(async()=>{for await(const _ of jsonLines(stream([raw.slice(0,-1)]))){}},/中断/);
  await assert.rejects(async()=>{for await(const _ of jsonLines(stream([new Uint8Array(1024*1024+1)]))){}},/过大/);
});
