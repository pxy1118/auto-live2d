/** Actual model proposals -> the same PerformanceController used by streaming.
 * No teacher gesture/director calls. Both versions use the same PCM and 30fps. */
import {readFileSync,readdirSync,mkdirSync,writeFileSync,existsSync} from 'node:fs';import {join} from 'node:path';import {randomInt} from 'node:crypto';
import {PerformanceController} from '../../src/performance';import {gestureFingerChannels} from '../../src/gesture-library';
const root=join(import.meta.dirname,'../..'),data=join(root,'datasets/vtuber-v4'),review=join(data,'review'),media='comparisons-composition-r1',out=join(review,media);mkdirSync(out,{recursive:true});
const read=(p:string)=>JSON.parse(readFileSync(p,'utf8').replace(/^\uFEFF/,'')),old=read(join(review,existsSync(join(review,'comparison-pairs-legacy-v4.json'))?'comparison-pairs-legacy-v4.json':'comparison-pairs.json')),key=read(join(root,'experiments/vtuber-v4/blind-key.json'));
const parameters=read(join(root,'test-results/runtime-capabilities.json')).parameters,profile=read(join(data,'profile.json')),channels=[...profile.channels.map((p:any)=>p.id),...gestureFingerChannels];
const dir=join(root,'live2d/DeepSeek/DeepSeek/Animation'),motions=readdirSync(dir).filter(n=>n.endsWith('.motion3.json')).map(file=>({name:file.slice(0,-13),file,hold:true,data:read(join(dir,file))}));
const faces=['黑脸','流泪','脸红','加载','兔牙','流冷汗'],eyes=['normal','＞＜','圈圈眼','爱心眼','屑屑眼'];
const orderFile=join(root,'experiments/vtuber-v4-composition-r1/label-order.json');let labelOrder:number[];
if(existsSync(orderFile))labelOrder=read(orderFile);else{labelOrder=Array.from({length:24},(_,i)=>i<12?0:1);for(let i=23;i>0;i--){const j=randomInt(i+1);[labelOrder[i],labelOrder[j]]=[labelOrder[j],labelOrder[i]];}writeFileSync(orderFile,JSON.stringify(labelOrder));}
async function post(path:string,body:any){for(let retry=0;retry<50;retry++){const r=await fetch('http://127.0.0.1:8768'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(r.status===429){await new Promise(r=>setTimeout(r,70));continue;}const d=await r.json();if(!r.ok)throw Error(JSON.stringify(d));return d;}throw Error('Model stayed busy');}
const pairs:any[]=[],mapping:any[]=[];
for(let index=0;index<24;index++){
 const item={...old[index]},audioName=item.clips[0].audio;let audio=read(join(data,audioName.replace('.wav','.json'))),audioPath=audioName,baseline:any;
 if(index===6||index===18){
  const native=join(root,'datasets/vtuber-v4-native'),clip=index===6?read(join(native,'clips/showcase-cajole-v6.json')):{text:'给你看看这根狗尾草。',audio:'audio/b526bd439fd72c405ac2.wav'};
  item.text=clip.text;item.context=index===6?'和观众聊天，希望对方多陪自己一会儿。':'展示刚刚找到的一根小草。';audio=read(join(native,clip.audio.replace('.wav','.json')));audioPath='../vtuber-v4-native/'+clip.audio;
  baseline={trajectory:(await post('/predict',{text:item.text,context:item.context,kind:'regression',style:'natural',seed:41})).command};const scale=audio.duration_ms/baseline.trajectory.params.duration_ms;
  for(const e of baseline.trajectory.params.events){e.at_ms*=scale;if(e.params?.duration_ms!==undefined)e.params.duration_ms*=scale;}baseline.trajectory.params.duration_ms=audio.duration_ms;
 }else{const letter=key[index].models.find((m:any)=>m.model==='v3').label;baseline=read(join(review,'comparisons',`${String(index).padStart(2,'0')}-${letter}.json`));}
 const features=audio.features,actor=new PerformanceController(parameters,motions as any),id='a'.repeat(32),speech='b'.repeat(32);actor.start({session_id:id,motion_backend:'groups',motion_style:'natural'},Object.fromEntries(parameters.map((p:any)=>[p.id,p.default])));actor.segment({session_id:id,clause:0,speech_id:speech,text:item.text});
 const pref=await post('/stream/prefill',{text:item.text,context:item.context,planner_state:actor.state().planner_state});const plan={...pref.performance_plan,clause:0};
 const duration=Math.max(audio.duration_ms+300,plan.arm==='none'?0:2500+plan.arm_hold_ms+plan.onset_ms+250,plan.body==='none'?0:1400+plan.body_hold_ms+plan.onset_ms+250),count=Math.ceil(duration/1000*60),values:number[][]=[],face:number[][]=[],eye:number[]=[];let provenance:any;
 for(let f=0;f<count;f++){
  const time=f*1000/60;if(f%24===0){
   const s=actor.state(),start=Math.max(s.motion_ms+70,s.committed_until_ms),at=s.clause_media_ms+start-s.motion_ms,audioRows:number[][]=[],mask:number[]=[];
   for(let i=0;i<24;i++){const t=at+i*50;let j=-1;if(features.motion_times_ms)for(let k=0;k<features.motion_times_ms.length;k++){if(features.motion_times_ms[k]>t)break;j=k;}const available=j>=0&&t<=Math.min(time,audio.duration_ms)&&t-features.motion_times_ms[j]<70;audioRows.push(available?features.motion[j]:Array(12).fill(0));mask.push(available?1:0);}
   const p=await post('/stream/predict',{text:item.text,context:item.context,kind:'regression',seed:41,state:s.values,history:s.history,audio:audioRows,audio_mask:mask,planner_state:s.planner_state,motion_backend:'groups'});provenance=p.provenance;actor.chunk({...p,performance_plan:plan,session_id:id,start_ms:start});
  }
  const v=actor.tick(1/60,{speech_id:speech,phase:time<audio.duration_ms?'playing':'idle',audio_time_ms:Math.min(time,audio.duration_ms)},{}),state=actor.state();values.push(channels.map((id:string)=>v[id]??parameters.find((p:any)=>p.id===id).default));let e=0;for(let j=1;j<eyes.length;j++)if((state.expressions[eyes[j]]??0)>.05)e=j;face.push([...faces.map(n=>state.expressions[n]??0),e?state.expressions[eyes[e]]:0]);eye.push(e);
 }
 const candidate={channels,values,face,eye,mouth:features.values,images:true,hz:60,image_hz:30,verify_hands:true};baseline={...baseline,channels:baseline.channels??[],values:Array.from({length:count},()=>baseline.channels?.map(()=>0)??[]),mouth:features.values,images:true,hz:60,image_hz:30,verify_hands:true};
 const order=labelOrder[index]?[['candidate',candidate],['v3',baseline]]:[['v3',baseline],['candidate',candidate]];const clips:any[]=[],models:any[]=[];
 for(let j=0;j<2;j++){const label=String.fromCharCode(65+j),name=`${String(index).padStart(2,'0')}-${label}`;writeFileSync(join(out,name+'.json'),JSON.stringify(order[j][1]));clips.push({label,media:`${media}/${name}.webp`,video:`${media}/${name}.mp4`,audio:audioPath});models.push({label,model:order[j][0]});}
 pairs.push({text:item.text,context:item.context,clips});mapping.push({index,models,plan,provenance,executed:actor.state().plan_history,model_checkpoint:read(join(root,'experiments/vtuber-v4-composition-r1/performance-planner.json')).sha256});console.log(JSON.stringify({prepared:index+1,total:24}));
}
writeFileSync(join(review,'comparison-pairs-composition-r1.json'),JSON.stringify(pairs));writeFileSync(join(root,'experiments/vtuber-v4-composition-r1/blind-key.json'),JSON.stringify(mapping,null,2));
