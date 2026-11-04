import {readFileSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs';import {join} from 'node:path';
import {PerformanceController} from '../../src/performance';import {gestureLabels,type GestureName} from '../../src/gesture-library';
const root=join(import.meta.dirname,'../..'),data=join(root,'datasets/vtuber-v4-native'),media='action-groups-v1',out=join(data,'review',media);mkdirSync(out,{recursive:true});
const read=(p:string)=>JSON.parse(readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const profile=read(join(data,'profile.json')),parameters=read(join(root,'test-results/runtime-capabilities.json')).parameters,channels=profile.channels.map((p:any)=>p.id);
const dir=join(root,'live2d/DeepSeek/DeepSeek/Animation'),motions=readdirSync(dir).filter(n=>n.endsWith('.motion3.json')).map(file=>({name:file.slice(0,-13),file,hold:true,data:read(join(dir,file))}));
const specs:[GestureName,string][]=[['chest','body-chest-00-v3'],['grass',''],['wave','body-wave-00-v3'],['cheer','body-cheer-00-v3'],['point','body-point-00-v3'],['thanks','body-chest-05-v3'],['explain','body-explain-00-v3'],['refuse','body-refuse-00-v3']];
const pairs:any[]=[],proof:any[]=[];
for(let i=0;i<specs.length;i++){
 const [gesture,clipId]=specs[i],clip=clipId?read(join(data,'clips',clipId+'.json')):{text:'给你看看这根狗尾草。',audio:'audio/b526bd439fd72c405ac2.wav'},audio=read(join(data,clip.audio.replace('.wav','.json'))),clips:any[]=[];
 for(let variant=0;variant<2;variant++){
  const p=new PerformanceController(parameters,motions as any),id='a'.repeat(32),speech='b'.repeat(32);p.start({session_id:id,motion_backend:'groups'},Object.fromEntries(parameters.map(p=>[p.id,p.default])));p.segment({session_id:id,clause:0,text:clip.text,speech_id:speech});p.direct({gesture,gesture_hold_ms:gesture==='grass'?2400:1400,variant,clause:0});
  const values:number[][]=[],face:number[][]=[],eye:number[]=[];let state:any;
  for(let f=0;f<1200;f++){
   const time=f*1000/60,v=p.tick(1/60,{speech_id:speech,phase:time<audio.duration_ms?'playing':'idle',audio_time_ms:Math.min(time,audio.duration_ms)},{});state=p.state();
   values.push(channels.map((id:string)=>v[id]??profile.channels.find((p:any)=>p.id===id).default));face.push(Array(7).fill(0));eye.push(0);
   if(time>audio.duration_ms+250&&!state.motion_actions.active&&f>60)break;
  }
  const name=String(i).padStart(2,'0')+'-'+(variant?'B':'A'),params={channels,values,face,eye,mouth:audio.features.values,images:true,hz:60,image_hz:30,verify_hands:true};
  writeFileSync(join(out,name+'.json'),JSON.stringify(params));clips.push({label:`动作组 ${variant?'B':'A'} 变体 · 接口直接调用`,media:media+'/'+name+'.webp',video:media+'/'+name+'.mp4',audio:clip.audio});proof.push({gesture,variant,frames:values.length,source:'performance.direct typed action-group tool call',state:state.motion_actions});
 }
 pairs.push({text:gestureLabels[gesture]+'：'+clip.text,context:'同步控制躯干、头部和手臂，包含进入、停留、收回。预览通过上层工具接口调用；实时说话时可由模型自主选择，表情与口型独立控制。',clips});
}
writeFileSync(join(data,'review/action-group-pairs.json'),JSON.stringify(pairs,null,2));writeFileSync(join(root,'experiments/vtuber-v4-gesture-groups/showcase.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify({groups:pairs.length,variants:proof.length}));
