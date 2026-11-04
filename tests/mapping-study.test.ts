import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {AssetInputMapper,bump,microAt,generateMappedInputs,conditions} from '../research/vtuber-v4-mapping-r1/mapping';
const root=join(import.meta.dirname,'..');
const settings=JSON.parse(readFileSync(join(root,'live2d/DeepSeek/DeepSeek/大肥鱼.vtube.json'),'utf8').replace(/^\uFEFF/,'')).ParameterSettings;
const input=(x=0,y=0,z=0)=>({FaceAngleX:x,FaceAngleY:y,FaceAngleZ:z,EyeRightX:0,EyeRightY:0});

test('actual asset uses one head input for two outputs with independent time constants',()=>{
 const m=new AssetInputMapper(settings);let v:any;
 for(let f=0;f<60;f++){v=m.step(input(10),1/60);if(f===0){assert.ok(v.AngleX>v.PositionX&&v.PositionX>0);}}
 assert.ok(Math.abs(v.AngleX-10)<.001&&Math.abs(v.PositionX-10)<.001);assert.equal(m.rows.length,8);
});
test('pitch inverse preserves the intended head amplitude; gaze inverse respects asset axis direction',()=>{
 const m=new AssetInputMapper(settings);assert.equal(m.inverse('AngleY',15),10);
 assert.ok(Math.abs(m.inverse('ParamEyeBallX',.5)+.30000001192092896)<1e-10);
 let v:any;for(let i=0;i<120;i++)v=m.step({...input(0,10),EyeRightX:m.inverse('ParamEyeBallX',.5)},1/60);
 assert.ok(Math.abs(v.AngleY-15)<1e-9);assert.ok(Math.abs(v.PositionY-10)<1e-5);assert.ok(Math.abs(v.ParamEyeBallX-.5)<1e-9);
});
test('exact exponential filters respect elapsed time and a paused clock',()=>{
 const a=new AssetInputMapper(settings),b=new AssetInputMapper(settings);let x:any,y:any;
 for(let i=0;i<60;i++)x=a.step(input(12),1/60);for(let i=0;i<20;i++)y=b.step(input(12),1/20);
 for(const k of Object.keys(x))assert.ok(Math.abs(x[k]-y[k])<1e-10);
 assert.deepEqual(a.step(input(-20),0),x);assert.throws(()=>a.step(input(),-.1),/interval/);
});
test('finite micro envelopes start and finish at zero position, velocity and acceleration',()=>{
 const h=.0001;for(const x of [0,900]){const f=(t:number)=>bump(t,200,400,300);assert.equal(f(x),0);
  assert.ok(Math.abs((f(x+h)-f(x-h))/(2*h))<1e-8);assert.ok(Math.abs((f(x+h)-2*f(x)+f(x-h))/(h*h))<1e-7);}
});
test('future cues cannot change past micro output and neutral receives no extra reactions',()=>{
 const s={id:'shy',cues:[{at_ms:0,index:0}]},future={...s,cues:[...s.cues,{at_ms:8000,index:1}]};
 for(let t=0;t<5000;t+=17)assert.deepEqual(microAt(s,t),microAt(future,t));
 assert.deepEqual(microAt({id:'neutral',cues:s.cues},1000),{gazeX:0,gazeY:0,headX:0,headY:0,brows:0,smile:0,lid:1});
});
test('mapping replaces torso ownership, preserves arms, and is prefix causal',()=>{
 const ids=['AngleX','AngleY','AngleZ','PositionX','PositionY','PositionZ','LeanInput','Param36','Movement3','ParamEyeBallX','ParamEyeBallY'];
 const base={params:{channels:ids,values:Array.from({length:600},()=>[7,3,2,-25,-20,-15,-3,.27,1,0,0])}};
 const scene={id:'shy',cues:[{at_ms:0,index:0}]};
 for(const c of conditions){const a=generateMappedInputs(settings,base,scene,c),changed=structuredClone(base);changed.params.values.fill([0,0,0,0,0,0,0,0,0,0,0],300);
  const b=generateMappedInputs(settings,changed,scene,c);assert.deepEqual(a.params.values.slice(0,300),b.params.values.slice(0,300));
  const j=(k:string)=>a.params.channels.indexOf(k);assert.ok(a.params.values.every(r=>r[j('Param36')]===.27&&r[j('Movement3')]===1&&r[j('LeanInput')]===-3));
  if(c==='mapped')assert.ok(Math.abs(a.params.values.at(-1)![j('PositionX')]-7)<.001,'old torso offset was added again');
 }
});
