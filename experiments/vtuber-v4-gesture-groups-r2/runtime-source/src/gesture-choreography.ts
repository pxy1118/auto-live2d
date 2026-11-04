/** Authored acting beats, in seconds. Fingers use the asset's existing fan/spread
 * deformation; this asset has no verified complete closed-fist drawing. */
export const gestureFingerChannels=['RHand','RHand2','LHand','LHand2'];
export const ease=(x:number)=>{x=Math.min(1,Math.max(0,x));return x*x*x*(10+x*(-15+6*x));};
const pulse=(t:number,at:number,width=.24)=>{const d=Math.abs(t-at)/width;return d<1?1-ease(d):0;};
const beats=(t:number,times:number[],width=.24)=>times.reduce((s,at)=>s+pulse(t,at,width),0);
// Wrap pulse support as well as time, so a long hold never jumps at the loop.
const cycleBeats=(t:number,times:number[],width=.24)=>{const phase=t%2.6;return beats(phase,times,width)+beats(phase-2.6,times,width)+beats(phase+2.6,times,width);};
// Start the acting phase with zero speed at the end of the reach.
const age=(t:number,enter:number)=>{const h=Math.max(0,t-enter)/1000;return h<.12?h*h/.24:h-.06;};
const sin=(t:number,hz:number,phase=0)=>Math.sin(t*2*Math.PI*hz+phase);
export const actingVariants:Record<string,string[]>={
 wave:['右手脸侧双挥＋向手侧歪头','左手招呼＋前倾点头','双手错峰小挥＋左右歪头'],
 cheer:['身侧双手两次上提＋躯干弹动','左右交替上提＋重心侧移','单侧蓄势后双手轻提＋点头'],
 chest:['抚胸承诺＋轻点头','抚胸并摊手邀请','抚胸后抬指补充'],
 grass:['身前轻扫草穗＋歪头','带着草穗画小弧＋侧倾','收近再递出＋前倾'],
 point:['短促点题＋一次点头','食指划过两侧＋视线跟随','抬指并摊开另一手说明'],
 thanks:['抚胸小鞠躬','抚胸摊手致谢＋长点头','抚胸后小挥手回应'],
 explain:['抚胸侧身说明','双手低位摊开＋交替侧重','食指点题＋另一手摊开'],
 refuse:['抬指摇头两次','张掌示意暂停＋轻退身','抬指收身＋一次明确点头'],
};
export type ActingTime={t:number;enter:number;holdEnd:number;exit:number};

export function authoredArms(name:string,variant:number,time:ActingTime){
 const {t,enter,holdEnd,exit}=time,h=age(t,enter);
 const end=1-ease((t-holdEnd)/exit),reach=(delay=0)=>ease((t-delay)/(enter-delay))*end;
 const e=reach(),w=reach(85),beat=cycleBeats(h,[.22,.73],.26);
 const v:Record<string,number>={};
 const hand=(side:'R'|'L',upper:number,elbow:number,wrist:number,spread=.45,perspective=.2)=>{
  const ids=side==='R'?['Param36','Param39','Param41','Param42']:['Param62','Param59','Param60','Param61'];
  [upper*reach(),perspective*reach(35),elbow*reach(65),wrist*w].forEach((value,i)=>v[ids[i]]=value);
  v[side+'Hand']=spread*reach(45);v[side+'Hand2']=.12*reach(45);
 };
 if(name==='wave'){
  const flutter=ease(h/.12),wave=(hz:number,phase=0)=>sin(h,hz,phase)*flutter;
  if(variant===0)hand('R',.25+.022*wave(1),-.94+.018*wave(1),.04+.32*wave(1.8),.65);
  if(variant===1)hand('L',.18+.03*wave(.8),-.96+.014*wave(1.2),-.05-.27*wave(2.2),.5,.12);
  if(variant===2){hand('R',.22,-.95,.04+.27*wave(1.8),.6);const delay=ease(h/.25);hand('L',.08+.1*delay,-.92-.025*delay,-.04-.24*wave(1.8,.9),.5);}
 }else if(name==='cheer'){
  // Side pumps, never a straight-arm overhead V. Negative finger values bring
  // fingers together; they must not be advertised as a fully closed fist.
  const r=variant===1?cycleBeats(h,[.18,.94],.25):variant===2?cycleBeats(h,[.1,.8,1.16],.22):beat;
  const l=variant===1?cycleBeats(h,[.56,1.32],.25):variant===2?cycleBeats(h,[.8,1.16],.22):cycleBeats(h,[.29,.8],.26);
  hand('R',-.4+.14*r,-.89-.025*r,-.13-.06*r,-1,.1);
  hand('L',-.4+.14*l,-.89-.025*l,.13+.06*l,-1,.1);
  v.RHand2=-.65*w;v.LHand2=-.65*w;
  if(variant===2){const ready=ease(h/.5);v.Param60*=.86+.14*ready;v.Param62*=.65+.35*ready;}
 }else if(name==='explain'){
  const shift=sin(h,.62)*ease(h/.25);
  hand('R',.14+.04*shift,-.94,.28+.16*shift,.35,-.3);
  hand('L',.14-.04*shift,-.94,-.28+.16*shift,.35,-.3);
 }else if(name==='refuse'){
  hand('R',.22,-.94,.08+.09*sin(h,1.1)*ease(h/.15),.7,.15);
 }
 return v;
}

export function actingBody(name:string,variant:number,{t,enter,holdEnd,exit}:ActingTime){
 const h=age(t,enter),end=1-ease((t-holdEnd)/exit),e=ease(t/enter)*end;
 const lag=(delay=100)=>ease((t-delay)/(enter-delay))*end,b=cycleBeats(h,[.22,.73],.3);
 const m=ease(h/.2),s=sin(h,.65)*m;
 const v:Record<string,number>={AngleX:0,AngleY:0,AngleZ:0,PositionX:0,PositionY:0,PositionZ:0,LeanInput:0};
 if(name==='wave'){
  if(variant===0)Object.assign(v,{AngleX:2.5*lag(),AngleY:-1.8*lag(150),AngleZ:(-7.5-1.1*s)*lag(120),PositionX:1.4*e,PositionZ:1.8*e,LeanInput:-1.2*lag(180)});
  if(variant===1)Object.assign(v,{AngleX:-2.5*lag(),AngleY:(-1-2.7*pulse(h,.42,.4))*lag(140),AngleZ:5.2*lag(100),PositionX:-1.2*e,PositionZ:3*e,LeanInput:-2.4*lag(180)});
  if(variant===2)Object.assign(v,{AngleY:-1.5*lag(),AngleZ:(3.8*sin(h,.7)-2)*lag(120),PositionX:1.5*s*e,PositionY:-.7*beats(h,[.25,.85],.32)*e,PositionZ:2.2*e,LeanInput:-1.6*lag(180)});
 }else if(name==='cheer'){
  const shift=variant===1?sin(h,1.35)*m:variant===2?.65*sin(h,.9)*m:sin(h,1.1)*m*.35;
  const bounce=variant===1?cycleBeats(h,[.2,.58,.96,1.34],.24):variant===2?cycleBeats(h,[.1,.8,1.16],.24):b;
  Object.assign(v,{AngleX:2.1*shift*e,AngleY:(-1.2-3.2*bounce)*lag(120),AngleZ:(variant===0?-2.1:3.8*shift)*lag(150),PositionX:2.1*shift*e,PositionY:(.5-1.8*bounce)*e,PositionZ:(1.4+.8*bounce)*e,LeanInput:(-1.6-1.3*bounce)*lag(90)});
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
