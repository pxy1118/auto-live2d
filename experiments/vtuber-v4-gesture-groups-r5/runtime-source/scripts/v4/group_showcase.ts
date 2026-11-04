import {readFileSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs';import {join} from 'node:path';
import {PerformanceController} from '../../src/performance';import {gestureLabels,type GestureName} from '../../src/gesture-library';
import {actingVariants,gestureFingerChannels} from '../../src/gesture-choreography';
import {bodyMotionNames,bodyMotionLabels,bodyMotionVariants} from '../../src/body-motion';
const root=join(import.meta.dirname,'../..'),data=join(root,'datasets/vtuber-v4-native'),media=process.env.MEDIA_DIR??'action-groups-v5',out=join(data,'review',media);mkdirSync(out,{recursive:true});
const read=(p:string)=>JSON.parse(readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const profile=read(join(data,'profile.json')),parameters=read(join(root,'test-results/runtime-capabilities.json')).parameters,channels=[...profile.channels.map((p:any)=>p.id),...gestureFingerChannels];
const dir=join(root,'live2d/DeepSeek/DeepSeek/Animation'),motions=readdirSync(dir).filter(n=>n.endsWith('.motion3.json')).map(file=>({name:file.slice(0,-13),file,hold:true,data:read(join(dir,file))}));
type Spec={name:string;text:string;clipId:string;category:string;context:string;cues:any[];labels:string[]};
const old:[GestureName,string][]=[['wave','body-wave-00-v3'],['point','body-point-00-v3'],['chest','body-chest-00-v3'],['grass',''],['thanks','body-chest-05-v3'],['explain','body-explain-00-v3'],['refuse','body-refuse-00-v3']];
const specs:Spec[]=old.map(([gesture,clipId])=>({name:gesture,text:gestureLabels[gesture],clipId,category:'coordinated',context:'单手手势与前倾、重心转移、侧倾、点头或侧首一起编排；头、躯干错开节奏，另一只手自然垂放。含完整进入、表演和收回。',cues:[0,1,2].map(variant=>({gesture,variant,gesture_hold_ms:gesture==='grass'?2400:1800})),labels:actingVariants[gesture]}));
for(const name of bodyMotionNames)specs.push({name,text:bodyMotionLabels[name],clipId:name==='nod'?'body-chest-05-v3':'body-explain-00-v3',category:'body',context:'只使用头部和躯干，双臂自然垂放。可以独立调用，也能叠加到正在进行的手势；轻摇和点头均为有限节拍，停留不会一直重复。',cues:[0,1,2].map(body_variant=>({body_motion:name,body_variant,body_strength:.9,body_hold_ms:2400})),labels:bodyMotionVariants[name]});
specs.push({name:'mix',text:'身体与手势自由组合',clipId:'body-explain-00-v3',category:'mix',context:'演示独立组合接口：保留手势自身的关节轨迹，再加入身体动作。身体强度与表情强度分别控制，不增加第二只抬起的手。',cues:[{gesture:'wave',variant:0,gesture_hold_ms:2200,body_motion:'turn',body_variant:1,body_strength:.45,body_hold_ms:2400},{gesture:'chest',variant:1,gesture_hold_ms:2200,body_motion:'nod',body_variant:1,body_strength:.65,body_hold_ms:2400},{gesture:'point',variant:0,gesture_hold_ms:2200,body_motion:'lean',body_variant:2,body_strength:.6,body_hold_ms:2400}],labels:['张掌挥手＋侧首回看','抚胸说明＋两次点头','食指点题＋歪头前倾']});
const pairs:any[]=[],proof:any[]=[];
for(let i=0;i<specs.length;i++){
 const spec=specs[i],clip=spec.clipId?read(join(data,'clips',spec.clipId+'.json')):{text:'给你看看这根狗尾草。',audio:'audio/b526bd439fd72c405ac2.wav'},audio=read(join(data,clip.audio.replace('.wav','.json'))),clips:any[]=[];
 for(let variant=0;variant<3;variant++){
  const p=new PerformanceController(parameters,motions as any),id='a'.repeat(32),speech='b'.repeat(32);p.start({session_id:id,motion_backend:'groups'},Object.fromEntries(parameters.map(p=>[p.id,p.default])));p.segment({session_id:id,clause:0,text:clip.text,speech_id:speech});p.direct({...spec.cues[variant],clause:0});
  const values:number[][]=[],face:number[][]=[],eye:number[]=[];let state:any;
  for(let f=0;f<1200;f++){
   const time=f*1000/60,v=p.tick(1/60,{speech_id:speech,phase:time<audio.duration_ms?'playing':'idle',audio_time_ms:Math.min(time,audio.duration_ms)},{});state=p.state();
   values.push(channels.map((id:string)=>v[id]??parameters.find((p:any)=>p.id===id).default));face.push(Array(7).fill(0));eye.push(0);
   if(time>audio.duration_ms+250&&!state.motion_actions.active&&!state.body_action.active&&f>60)break;
  }
  const label=String.fromCharCode(65+variant),name=String(i).padStart(2,'0')+'-'+label,params={channels,values,face,eye,mouth:audio.features.values,images:true,hz:60,image_hz:30,verify_hands:true};
  writeFileSync(join(out,name+'.json'),JSON.stringify(params));clips.push({label:`${label} · ${spec.labels[variant]}`,media:media+'/'+name+'.webp',video:media+'/'+name+'.mp4',audio:clip.audio});proof.push({name:spec.name,category:spec.category,variant,description:spec.labels[variant],directive:spec.cues[variant],frames:values.length,source:'performance.direct typed tool call',state:state.motion_actions,body_state:state.body_action});
 }
 pairs.push({name:spec.name,category:spec.category,text:spec.text+'：'+clip.text,context:spec.context,clips});
}
writeFileSync(join(data,'review/action-group-pairs-v5.json'),JSON.stringify(pairs,null,2));const exp=join(root,'experiments/vtuber-v4-gesture-groups-r5');mkdirSync(exp,{recursive:true});writeFileSync(join(exp,'showcase.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify({groups:pairs.length,variants:proof.length}));
