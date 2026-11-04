/** Research-only causal execution policy. No trained weights, semantic selection,
 * wardrobe output, or direct shoulder/elbow editing. The default runtime never imports this. */
import {GestureLibrary, gestureArmChannels, type GestureName} from '../../src/gesture-library';
import {BodyMotionLayer, bodyChannels, type BodyMotionName} from '../../src/body-motion';
import type {Manifest} from '../../src/controller';

export const conditions=['fixed','rhythm','rhythm_posture'] as const;
export type Condition=typeof conditions[number];
export type Cue={at_ms:number;end_ms:number;index:number;arm:GestureName|'none';body:BodyMotionName|'none';variant:number;strength:number;text:string};
export type AcousticFrame={energy:number;beat:number};
const clamp=(x:number,a:number,b:number)=>Math.max(a,Math.min(b,x));
const zero=()=>Object.fromEntries(bodyChannels.map(k=>[k,0]));
const posture:Record<string,Record<string,number>>={
 lean:{PositionZ:1.8,LeanInput:-1.6},tilt:{AngleZ:1.8,PositionX:-.5,LeanInput:-.3},
 nod:{AngleY:-.8,PositionZ:.6},turn:{AngleX:2.2,PositionX:.5},
 cajole:{PositionZ:2,LeanInput:-2,AngleZ:1.5},sway:{PositionX:1,AngleZ:-.6},none:{}};

export class ProsodyConductor {
 private arms:GestureLibrary;private body=new BodyMotionLayer();
 private previous=0;private armTime=0;private bodyTime=0;private rate=1;
 private envelope=0;private lastBeat=0;private lastAccent=-10000;private accentAt=-10000;
 private cue:Cue|null=null;private endedAt:number|null=null;
 private begun=new Set<number>();private endSeen=new Set<number>();private cancelled=false;
 private pose=zero();private velocity=zero();private target=zero();
 private lastArm:Record<string,number>={};private seenArm=0;private seenBody=0;
 readonly events:any[]=[];readonly accents:number[]=[];
 constructor(manifest:Manifest,readonly condition:Condition){this.arms=new GestureLibrary(manifest.motions);}

