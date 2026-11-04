/** Authored acting beats, in seconds. Fingers use the asset's existing fan/spread
 * deformation; this asset has no verified complete closed-fist drawing. */
export const gestureFingerChannels=['RHand','RHand2','LHand','LHand2'];
export const ease=(x:number)=>{x=Math.min(1,Math.max(0,x));return x*x*x*(10+x*(-15+6*x));};
const pulse=(t:number,at:number,width=.24)=>{const d=Math.abs(t-at)/width;return d<1?1-ease(d):0;};
const beats=(t:number,times:number[],width=.24)=>times.reduce((s,at)=>s+pulse(t,at,width),0);
// Start the acting phase with zero speed at the end of the reach.
const age=(t:number,enter:number)=>{const h=Math.max(0,t-enter)/1000;return h<.12?h*h/.24:h-.06;};
const sin=(t:number,hz:number,phase=0)=>Math.sin(t*2*Math.PI*hz+phase);
export const actingVariants:Record<string,string[]>={
 wave:['原生屈肘张掌双挥＋轻歪头','原生屈肘点头后短挥一次','原生屈肘张掌停留后慢挥'],
 chest:['抚胸承诺＋轻点头','抚胸侧身邀请','抚胸点头确认'],
 grass:['身前轻扫草穗＋歪头','带着草穗画小弧＋侧倾','收近再递出＋前倾'],
 point:['短促点题＋一次点头','食指划过两侧＋视线跟随','抬指侧身说明'],
 thanks:['抚胸小鞠躬','抚胸长点头致谢','抚胸歪头回应'],
 explain:['抚胸侧身说明','单手张掌说明＋侧重','食指点题＋轻点头'],
 refuse:['抬指摇头两次','张掌示意暂停＋轻退身','抬指收身＋一次明确点头'],
};
export type ActingTime={t:number;enter:number;holdEnd:number;exit:number};

export function palmWave(variant:number,time:ActingTime){
 const {t,enter,holdEnd,exit}=time,h=age(t,enter);
 const e=ease(t/enter)*(1-ease((t-holdEnd)/exit));
 const start=variant===1?.35:variant===2?.22:0,q=Math.max(0,h-start),window=ease(q/.12)*(1-ease((q-(variant===0?1.05:variant===1?.5:1.2))/.2));
 const wrist=(variant===0?.2*sin(q,1.7):variant===1?.17*sin(q,2):.18*sin(q,.8))*window;
 // Only the wrist and finger spread change; shoulder/elbow remain on the
 // artist-authored point pose, including the original enter/exit curves.
 return {Param42:wrist*e,RHand:.65*e,RHand2:.12*e};
}

export function actingBody(name:string,variant:number,{t,enter,holdEnd,exit}:ActingTime){
 const h=age(t,enter),end=1-ease((t-holdEnd)/exit),e=ease(t/enter)*end;
 const lag=(delay=100)=>ease((t-delay)/(enter-delay))*end;
 const m=ease(h/.2),s=sin(h,.65)*m;
 const v:Record<string,number>={AngleX:0,AngleY:0,AngleZ:0,PositionX:0,PositionY:0,PositionZ:0,LeanInput:0};
 if(name==='wave'){
  if(variant===0)Object.assign(v,{AngleX:1.2*lag(),AngleY:-1*lag(150),AngleZ:(-3.5-.5*s)*lag(120),PositionX:.35*e,PositionZ:.8*e,LeanInput:-.6*lag(180)});
  if(variant===1)Object.assign(v,{AngleX:-1*lag(),AngleY:(-.5-2.7*pulse(h,.18,.27))*lag(140),AngleZ:1.8*lag(100),PositionZ:1.2*e,LeanInput:-1.1*lag(180)});
  if(variant===2)Object.assign(v,{AngleY:-1.2*lag(),AngleZ:-2.6*lag(120),PositionX:.25*s*e,PositionZ:1.6*e,LeanInput:-1.3*lag(180)});
 }else if(name==='chest'){
  Object.assign(v,{AngleX:(variant===0?1.2:variant===1?-3:3)*e,AngleY:(-1-2*pulse(h,.26,.32))*lag(),AngleZ:(variant===1?4.2:variant===2?-3.5:1.8)*lag(120),PositionZ:(variant===1?2.4:1.1)*e,LeanInput:-1.5*lag(150)});
 }else if(name==='grass'){
  Object.assign(v,{AngleX:(variant===1?-3.5:3)*e,AngleY:(variant===2?-3.1:-1)*lag(),AngleZ:(variant===1?5:-4)*lag(120),PositionX:(variant===1?-1.8:1.4)*e,PositionZ:(variant===2?3.2:1)*e,LeanInput:(variant===2?-3:-1.1)*lag(160)});
 }else if(name==='point'){
  Object.assign(v,{AngleX:(variant===1?4*s:2)*lag(),AngleY:(-1.2-2.6*pulse(h,.22,.27))*lag(),AngleZ:(variant===2?3.2:-2)*lag(130),PositionX:variant===1?1.2*s*e:0,PositionZ:1.5*e,LeanInput:-1.3*lag(150)});
 }else if(name==='thanks'){
  const bow=variant===1?ease(h/.24)*(1-ease((h-.85)/.45)):pulse(h,variant===2?.32:.35,variant===2?.3:.5);
  Object.assign(v,{AngleX:(variant===1?-2:1)*lag(),AngleY:(-1-5.5*bow)*lag(90),AngleZ:(variant===2?-4:variant===1?2.6:.8)*lag(),PositionZ:(1.2+2*bow)*e,LeanInput:(-1-3.4*bow)*lag(160)});
 }else if(name==='explain'){
  Object.assign(v,{AngleX:(variant===1?4*s:variant===2?2.5:-2.5)*lag(),AngleY:(-1.1-1.2*pulse(h,.4,.4))*lag(),AngleZ:(variant===1?2*s:variant===2?-3:2.6)*lag(140),PositionX:variant===1?1.6*s*e:0,PositionZ:1.8*e,LeanInput:-1.8*lag(150)});
 }else if(name==='refuse'){
  const shake=sin(h,1.5)*ease(h/.15)*(1-ease((h-.85)/.3));
  Object.assign(v,{AngleX:variant===0?-5.3*shake*e:variant===2?2*e:-1.2*e,AngleY:(variant===2?-4*pulse(h,.4,.3):.8)*lag(),AngleZ:(variant===1?4:variant===2?-2:0)*lag(140),PositionZ:(variant===1?-2.3:-.8)*e,LeanInput:(variant===1?2.1:1)*lag(150)});
 }
 return v;
}
