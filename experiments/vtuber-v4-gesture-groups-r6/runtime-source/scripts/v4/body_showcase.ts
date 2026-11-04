import { readFileSync,mkdirSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PerformanceController } from '../../src/performance';
const root=join(import.meta.dirname,'../..'),data=process.env.DATASET_ROOT??join(root,'datasets/vtuber-v4-body-float'),kind=process.env.KIND??'regression',media=process.env.MEDIA_DIR??'quiet-regression',out=join(data,'review',media);mkdirSync(out,{recursive:true});
const read=(path:string)=>JSON.parse(readFileSync(path,'utf8').replace(/^\uFEFF/,''));
for(let i=0;i<60;i++){try{const r=await fetch((process.env.LATENT_URL??'http://127.0.0.1:8768')+'/stream/status');if((await r.json() as any).ready)break;}catch{}await new Promise(r=>setTimeout(r,1000));}
const parameters=read(join(root,'test-results/runtime-capabilities.json')).parameters;
const profile=read(join(data,'profile.json')),channels=profile.channels.map((p:any)=>p.id);
const names=['黑脸','流泪','脸红','加载','兔牙','流冷汗'],eyes=['normal','＞＜','圈圈眼','爱心眼','屑屑眼'];
const groups=[['ordinary_calm','日常自动说话'],['ordinary_shy','害羞但不持续摆手'],['wave','需要时挥手问候'],['explain','需要时解释与展开手臂'],['point','需要时抬手指出重点'],['chest','需要时抚胸表达自己'],['cheer','需要时双臂庆祝'],['refuse','需要时抬手拒绝与摇头']];
const pairs:any[]=[],evidence:any[]=[];
for(let index=0;index<groups.length;index++){
 const [family,title]=groups[index],ordinary=family.startsWith('ordinary'),clip=read(join(data,'clips',ordinary?(family==='ordinary_calm'?'s000-v2.json':'s003-v2.json'):`body-${family}-00-v3.json`)),audio=read(join(data,clip.audio.replace('.wav','.json')));
 if(ordinary)clip.context=family==='ordinary_calm'?'自然地和观众聊天，角色本人情绪平静。':'自然地和观众聊天，略感害羞。';
 const controller=new PerformanceController(parameters);const id='a'.repeat(32),speech='b'.repeat(32);
 controller.start({session_id:id},Object.fromEntries(parameters.map(p=>[p.id,p.default])));controller.segment({session_id:id,clause:0,speech_id:speech,text:clip.text});
 if(!ordinary)controller.direct({gesture_hint:clip.context,intensity:1,hold_ms:3000,cue_id:'one-example-gesture'});
 const values:number[][]=[],faces:number[][]=[],eyeTypes:number[]=[];const n=clip.values.length;
 let checkpoint:string|undefined;
 for(let frame=0;frame<n;frame+=8){
  const state=controller.state(),start=Math.max(state.media_ms+70,state.committed_until_ms),feature:number[][]=[],mask:number[]=[];
  for(let i=0;i<24;i++){
   const at=start+i*50;let j=audio.features.motion_times_ms.findIndex((t:number)=>t>at);if(j<0)j=audio.features.motion_times_ms.length;j=Math.max(0,j-1);
   const available=at<=audio.duration_ms;feature.push(available?audio.features.motion[j]:Array(12).fill(0));mask.push(available?1:0);
  }
  const currentEyes=eyes.map((name,i)=>i?state.expressions[name]??0:0),eye=currentEyes.indexOf(Math.max(...currentEyes));
  const face_state=[...names.map(name=>state.expressions[name]??0),currentEyes[eye]??0,...eyes.map((_,i)=>i===eye?1:0)];
  const response=await fetch((process.env.LATENT_URL??'http://127.0.0.1:8768')+'/stream/predict',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:clip.text,context:clip.context,kind,seed:41+Math.round(start/400),state:state.values,history:state.history,audio:feature,audio_mask:mask,face_state})});
  const prediction:any=await response.json();if(!response.ok)throw new Error(JSON.stringify(prediction));checkpoint=prediction.provenance.checkpoint_sha256;
  controller.chunk({...prediction,session_id:id,start_ms:start});
  for(let i=0;i<Math.min(8,n-frame);i++){
   const result=controller.tick(.05,{speech_id:speech,phase:'playing',audio_time_ms:(frame+i)*50},{}),state=controller.state();
   values.push(channels.map(id=>result[id]??profile.channels.find(p=>p.id===id).default));
   const scores=eyes.map(name=>state.expressions[name]??0),eye=scores.indexOf(Math.max(...scores));
   faces.push([...names.map(name=>state.expressions[name]??0),scores[eye]??0]);eyeTypes.push(eye);
  }
 }
 const a={channels,values,face:faces,eye:eyeTypes,mouth:audio.features.values,images:true};
 const targetController=new PerformanceController(parameters);targetController.start({session_id:id},Object.fromEntries(parameters.map(p=>[p.id,p.default])));targetController.segment({session_id:id,clause:0,speech_id:speech,text:clip.text});
 if(!ordinary)targetController.direct({gesture_hint:clip.context,intensity:1,hold_ms:3000,cue_id:'one-target-gesture'});
 const targetValues:number[][]=[];
 for(let frame=0;frame<n;frame++){
  if(frame%8===0){const state=targetController.state(),start=Math.max(state.media_ms+70,state.committed_until_ms);targetController.chunk({session_id:id,start_ms:start,channels,values:Array.from({length:24},(_,i)=>clip.values[Math.min(n-1,frame+i)]),motor_probability:ordinary?0:1});}
  const row=targetController.tick(.05,{speech_id:speech,phase:'playing',audio_time_ms:frame*50},{});targetValues.push(channels.map(id=>row[id]??profile.channels.find(p=>p.id===id).default));
 }
 const b={channels,values:targetValues,face:clip.face,eye:clip.eye,mouth:audio.features.values,images:true};
 const id0=String(index).padStart(2,'0');writeFileSync(join(out,id0+'-A.json'),JSON.stringify(a));writeFileSync(join(out,id0+'-B.json'),JSON.stringify(b));
 const item={text:title+'：'+clip.text,context:ordinary?'自动会话，不指定手势；默认克制。':'明确要求一次短动作，结束后回位。模型生成连续参数；示范目标另行标记。',clips:[
  {label:kind==='flow'?'Flow 模型实际生成':'回归模型实际生成',media:`${media}/${id0}-A.webp`,video:`${media}/${id0}-A.mp4`,audio:clip.audio},
  {label:'同样限制频率的示范目标',media:`${media}/${id0}-B.webp`,video:`${media}/${id0}-B.mp4`,audio:clip.audio}]};pairs.push(item);
 const motion=Object.fromEntries(['Param36','Param41','Param42','Param62','Param60','Param61','PositionX','PositionZ'].map(id=>{const j=channels.indexOf(id),a=values.map(row=>row[j]);return [id,{min:Math.min(...a),max:Math.max(...a),range:Math.max(...a)-Math.min(...a)}];}));
 evidence.push({family,checkpoint_sha256:checkpoint,source:'streaming_policy_v4 plus restrained session compiler',held_out_split:clip.split,gesture_policy:controller.state().gesture_policy,motion});console.log(JSON.stringify({family,gesture_policy:controller.state().gesture_policy,motion}));
}
writeFileSync(join(data,`review/quiet-pairs-${kind}.json`),JSON.stringify(pairs,null,2));writeFileSync(join(root,`experiments/vtuber-v4-restrained/body-evidence-${kind}.json`),JSON.stringify(evidence,null,2));
