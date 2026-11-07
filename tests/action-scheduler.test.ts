import assert from 'node:assert/strict';
import test from 'node:test';
import {ActionScheduler} from '../src/action-scheduler';
import {ActionRegistry,ACTION_CATALOG} from '../src/action-catalog';
import {plan} from './performance-fixture';
const clock=(actionMs=0,directorBusy=false)=>({actionMs,playing:true,directorBusy});
function rig(registry?:ActionRegistry){
 let active=false,releases=0;const requests:any[]=[];
 const s=new ActionScheduler({requestGesture:r=>{requests.push(r);active=true;return true;},requestBody:r=>{requests.push(r);active=true;return true;},pose:()=>({active,phase:'hold'}),release:()=>{releases++;},gaps:()=>({arm:1000,body:800})},{registry,sameActionWindowMs:2500});
 return {s,requests,finish:()=>active=false,get releases(){return releases;}};
}
test('one event owns the pose; busy, director priority, duplicate, cooldown, repeat',()=>{
 const r=rig();assert.equal(r.s.requestPlan(plan(0,'wave'),clock()).committed,true);
 assert.equal(r.s.requestPlan(plan(100,'nod'),clock(300)).reason,'transition');assert.equal(r.requests.length,1);r.s.discardPendingModel();r.finish();
 assert.equal(r.s.requestPlan(plan(0,'wave'),clock(500)).reason,'duplicate');
 assert.equal(r.s.requestPlan(plan(1,'point'),clock(500)).reason,'cooldown');
 assert.equal(r.s.requestPlan(plan(1,'wave'),clock(1500)).reason,'repeat');
 assert.equal(r.s.requestPlan(plan(1,'point'),clock(1600,true)).reason,'director');
 assert.equal(r.s.requestPlan(plan(1,'nod'),clock(1600)).committed,true);
 assert.equal(r.requests.length,2);assert.equal(r.s.history(1800).last_action,'nod');
 assert.deepEqual(Object.keys(r.s.history(1800)).sort(),['age_ms','last_action','last_variant','phase']);
});
test('manual replacement waits for native exit and release cancels pending requests',()=>{
 const r=rig();r.s.requestPlan(plan(0,'wave'),clock());
 const request={id:'nod',event_id:'cue:1',source:'director' as const,cue_id:'a',variant:1,strength:.8,hold_ms:1000};
 assert.equal(r.s.request(request,clock(100)).reason,'transition');assert.equal(r.requests.length,1);assert.equal(r.releases,1);
 r.s.tick(clock(500));assert.equal(r.requests.length,1);r.finish();r.s.tick(clock(700));assert.equal(r.requests.length,2);
 r.s.request({...request,event_id:'cue:2',cue_id:'b'},clock(800));r.s.release(clock(800),'b');r.finish();r.s.tick(clock(1200));assert.equal(r.requests.length,2);
});

test('a later model cue waits in the same queue for safe exit and stale clauses discard it',()=>{
 const r=rig();r.s.requestPlan(plan(0,'cajole'),clock());
 const next=r.s.requestPlan(plan(1,'chest'),clock(1200));assert.equal(next.reason,'transition');assert.equal(r.releases,1);assert.equal(r.s.state().pending,'chest');
 r.s.tick(clock(1400));assert.equal(r.requests.length,1);r.finish();r.s.tick(clock(1800));assert.equal(r.requests[1].name,'chest');assert.equal(r.s.history(1800).last_action,'chest');
 r.s.requestPlan(plan(2,'shake'),clock(3000));assert.equal(r.s.state().pending,'shake');r.s.discardPendingModel();r.finish();r.s.tick(clock(3500));assert.equal(r.requests.length,2);
});
test('registered future segment uses the same owner without model vocabulary changes',()=>{
 const registry=new ActionRegistry(ACTION_CATALOG);
 registry.register({id:'test.future',kind:'segment',label:'test',emotion:'joy',variants:1,intensity:[0,1],default_hold_ms:1200,cooldown_group:'body',phases:[{at_ms:0,body_motion:'nod',body_hold_ms:500}]});
 const r=rig(registry);r.s.request({id:'test.future',event_id:'f',source:'director',variant:0,strength:1,hold_ms:1000},clock());r.s.tick(clock());
 assert.equal(r.requests[0].name,'nod');assert.equal(r.s.history(100).last_action,'test.future');r.finish();r.s.tick(clock(1300));assert.equal(r.s.state().active_segment,null);
});
