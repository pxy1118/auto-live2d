import { PerformanceController } from '../../src/performance';
export async function compilePreview(parameters:any[],profile:any,clip:any,audio:any,kind='regression'){
 const channels=profile.channels.map(p=>p.id),names=['黑脸','流泪','脸红','加载','兔牙','流冷汗'],eyes=['normal','＞＜','圈圈眼','爱心眼','屑屑眼'];
 const controller=new PerformanceController(parameters),id='a'.repeat(32),speech='b'.repeat(32);
 controller.start({session_id:id,motion_style:'restrained'},Object.fromEntries(parameters.map(p=>[p.id,p.default])));controller.segment({session_id:id,clause:0,speech_id:speech,text:clip.text});
 const n=Math.ceil(audio.duration_ms/50)+1,values:number[][]=[],faces:number[][]=[],eyeTypes:number[]=[];let provenance:any;
 for(let frame=0;frame<n;frame+=8){
  const state=controller.state(),start=Math.max(state.media_ms+70,state.committed_until_ms),features:number[][]=[],mask:number[]=[];
  for(let i=0;i<24;i++){const at=start+i*50;let j=audio.features.motion_times_ms.findIndex((t:number)=>t>at);if(j<0)j=audio.features.motion_times_ms.length;j=Math.max(0,j-1);const available=at<=audio.duration_ms;features.push(available?audio.features.motion[j]:Array(12).fill(0));mask.push(available?1:0);}
  const scores=eyes.map(name=>state.expressions[name]??0),eye=scores.indexOf(Math.max(...scores));
  const response=await fetch((process.env.LATENT_URL??'http://127.0.0.1:8768')+'/stream/predict',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:clip.text,context:clip.context,motor_context:clip.context,kind,seed:41+Math.round(start/400),state:state.values,history:state.history,audio:features,audio_mask:mask,face_state:[...names.map(name=>state.expressions[name]??0),scores[eye]??0,...eyes.map((_,i)=>i===eye?1:0)]})});
  const prediction:any=await response.json();if(!response.ok)throw new Error(JSON.stringify(prediction));provenance=prediction.provenance;controller.chunk({...prediction,session_id:id,start_ms:start});
  for(let i=0;i<Math.min(8,n-frame);i++){
   const result=controller.tick(.05,{speech_id:speech,phase:'playing',audio_time_ms:(frame+i)*50},{}),s=controller.state();values.push(channels.map(id=>result[id]??profile.channels.find(p=>p.id===id).default));
   const scores=eyes.map(name=>s.expressions[name]??0),eye=scores.indexOf(Math.max(...scores));faces.push([...names.map(name=>s.expressions[name]??0),scores[eye]??0]);eyeTypes.push(eye);
  }
 }
 return {params:{channels,values,face:faces,eye:eyeTypes,mouth:audio.features.values,images:true},provenance,gesture_policy:controller.state().gesture_policy};
}
