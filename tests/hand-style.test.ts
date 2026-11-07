import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {normalizeHandParameters,handDrawingSwitches} from '../src/hand-style';
import {GestureLibrary,gestureNames} from '../src/gesture-library';
const folder=join(import.meta.dirname,'../live2d/DeepSeek/DeepSeek/Animation');
const motions=readdirSync(folder).filter(f=>f.endsWith('.motion3.json')).map(f=>({name:f.slice(0,-13),file:f,hold:true,data:JSON.parse(readFileSync(join(folder,f),'utf8'))}));
test('alternative hand drawings are opaque and exclusive even with fades or post overrides',()=>{
 const indices=new Map<string,number>(handDrawingSwitches.map((id,i)=>[id,i]));
 for(const [values,post,want] of [
  [[.3,.7,.8],{},[0,1,1]],[[.8,.2,.8],{},[1,0,0]],[[1,1,0],{Movement1:.1,Movement3:.9,Movement2:.3},[0,0,1]],
 ] as any[]){normalizeHandParameters(values,indices,post);assert.deepEqual(values,want);for(const k of Object.keys(post))assert.equal(post[k],values[indices.get(k)!]);}
 assert.doesNotThrow(()=>normalizeHandParameters([.7],new Map([['Movement2',0]])));
});
test('lower action amplitude preserves contact and pointing poses; strength scales acting accents',()=>{
 for(const name of gestureNames)for(let variant=0;variant<3;variant++){
  const samples=[];
  for(const strength of [1,.7,.35]){
   const g=new GestureLibrary(motions);assert.equal(g.request({name,variant,strength,id:'sample',holdMs:1400,source:'director'},0,{}),true);
   const state=g.state(0) as any,values=g.tick(state.duration_ms/2,{});samples.push(values);
   for(const id of [...handDrawingSwitches,'Param40'])assert.equal(values[id],samples[0][id],`${name}/${variant}/${strength}/${id}`);
  }
  if(name==='wave'){
   for(const pose of samples)for(const id of ['Param36','Param39','Param41','Param42','Param62','Param60',...handDrawingSwitches])assert.equal(pose[id],0,'no back-of-hand palm substitution');
   continue;
  }
  // Absolute elbow pose remains attached to the intended native hand drawing.
  const joint=samples[0].Movement2>.5?'Param60':'Param41';assert.ok(Math.abs(samples[0][joint])>.01,name);
  if(name!=='grass')assert.equal(samples[2][joint],samples[0][joint]);
  const body=['AngleX','AngleY','AngleZ','PositionX','PositionY','PositionZ','LeanInput'];
  assert.ok(body.some(id=>Math.abs(samples[0][id]-samples[2][id])>.01),name+' body accents respond to strength');
 }
});

test('all pointing variants retain their native finger drawing and wave declares its asset limitation',()=>{
 for(const name of ['point','refuse','explain'] as const)for(let variant=0;variant<3;variant++){
  const g=new GestureLibrary(motions);g.request({name,variant,strength:.7,id:'test',holdMs:1400,source:'director'},0,{});
  const pose=g.tick((g.state(0) as any).duration_ms/2,{});
  assert.equal(name==='explain'&&variant<2?pose.Movement2:pose.Movement3,1);
  assert.equal(Object.hasOwn(pose,'RHand'),false);
 }
 const wave=new GestureLibrary(motions).capabilities().find(c=>c.name==='wave')!;assert.equal(wave.source,'greeting_body_fallback');assert.equal(wave.limitations.length,1);
});