 /** Events must be delivered only when their time has been reached. */
 begin(cue:Cue,now:number){
  if(now+1e-4<cue.at_ms)throw Error('Future cue was supplied');
  if(this.cancelled)return;
  if(this.begun.has(cue.index))return;
  this.begun.add(cue.index);this.cue=cue;this.endedAt=null;
  if(cue.arm!=='none'&&!this.arms.active){
   this.arms.request({name:cue.arm,id:`arm:${cue.index}`,source:'model',variant:cue.variant,holdMs:1400},this.armTime,this.lastArm);
  }
  if(cue.body!=='none'&&!this.body.active){
   this.body.request({name:cue.body,id:`body:${cue.index}`,source:'model',variant:cue.variant,strength:cue.strength,holdMs:2200},this.bodyTime);
  }
  this.target=zero();
  if(this.condition==='rhythm_posture'&&cue.body!=='none'){
   for(const [key,value] of Object.entries(posture[cue.body]))this.target[key]=value*cue.strength;
   if(cue.variant===1)for(const key of ['AngleX','AngleZ','PositionX'])this.target[key]*=-1;
  }
  this.events.push({kind:'begin',index:cue.index,at_ms:now,arm:cue.arm,body:cue.body});
 }
 end(index:number,now:number){
  if(this.endSeen.has(index))return;
  this.endSeen.add(index);
  if(this.cue?.index===index)this.endedAt=now;
  this.events.push({kind:'end',index,at_ms:now});
 }
 cancel(now:number){
  this.cancelled=true;this.arms.release(this.armTime);this.body.release(this.bodyTime);this.cue=null;this.endedAt=now;this.target=zero();
  this.events.push({kind:'cancel',at_ms:now});
 }
 tick(now:number,frame:AcousticFrame){
  if(!Number.isFinite(now)||now<this.previous)throw Error('Audio clock must be finite and monotonic');
  const elapsed=now-this.previous;
  if(elapsed>100)throw Error('Study must sample at least 10 Hz');
  if(!Number.isFinite(frame.energy)||!Number.isFinite(frame.beat))throw Error('Invalid acoustic frame');
  const dt=elapsed/1000;this.previous=now;
  const energy=clamp(frame.energy,0,1),beat=clamp(frame.beat,0,1);
  this.envelope+=(energy-this.envelope)*(1-Math.exp(-dt/.12));
  const semanticActive=!!this.cue&&(this.cue.arm!=='none'||this.cue.body!=='none')&&
    (this.endedAt===null||now-this.endedAt<250);
  if(semanticActive&&beat>this.lastBeat+.09&&beat>.3&&now-this.lastAccent>=650){
   this.lastAccent=now;this.accentAt=now;this.accents.push(now);
  }
  this.lastBeat=beat;
  const phase=this.arms.state(this.armTime).phase;
  // Bound whole-curve time dilation, including the native joint relationships.
  const wanted=this.condition==='fixed'||!semanticActive||phase==='exit'||phase==='blend'?1:
      clamp(.9+.22*this.envelope,.85,1.12);
  this.rate+=(wanted-this.rate)*(1-Math.exp(-dt/.18));
  this.armTime+=elapsed*this.rate;
  this.bodyTime+=elapsed*(this.condition==='fixed'?1:this.rate);
  const arm=this.arms.tick(this.armTime,{}),body=this.body.tick(this.bodyTime);
  this.lastArm={...arm};
  const values:Record<string,number>={...arm};
  for(const [key,value] of Object.entries(body))values[key]=(values[key]??0)+value;
  const state=this.arms.state(this.armTime),bodyState=this.body.state(this.bodyTime);
  if(state.active&&state.count!==this.seenArm){this.seenArm=state.count;this.events.push({kind:'arm',at_ms:now,name:state.name,variant:state.variant});}
  if(bodyState.active&&bodyState.count!==this.seenBody){this.seenBody=bodyState.count;this.events.push({kind:'body',at_ms:now,name:bodyState.name,variant:bodyState.variant});}
  const age=(now-this.accentAt)/1000;
  const accent=semanticActive&&age>=0&&age<.6?Math.sin(Math.PI*Math.min(age/.24,1))*Math.exp(-age/.3):0;
  if(this.condition!=='fixed'&&semanticActive){
   // Small finite accents; they never create a gesture in a neutral scene.
   values.AngleY=(values.AngleY??0)-1.2*accent;
   values.PositionZ=(values.PositionZ??0)+.3*accent;
   values.LeanInput=(values.LeanInput??0)-.35*accent;
  }
  if(this.condition==='rhythm_posture'){
   if(this.endedAt!==null&&now-this.endedAt>900)this.target=zero();
   // Critically damped bounded posture state, preserved across begin/end calls.
   const omega=5.5;
   for(const key of bodyChannels){
    const acceleration=omega*omega*(this.target[key]-this.pose[key])-2*omega*this.velocity[key];
    this.velocity[key]+=acceleration*dt;this.pose[key]+=this.velocity[key]*dt;
    values[key]=(values[key]??0)+this.pose[key];
   }
  }
  return {values,arm_time_ms:this.armTime,body_time_ms:this.bodyTime,rate:this.rate,
      arm:state,body:bodyState,posture:{...this.pose},accent,semantic_active:semanticActive};
 }
}

export function renderInputs(manifest:Manifest,scene:any,condition:Condition){
 const driver=new ProsodyConductor(manifest,condition),frames=Math.ceil(scene.duration_ms*60/1000);
 const channels=[...new Set([...gestureArmChannels,'RHand','RHand2','LHand','LHand2',...bodyChannels])];
 const values:number[][]=[],trace:any[]=[],computes:number[]=[],begun=new Set<number>(),ended=new Set<number>();
 for(let f=0;f<frames;f++){
  const now=f/60*1000;
  for(const cue of scene.cues as Cue[]){
   if(now>=cue.at_ms+180&&!begun.has(cue.index)){driver.begin(cue,now);begun.add(cue.index);}
   if(now>=cue.end_ms&&begun.has(cue.index)&&!ended.has(cue.index)){driver.end(cue.index,now);ended.add(cue.index);}
  }
  const started=performance.now();
  const sample=driver.tick(now,{energy:scene.features.energy[f]??0,beat:scene.features.beats[f]??0});
  computes.push(performance.now()-started);
  values.push(channels.map(k=>sample.values[k]??0));
  trace.push({at_ms:now,rate:sample.rate,arm_time_ms:sample.arm_time_ms,body_time_ms:sample.body_time_ms,
      arm:sample.arm.active?sample.arm.name:null,body:sample.body.active?sample.body.name:null,
      arm_phase:sample.arm.phase??null,accent:sample.accent,posture:sample.posture});
 }
 const blush=scene.face?.blush??0,black=scene.face?.blackface??0;
 const face=Array.from({length:frames},()=>[black,0,blush,0,0,0]);
 return {params:{channels,values,hz:60,image_hz:20,full_update:true,verify_hands:true,face,eye:0,mouth:scene.features.values},
   trace,events:driver.events,accents:driver.accents,condition,frames,computes};
}
