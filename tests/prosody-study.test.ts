import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {ProsodyConductor,conditions,renderInputs,type Cue} from '../research/vtuber-v4-prosody-study/conductor';
import {GestureLibrary,gestureArmChannels} from '../src/gesture-library';
const path=join(import.meta.dirname,'../research/vtuber-v4-prosody-study/asset-manifest.json');
// Actual asset-native curves, not a fixture that mirrors the policy.
const manifest=()=>JSON.parse(readFileSync(path,'utf8'));
const cue:Cue={at_ms:0,end_ms:3300,index:0,arm:'wave',body:'tilt',variant:0,strength:.45,text:'真实曲线的因果执行检查'};
function scene(){return {duration_ms:9000,cues:[cue],features:{energy:Array(541).fill(.55),beats:Array.from({length:541},(_,i)=>i%60<8?.8*Math.exp(-(i%60)/5):0),values:Array(541).fill(.2)}};}

test('future audio and future cue changes cannot change the committed prefix',()=>{
 const s=scene(),changed=structuredClone(s);
 changed.features.energy.fill(.01,180);changed.features.beats.fill(1,180);
 changed.cues.push({...cue,index:1,at_ms:4200,end_ms:5500,arm:'chest'});
 for(const mode of conditions){const a=renderInputs(manifest(),s,mode),b=renderInputs(manifest(),changed,mode);
  assert.deepEqual(a.params.values.slice(0,180),b.params.values.slice(0,180));}
});
test('pausing the clock is idempotent; repeated events do not replay a gesture',()=>{
 const p=new ProsodyConductor(manifest(),'rhythm_posture');p.begin(cue,0);p.begin(cue,0);
 for(let i=0;i<=100;i++)p.tick(i*1000/60,{energy:.6,beat:0});
 const a=p.tick(100*1000/60,{energy:.6,beat:0}),b=p.tick(100*1000/60,{energy:.6,beat:0});
 assert.deepEqual(a.values,b.values);assert.equal(p.events.filter(e=>e.kind==='begin').length,1);
 assert.throws(()=>p.tick(1,{energy:0,beat:0}),/monotonic/);
});
test('all conditions preserve native single-arm policy, omit wardrobe and drain after speech',()=>{
 const model=manifest();
 for(const condition of conditions){const r=renderInputs(model,scene(),condition);const j=(k:string)=>r.params.channels.indexOf(k);
  for(const row of r.params.values){assert.ok(row.every(Number.isFinite));const right=['Param36','Param39','Param41','Movement1','Movement3'].some(k=>Math.abs(row[j(k)])>.05);
   const left=['Param62','Param59','Param60','Movement2'].some(k=>Math.abs(row[j(k)])>.05);assert.ok(!(right&&left));}
  assert.ok(!r.params.channels.some(k=>/^key/.test(k)));assert.ok(r.trace.every(t=>t.rate>=.85&&t.rate<=1.12));
  assert.ok(r.params.values.at(-1)!.every(v=>Math.abs(v)<.002));
 }
});
test('neutral speech cannot activate arms, body or random accents',()=>{
 const s=scene();s.cues=[{...cue,arm:'none',body:'none',strength:0}];
 for(const condition of conditions){const r=renderInputs(manifest(),s,condition);assert.ok(r.params.values.every(row=>row.every(v=>v===0)));assert.equal(r.accents.length,0);}
});
test('cancel drains offsets and native arm exit; no late result restarts it',()=>{
 const p=new ProsodyConductor(manifest(),'rhythm_posture');p.begin(cue,0);
 for(let f=0;f<=120;f++)p.tick(f*1000/60,{energy:.6,beat:f%60===0?.9:0});
 p.cancel(2000);p.begin({...cue,index:1,at_ms:2100,end_ms:4000},2200);let sample:any;
 for(let f=121;f<600;f++)sample=p.tick(f*1000/60,{energy:.6,beat:.9});
 assert.ok(!sample.arm.active&&!sample.body.active);assert.ok(Object.values(sample.values).every((v:number)=>Math.abs(v)<.001));
});
test('retiming samples the unchanged native arm joint path at one shared clock',()=>{
 const model=manifest(),p=new ProsodyConductor(model,'rhythm_posture'),reference=new GestureLibrary(model.motions);
 p.begin(cue,0);reference.request({name:'wave',id:'reference',source:'model',variant:0,holdMs:1400},0,{});
 for(let f=0;f<420;f++){
  const t=f*1000/60,s=p.tick(t,{energy:f%100<50?.8:.3,beat:f%60===0?.8:0}),expected=reference.tick(s.arm_time_ms,{});
  for(const key of gestureArmChannels)assert.ok(Math.abs((s.values[key]??0)-(expected[key]??0))<1e-10,`${key} was altered independently`);
 }
});
