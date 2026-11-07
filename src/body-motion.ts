/** Finite, coordinated acting beats. Values are offsets on the existing body
 * inputs, never arm joints or physics outputs. No perpetually looping sway. */
export const bodyChannels=['AngleX','AngleY','AngleZ','PositionX','PositionY','PositionZ','LeanInput'];
export const bodyMotionNames=['lean','sway','nod','tilt','turn','cajole'] as const;
export type BodyMotionName=typeof bodyMotionNames[number];
export const bodyMotionLabels:Record<BodyMotionName,string>={lean:'前倾与回身',sway:'躯干轻摇与重心转移',nod:'点头与俯身',tilt:'歪头与侧倾',turn:'侧首与转身',cajole:'撒娇 · 前倾轻扭'};
export const bodyMotionVariants:Record<BodyMotionName,string[]>={
 lean:['轻轻前倾靠近，再自然回身','前倾停一下，再退回重心','歪头后前倾探身'],
 sway:['左右轻摇，幅度逐次收小','移重心停留，再轻轻回摆','轻摇后向前靠近'],
 nod:['一次明确点头，躯干稍后跟随','一深一浅两次点头','稍抬下巴，再点头确认'],
 tilt:['先歪头，躯干稍后侧倾','反向歪头，再前倾回应','左右端详，最后自然回正'],
 turn:['先侧首，再带动躯干','侧首停留，再转回正面','视线扫过两侧，身体轻轻跟随'],
 cajole:['前倾歪头，左右轻扭两次','先侧首，再靠近轻扭并停留','前倾画小弧，再歪头望过来'],
};
export type ActingTime={t:number;enter:number;holdEnd:number;exit:number};
export const ease=(x:number)=>{x=Math.min(1,Math.max(0,x));return x*x*x*(10+x*(-15+6*x));};
const curve=(t:number,keys:[number,number][])=>{
 if(t<=keys[0][0])return keys[0][1];
 for(let i=1;i<keys.length;i++)if(t<keys[i][0]){const [a,x]=keys[i-1],[b,y]=keys[i];return x+(y-x)*ease((t-a)/(b-a));}
 return keys.at(-1)![1];
};
const zero=()=>Object.fromEntries(bodyChannels.map(id=>[id,0]));

export function sampleBodyMotion(name:BodyMotionName,variant:number,{t,enter,holdEnd,exit}:ActingTime){
 const v=zero(),h=Math.max(0,t-enter)/1000,tail=1-ease((t-holdEnd)/exit);
 const e=ease(t/enter)*tail,lag=(ms=140)=>ease((t-ms)/(enter-ms))*tail;
 if(name==='lean'){
  const approach=variant===1?curve(h,[[0,1],[.65,1],[1.55,.12]]):1;
  const peek=variant===2?lag(220):e;
  Object.assign(v,{PositionZ:8.5*approach*peek,PositionY:-1.6*approach*lag(180),LeanInput:-7.5*approach*lag(120),AngleY:2.2*approach*e,
   AngleZ:variant===2?-6*e:0,AngleX:variant===2?3.5*e:0,PositionX:variant===2?1.7*lag(220):0});
 }else if(name==='sway'){
  const keys:[number,number][]=variant===0?[[0,0],[.4,1],[1,-.8],[1.65,.4],[2.2,0]]:variant===1?[[0,0],[.4,-1],[.9,-1],[1.55,.35],[2.2,0]]:[[0,0],[.5,.65],[1.25,-.5],[2,0]];
  const head=curve(h,keys),body=curve(Math.max(0,h-.12),keys),forward=variant===2?curve(h,[[0,0],[.8,0],[1.55,1],[2.2,.5]]):0;
  Object.assign(v,{PositionX:5.8*body*e,PositionY:-.6*Math.abs(body)*e,AngleZ:-4*head*e,AngleX:1.8*head*e,
   PositionZ:4.8*forward*e,LeanInput:(-1.4*Math.abs(body)-4.1*forward)*lag()});
 }else if(name==='nod'){
  const keys:[number,number][]=variant===0?[[0,0],[.23,-8],[.55,1],[.9,0]]:variant===1?[[0,0],[.24,-7],[.53,0],[.84,-4.8],[1.16,0]]:[[0,0],[.27,3],[.68,-8],[1.04,-2],[1.42,0]];
  const head=curve(h,keys),body=curve(Math.max(0,h-.1),keys);
  Object.assign(v,{AngleY:head*e,PositionY:Math.min(0,body)*.14*e,PositionZ:-body*.25*e,LeanInput:Math.min(0,body)*.27*lag()});
 }else if(name==='tilt'){
  const direction=variant===1?-1:1,look=variant===2?curve(h,[[0,.7],[.55,.7],[1.25,-1],[1.9,0]]):direction;
  const forward=variant===1?curve(h,[[0,0],[.3,0],[1,1]]):0;
  Object.assign(v,{AngleZ:8*look*e,AngleX:-2.4*look*e,PositionX:-2.8*look*lag(200),AngleY:forward*1.6*e,
   PositionZ:4.5*forward*lag(220),LeanInput:(-1.2-3.6*forward)*lag(200)});
 }else if(name==='cajole'){
  // A small finite twist, not a looping dance. The existing input/physics
  // mapping carries the torso, hips, shoulders and sleeves together. Head
  // counter-turns slightly so the character keeps attending to the audience.
  const keys:[number,number][]=variant===0?[[0,0],[.34,.8],[.9,-1],[1.5,.65],[2.12,0]]:
   variant===1?[[0,-.35],[.5,-.35],[1.08,.85],[1.78,-.3],[2.25,0]]:[[0,0],[.48,.8],[1.05,.3],[1.62,-.8],[2.25,0]];
  const head=curve(h,keys),twist=curve(Math.max(0,h-.12),keys);
  const approach=variant===1?curve(h,[[0,.35],[.3,.35],[.95,1],[2.25,.85]]):variant===2?curve(h,[[0,.7],[.3,.7],[1.05,1.15],[2.2,.8]]):1;
  const glance=variant===2?curve(h,[[0,-.6],[.25,-.6],[1.15,.85],[2.25,.4]]):variant===1?-.75:.6;
  const bounce=variant===2?curve(h,[[0,0],[.25,0],[.72,1],[1.2,0]]):0;
  Object.assign(v,{PositionX:6.4*twist*lag(120),PositionY:(-1.7*approach-.65*bounce)*lag(180),
   PositionZ:(3.8*approach+2.1*twist)*lag(160),LeanInput:-9.8*approach*lag(120),
   AngleX:-2.7*head*e,AngleY:(3.2*approach-2*bounce)*e,AngleZ:(6.8*glance+2.1*head)*e});
 }else if(name==='turn'){
  const look=variant===0?1:variant===1?curve(h,[[0,-1],[.6,-1],[1.5,0]]):curve(h,[[0,-.65],[.5,-.65],[1.2,1],[2,0]]);
  const body=variant===2?curve(Math.max(0,h-.13),[[0,-.65],[.5,-.65],[1.2,1],[2,0]]):look;
  Object.assign(v,{AngleX:11*look*e,AngleZ:-1.5*look*e,PositionX:3.4*body*lag(190),PositionZ:1.8*Math.abs(body)*lag(),LeanInput:-1.6*Math.abs(body)*lag(160)});
 }
 return v;
}

