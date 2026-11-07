import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ReviewStore,PerformanceReview} from '../server/performance-review';
import {writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {candidatePlan} from '../server/review-candidates';
import {validatePlan} from '../src/performance-plan';
import {EMOTION_LABELS} from '../src/emotion-config';
import {actor,audio,base,id,speechId,plan,run} from './performance-fixture';
import scenarios from '../contracts/review-scenarios.json';

test('100 scenario prompts cover native labels and transitions; intended coverage is not a human label',()=>{
 assert.equal(scenarios.scenarios.length,100);assert.equal(scenarios.coverage_is_ground_truth,false);
 const covered=new Set(scenarios.scenarios.flatMap(s=>s.coverage));assert.deepEqual([...covered].sort(),[...EMOTION_LABELS].sort());
 assert.ok(scenarios.scenarios.some(s=>s.kind==='context'&&s.coverage.length>1));assert.equal(new Set(scenarios.scenarios.map(s=>s.id)).size,100);
 for(const s of scenarios.scenarios)assert.ok(s.text.length<=180&&s.text.length>0);
});
test('candidate exploration preserves vocabulary, neutral none, and produces distinct authored body variants',()=>{
 const affect=Array(64).fill(0);affect[EMOTION_LABELS.indexOf('love')]=1;affect[28+EMOTION_LABELS.indexOf('love')]=1;
 const plans=['A','B','C'].map(c=>candidatePlan(plan(0,'lean'),affect,c as any));
 for(const p of plans)assert.deepEqual(validatePlan(p,0),p);
 assert.equal(new Set(plans.map(p=>p.action.variant)).size,3);assert.ok(plans[1].action.strength<plans[0].action.strength);
 assert.equal(candidatePlan(plan(),Array(64).fill(0),'C').action.id,'none');
 assert.equal(candidatePlan(plan(),affect,'C').action.id,'cajole');
 const p=actor('love');run(p,20,2000);const b=plans[1];
 p.offerPlan({session_id:id,speech_id:speechId,clause:0,plan:b,authored_body:true,input:{review_candidate:'B'}});p.tick(.02,audio(2020),base());
 assert.equal(p.state().plan_history[0].performed_action.variant,b.action.variant,'production emotion styling must not overwrite the reviewed variant');
});
test('human votes require completed current takes and remain immutable across replay or revision',()=>{
 const folder=mkdtempSync(join(tmpdir(),'live2d-review-'));
 try{
  const store=new ReviewStore(folder),caseId='a'.repeat(32);const row={id:caseId,created_at:new Date().toISOString(),audio:{sha256:'f'.repeat(64)},provenance:{runtime_version:'test'},takes:Object.fromEntries(['A','B','C'].map(c=>[c,{id:c,complete:true}]))};store.put(row);
  const vote={case_id:caseId,choice:'B',takes:{A:'A',B:'B',C:'C'},scores:{A:3,B:5,C:null},issues:[],note:''};
  row.takes.C.complete=false;store.put(row);assert.throws(()=>store.rate(vote),/完整观看/);
  row.takes.C.complete=true;store.put(row);assert.throws(()=>store.rate({...vote,takes:{...vote.takes,C:'old'}}),/播放记录/);
  assert.throws(()=>store.rate({...vote,scores:{...vote.scores,A:NaN}}));assert.throws(()=>store.get('../escape'));
  const first=store.rate(vote);assert.equal(first.source,'human');assert.equal(first.training_ready,false);
  const file=join(folder,caseId,'rating-'+first.id+'.json'),original=readFileSync(file,'utf8');
  store.rate({...vote,choice:'neither',issues:['动作太多']});assert.equal(readFileSync(file,'utf8'),original);
  assert.equal(readdirSync(join(folder,caseId)).filter(f=>f.startsWith('rating-')).length,2);
  assert.equal(store.get(caseId).latest_rating.choice,'neither','rejection is a preference label, never an automatic none action target');
 }finally{rmSync(folder,{recursive:true,force:true});}
});

test('failed review submission cancels its newly started session and marks the take interrupted',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'live2d-review-failure-'));let cancelled=0,remaining=2;
 try{
  const performance:any={status:async()=>({ready:true,runtime_version:'test',run:{models:{}}}),startReview:async()=>({session_id:id}),command:async(c:any)=>{
   if(c.method==='performance.state')return {result:{queue:{phase:'finished'}}};
   if(c.method==='performance.finish')throw Error('submission failed');
   if(c.method==='performance.cancel'){cancelled++;return {result:{}};}
  }};
  const review:any=new PerformanceReview(performance,async(c:any)=>({result:c.method==='performance.state'?{motion_actions:{active:remaining-->0}}:{}}),folder,process.cwd());
  const content='{"type":"start"}\n{"type":"end"}\n';
  review.store.put({id,text:'你好。',context:'',status:'ready',takes:{},appearance:{},audio:{sha256:createHash('sha256').update(content).digest('hex'),duration_ms:1000},provenance:{...review.source,model:{runtime_version:'test',run:{models:{}}}}});
  writeFileSync(join(folder,id,'audio.ndjson'),content);
  await assert.rejects(review.command('review.play',{case_id:id,candidate:'A'}),/submission failed/);
  assert.ok(remaining<0,'waited until actual pose released');assert.equal(cancelled,1);assert.equal(review.busy,false);assert.equal(review.store.get(id).takes.A.status,'interrupted');
 }finally{assert.ok(folder.startsWith(join(tmpdir(),'live2d-review-failure-')));rmSync(folder,{recursive:true,force:true});}
});
