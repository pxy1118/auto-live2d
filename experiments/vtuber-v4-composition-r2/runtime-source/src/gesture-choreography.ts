/** Authored acting beats, in seconds. Fingers use the asset's existing fan/spread
 * deformation; this asset has no verified complete closed-fist drawing. */
import {ease,sampleBodyMotion,type BodyMotionName,type ActingTime} from './body-motion';
export {ease,type ActingTime} from './body-motion';
export const gestureFingerChannels=['RHand','RHand2','LHand','LHand2'];
const pulse=(t:number,at:number,width=.24)=>{const d=Math.abs(t-at)/width;return d<1?1-ease(d):0;};
const beats=(t:number,times:number[],width=.24)=>times.reduce((s,at)=>s+pulse(t,at,width),0);
// Start the acting phase with zero speed at the end of the reach.
const age=(t:number,enter:number)=>{const h=Math.max(0,t-enter)/1000;return h<.12?h*h/.24:h-.06;};
const sin=(t:number,hz:number,phase=0)=>Math.sin(t*2*Math.PI*hz+phase);
export const actingVariants:Record<string,string[]>={
 wave:['歪头轻侧倾＋屈肘张掌双挥','点头带动躯干＋张掌短挥','歪头前倾靠近＋慢挥'],
 chest:['抚胸前倾＋一深一浅点头','先侧首、再倾身抚胸','歪头侧倾＋抚胸确认'],
 grass:['歪头、侧倾展示草穗','移重心停留＋草穗画弧','前倾递出，再回身'],
 point:['抬指点题＋头身错峰点头','食指划过两侧＋侧首跟随','歪头前倾＋抬指说明'],
 thanks:['抚胸小鞠躬，再自然起身','抚胸＋一深一浅点头','先歪头、后点头致谢'],
 explain:['侧首带动躯干＋抚胸说明','移重心轻摇＋单手张掌','前倾点题后回身'],
 refuse:['抬指摇头两次','张掌示意暂停＋轻退身','抬指收身＋一次明确点头'],
};

export function palmWave(variant:number,time:ActingTime){
 const {t,enter,holdEnd,exit}=time,h=age(t,enter);
 const e=ease(t/enter)*(1-ease((t-holdEnd)/exit));
 const start=variant===1?.35:variant===2?.22:0,q=Math.max(0,h-start),window=ease(q/.12)*(1-ease((q-(variant===0?1.05:variant===1?.5:1.2))/.2));
 const wrist=(variant===0?.2*sin(q,1.7):variant===1?.17*sin(q,2):.18*sin(q,.8))*window;
 // Only the wrist and finger spread change; shoulder/elbow remain on the
 // artist-authored point pose, including the original enter/exit curves.
 return {Param42:wrist*e,RHand:.65*e,RHand2:.12*e};
}

export function actingBody(name:string,variant:number,time:ActingTime){
 const {t,enter,holdEnd,exit}=time,h=age(t,enter),end=1-ease((t-holdEnd)/exit),e=ease(t/enter)*end;
 const lag=(delay=100)=>ease((t-delay)/(enter-delay))*end;
 const v:Record<string,number>={AngleX:0,AngleY:0,AngleZ:0,PositionX:0,PositionY:0,PositionZ:0,LeanInput:0};
 const add=(body:BodyMotionName,version:number,strength:number)=>{for(const [id,value] of Object.entries(sampleBodyMotion(body,version,time)))v[id]+=value*strength;};
 if(name==='wave'){
  if(variant===0){add('tilt',1,.65);v.PositionZ+=1.5*e;}
  if(variant===1){add('nod',0,.65);v.AngleZ=2.5*lag();v.PositionZ+=2*e;v.LeanInput-=1.5*lag(160);}
  if(variant===2)add('lean',2,.7);
 }else if(name==='chest'){
  if(variant===0){add('lean',0,.65);add('nod',1,.4);}
  if(variant===1){add('turn',0,.7);add('lean',0,.5);}
  if(variant===2){add('tilt',1,.8);add('nod',0,.45);}
 }else if(name==='grass'){
  if(variant===0){add('tilt',0,.8);v.AngleY=-1.5*lag();}
  if(variant===1)add('sway',1,.85);
  if(variant===2)add('lean',1,.9);
 }else if(name==='point'){
  if(variant===0){add('nod',0,.8);v.AngleX=2*lag();v.PositionZ+=2*e;}
  if(variant===1)add('turn',2,.75);
  if(variant===2){add('lean',0,.55);add('tilt',1,.6);}
 }else if(name==='thanks'){
  if(variant===0){const bow=pulse(h,.52,.65);Object.assign(v,{AngleY:(-1-6.5*bow)*e,PositionY:-1.6*bow*lag(),PositionZ:(1.5+5*bow)*e,LeanInput:(-1.2-6.8*bow)*lag(160)});}
  if(variant===1){add('nod',1,.9);add('lean',0,.35);}
  if(variant===2){add('tilt',0,.75);add('nod',0,.65);}
 }else if(name==='explain'){
  if(variant===0){add('turn',0,.75);add('lean',0,.5);}
  if(variant===1){add('sway',1,.9);add('nod',0,.3);}
  if(variant===2){add('lean',1,.85);add('turn',1,.55);}
 }else if(name==='refuse'){
  const shake=sin(h,1.5)*ease(h/.15)*(1-ease((h-.85)/.3));
  Object.assign(v,{AngleX:variant===0?-5.3*shake*e:variant===2?2*e:-1.2*e,AngleY:(variant===2?-4*pulse(h,.4,.3):.8)*lag(),AngleZ:(variant===1?4:variant===2?-2:0)*lag(140),PositionZ:(variant===1?-2.3:-.8)*e,LeanInput:(variant===1?2.1:1)*lag(150)});
 }
 return v;
}