type Request={name:BodyMotionName;id:string;cueId?:string;variant?:number;strength?:number;holdMs?:number;source?:'model'|'director'};
type Active=Request&{at:number;variant:number;strength:number;enter:number;hold:number;exit:number;release:boolean;from:Record<string,number>;velocity:Record<string,number>};

/** Additive director layer. Replacement/release match offset position and
 * velocity; the underlying arm group keeps its own clock and continues. */
export class BodyMotionLayer{
 private current:Active|null=null;private count=0;
 get active(){return !!this.current;}
 clear(){this.current=null;this.count=0;}
 private raw(a:Active,elapsed:number){
  const t=Math.max(0,elapsed),end=a.enter+a.hold+a.exit;
  const v=a.release?zero():sampleBodyMotion(a.name,a.variant,{t,enter:a.enter,holdEnd:a.enter+a.hold,exit:a.exit});
  for(const id of bodyChannels)v[id]*=a.strength;
  const transition=a.release?end:300;
  if(t<transition){const u=t/transition,p=1-ease(u),q=u-6*u**3+8*u**4-3*u**5;
   for(const id of bodyChannels)v[id]+=p*a.from[id]+transition*q*a.velocity[id];}
  return v;
 }
 private snapshot(actor:number){const a=this.current;if(!a)return {values:zero(),velocity:zero()};const t=actor-a.at,v=this.raw(a,t),before=this.raw(a,Math.max(0,t-.1)),after=this.raw(a,t+.1);return {values:v,velocity:Object.fromEntries(bodyChannels.map(id=>[id,(after[id]-before[id])/(t<.1?.1:.2)]))};}
 request(request:Request,actor:number){
  if(this.current)return false;
  const from=this.snapshot(actor);
  this.current={...request,source:request.source??'director',at:actor,variant:request.variant??this.count%3,strength:request.strength??.75,enter:700,hold:request.holdMs??2200,exit:700,release:false,from:from.values,velocity:from.velocity};
  this.count++;return true;
 }
 release(actor:number,cueId?:string){
  const a=this.current;if(!a||a.release||cueId&&cueId!==a.cueId)return;
  const from=this.snapshot(actor);this.current={...a,at:actor,enter:0,hold:0,exit:600,release:true,from:from.values,velocity:from.velocity};
 }
 tick(actor:number){const a=this.current;if(!a)return {};const t=actor-a.at,v=this.raw(a,t);if(t>=a.enter+a.hold+a.exit)this.current=null;return v;}
 state(actor:number){const a=this.current;if(!a)return {active:false,count:this.count};const t=Math.max(0,actor-a.at);return {active:true,count:this.count,name:a.name,label:bodyMotionLabels[a.name],variant:a.variant,variant_label:bodyMotionVariants[a.name][a.variant],strength:a.strength,source:a.source,cue_id:a.cueId,elapsed_ms:t,duration_ms:a.enter+a.hold+a.exit,phase:a.release?'release':t<a.enter?'enter':t<a.enter+a.hold?'hold':'exit',owned_channels:bodyChannels};}
 capabilities(){return bodyMotionNames.map(name=>({name,label:bodyMotionLabels[name],available:true,variants:3,variant_descriptions:bodyMotionVariants[name],source:'authored_continuous_body_inputs',composition:'additive_body_offset',independent_of_arm_group:false,owned_channels:bodyChannels,stops_audio:false}));}
}
