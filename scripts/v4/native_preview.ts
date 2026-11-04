import {PerformanceController} from '../../src/performance';
export async function nativePreview(parameters:any[],profile:any,clip:any,audio:any,kind='regression',reference=false,force=true){
 const channels=profile.channels.map((p:any)=>p.id),names=['黑脸','流泪','脸红','加载','兔牙','流冷汗'],eyes=['normal','＞＜','圈圈眼','爱心眼','屑屑眼'];
 const p=new PerformanceController(parameters),id='a'.repeat(32),speech='b'.repeat(32);p.start({session_id:id},Object.fromEntries(parameters.map(p=>[p.id,p.default])));p.segment({session_id:id,clause:0,speech_id:speech,text:clip.text});
 if(force)p.direct({gesture_hint:clip.context,intensity:1,hold_ms:6000});
 const frames=Math.ceil((Math.max(audio.duration_ms,force?4100:0)+250)/1000*60),values:number[][]=[],faces:number[][]=[],eyeTypes:number[]=[];let provenance:any;
 for(let frame=0;frame<frames;frame+=24){
  const state=p.state(),start=Math.max(state.motion_ms+70,state.committed_until_ms),gesture=state.gesture_policy;
  let prediction:any;
  if(reference){
   const age=(gesture.elapsed_ms+(start-state.motion_ms))/1000,scale=(clip.gesture_duration_ms??3200)/3200;
   const rows=Array.from({length:24},(_,i)=>{const at=force?(age+i*.05)*scale:frame/60+i*.05,j=Math.min(clip.values.length-1,Math.max(0,Math.round(at*20)));return clip.values[j];});
   const f=Math.min(clip.face.length-1,Math.round(frame/60*20));
   prediction={channels,values:rows,motor_probability:force?1:0,motor_threshold:.8,emotion:clip.emotion,expressions:Object.fromEntries(names.map((n,i)=>[n,clip.face[f]?.[i]??0])),hold_ms:3000};provenance={source:'native_calibrated_teacher_reference'};
  }else{
   const features:number[][]=[],mask:number[]=[];
   for(let i=0;i<24;i++){const at=state.clause_media_ms+start-state.motion_ms+i*50,j=Math.max(0,audio.features.motion_times_ms.findLastIndex((t:number)=>t<=at));const valid=at<=audio.duration_ms&&at-audio.features.motion_times_ms[j]<70;features.push(valid?audio.features.motion[j]:Array(12).fill(0));mask.push(valid?1:0);}
   const scores=eyes.map(n=>state.expressions[n]??0),eye=scores.indexOf(Math.max(...scores));
   const response=await fetch((process.env.LATENT_URL??'http://127.0.0.1:8768')+'/stream/predict',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:clip.text,context:clip.context,motor_context:clip.context,kind,seed:71+Math.round(start/400),state:state.values,history:state.history,audio:features,audio_mask:mask,face_state:[...names.map(n=>state.expressions[n]??0),scores[eye]??0,...eyes.map((_,i)=>i===eye?1:0)],motion_phase:[gesture.elapsed_ms/1000,gesture.duration_ms/1000,gesture.phase==='idle'?0:1,(start-state.motion_ms)/1000],gesture_requested:force})});
   prediction=await response.json();if(!response.ok)throw new Error(JSON.stringify(prediction));provenance=prediction.provenance;
  }
  p.chunk({...prediction,session_id:id,start_ms:start,face_start_media_ms:state.media_ms+Math.max(0,start-state.motion_ms)});
  for(let i=0;i<Math.min(24,frames-frame);i++){
   const time=(frame+i)*1000/60,s=p.tick(1/60,{speech_id:speech,phase:time<audio.duration_ms?'playing':'idle',audio_time_ms:Math.min(time,audio.duration_ms)},{}),state=p.state();
   values.push(channels.map((id:string)=>s[id]??profile.channels.find((p:any)=>p.id===id).default));const scores=eyes.map(n=>state.expressions[n]??0),eye=scores.indexOf(Math.max(...scores));faces.push([...names.map(n=>state.expressions[n]??0),scores[eye]??0]);eyeTypes.push(eye);
  }
 }
 const ranges=Object.fromEntries(['Param36','Param41','Param42','Param62','Param60','Param61'].map(id=>{const j=channels.indexOf(id),v=values.map(row=>row[j]);return [id,{min:Math.min(...v),max:Math.max(...v),range:Math.max(...v)-Math.min(...v)}];}));
 return {params:{channels,values,face:faces,eye:eyeTypes,mouth:audio.features.values,images:true,hz:60,image_hz:30,verify_hands:true},provenance,gesture_policy:p.state().gesture_policy,ranges};
}
