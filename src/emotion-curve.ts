import {ControlError} from './controller';

export const affectEmotions=['happy','angry','shy','sad','surprised','confused'] as const;
export type AffectEmotion=typeof affectEmotions[number];
export type EmotionWeights=Record<AffectEmotion,number>;
export type EmotionPoint={text:string;window_text:string;start:number;end:number;start_fraction:number;weights:EmotionWeights;tension:number;probabilities:Record<string,number>};
export type EmotionTimeline={schema:'emotion.timeline.v1';points:EmotionPoint[]};
const lanes=[...affectEmotions,'tension'] as const;
type Lane=typeof lanes[number];
const zero=()=>Object.fromEntries(lanes.map(name=>[name,0])) as Record<Lane,number>;
const clamp=(x:number,lo=0,hi=1)=>Math.max(lo,Math.min(hi,x));
const vadPresets:Record<AffectEmotion,number[]>={happy:[.75,.4,.35],angry:[-.7,.7,.55],shy:[.2,.3,-.65],sad:[-.65,-.35,-.55],surprised:[.1,.8,-.25],confused:[-.15,.2,-.4]};
export const emotionCurvePolicy={spring:'critically_damped',response_attack_ms:200,response_release_ms:650,reversal_release_ms:240,mood_attack_ms:1800,mood_release_ms:3200,response_mix:.75,switch_margin:.07,switch_dwell_ms:350,initial_dwell_ms:180,minimum_switch_ms:500,clock:'audio',vad_source:'explicit category projection'};

/** Validate the entire observation timeline before changing any running state. */
export function validateEmotionTimeline(value:any,text:string):EmotionTimeline{
 const fail=():never=>{throw new ControlError('invalid_performance','情绪曲线观测不合法');};
 const number=(v:any,lo:number,hi:number)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<lo||v>hi)fail();};
 if(!value||value.schema!=='emotion.timeline.v1'||!Array.isArray(value.points)||!value.points.length||value.points.length>80)fail();
 const chars=Array.from(text);let end=0;
 const points=value.points.map((p:any)=>{
  if(!p||!Number.isInteger(p.start)||!Number.isInteger(p.end)||p.start!==end||p.end<=p.start||p.end>chars.length||typeof p.text!=='string'||!p.text||chars.slice(p.start,p.end).join('').trim()!==p.text)fail();
  const windowText=p.window_text??p.text;if(typeof windowText!=='string'||Array.from(windowText).length>512||!windowText.endsWith(p.text))fail();
  number(p.start_fraction,0,.999999);if(Math.abs(p.start_fraction-p.start/chars.length)>1e-7)fail();end=p.end;
  if(!p.weights||Array.isArray(p.weights)||Object.keys(p.weights).length!==affectEmotions.length||Object.keys(p.weights).some(k=>!affectEmotions.includes(k as AffectEmotion)))fail();
  for(const name of affectEmotions)number(p.weights[name],0,1);
  if(affectEmotions.reduce((sum,name)=>sum+p.weights[name],0)>1.00001)fail();
  number(p.tension,0,1);
  if(!p.probabilities||typeof p.probabilities!=='object'||Array.isArray(p.probabilities)||Object.keys(p.probabilities).length>28)fail();
  for(const v of Object.values(p.probabilities))number(v,0,1);
  return {text:p.text,window_text:windowText,start:p.start,end:p.end,start_fraction:p.start_fraction,weights:{...p.weights},tension:p.tension,probabilities:{...p.probabilities}};
 });
 if(end!==chars.length)fail();
 return {schema:'emotion.timeline.v1',points};
}

/** A category projection for rendering; these VAD values are not model outputs. */
export function emotionVAD(weights:EmotionWeights){
 const vector=[0,0,0];for(const name of affectEmotions)for(let i=0;i<3;i++)vector[i]+=weights[name]*vadPresets[name][i];
 return {valence:clamp(vector[0],-1,1),arousal:clamp(vector[1],-1,1),dominance:clamp(vector[2],-1,1)};
}

/** Only ordinary expression inputs; never lip-open, eyelids, wardrobe or physics. */
export function emotionPose(w:Partial<EmotionWeights>):Record<string,number>{
 const h=w.happy??0,a=w.angry??0,y=w.shy??0,s=w.sad??0,u=w.surprised??0,c=w.confused??0;
 return {EyeSmile:.32*h+.10*y,ParamMouthForm:.32*h+.16*y-.18*a-.18*s,
  ParamBrowLY:-.18*a+.08*s+.06*c,ParamBrowRY:-.18*a+.08*s-.04*c,
  BrowInnerUp:.04*y+.24*s+.24*u+.16*c,LEyeSquint:.12*a,REyeSquint:.12*a,ParamEyeBallY:-.05*y-.06*s};
}

/** Fast reaction + slow mood, driven exclusively by what has actually played.
 * Retargeting preserves position and velocity. Prefetch only binds observations;
 * it does not advance, trigger, or overwrite the current emotional state.
 */
export class EmotionCurve{
 enabled=false;
 private timeline:EmotionTimeline|null=null;private speechId:string|null=null;private duration=0;private index=-1;private audioMs=0;
 private nowMs=0;private target=zero();private response=zero();private responseVelocity=zero();private mood=zero();private moodVelocity=zero();
 private dominant='neutral';private candidate='neutral';private candidateMs=0;private lastSwitch=-1000;
 deltaMs=0;
 bind(timeline:EmotionTimeline,speechId:string,duration:number){
  this.timeline=timeline;this.speechId=speechId;this.duration=duration;this.index=-1;this.audioMs=0;this.enabled=true;
 }
 retime(speechId:string,duration:number){if(speechId===this.speechId)this.duration=duration;}
 unbind(){this.timeline=null;this.speechId=null;this.index=-1;this.audioMs=0;this.target=zero();this.enabled=false;this.deltaMs=0;}
 reset(){this.unbind();this.nowMs=0;this.response=zero();this.responseVelocity=zero();this.mood=zero();this.moodVelocity=zero();this.dominant='neutral';this.candidate='neutral';this.candidateMs=0;this.lastSwitch=-1000;}
 private select(index:number){const point=this.timeline!.points[index];this.index=index;this.target={...point.weights,tension:point.tension};}
 private weights(){
  const mix=emotionCurvePolicy.response_mix;
  const weights=Object.fromEntries(affectEmotions.map(name=>[name,mix*this.response[name]+(1-mix)*this.mood[name]])) as EmotionWeights;
  const scale=Math.max(1,affectEmotions.reduce((sum,name)=>sum+weights[name],0));for(const name of affectEmotions)weights[name]/=scale;
  return weights;
 }
 private spring(value:number,velocity:number,target:number,dt:number,tau:number){
  const omega=1/tau,offset=value-target,term=velocity+omega*offset,decay=Math.exp(-omega*dt);
  const next=target+(offset+term*dt)*decay,speed=(velocity-omega*term*dt)*decay;
  return [clamp(next),next<0||next>1?0:speed];
 }
 private advance(ms:number){
  this.deltaMs+=ms;
  while(ms>1e-7){
   const step=Math.min(ms,1000/60),dt=step/1000;ms-=step;this.nowMs+=step;
   const opposed=emotionVAD(this.target).valence*emotionVAD(this.weights()).valence<-.025&&Math.max(...affectEmotions.map(name=>this.target[name]))>.45;
   for(const name of lanes){
    const rising=this.target[name]>this.response[name],tau=(rising?emotionCurvePolicy.response_attack_ms:opposed?emotionCurvePolicy.reversal_release_ms:emotionCurvePolicy.response_release_ms)/1000;
    [this.response[name],this.responseVelocity[name]]=this.spring(this.response[name],this.responseVelocity[name],this.target[name],dt,tau);
    [this.mood[name],this.moodVelocity[name]]=this.spring(this.mood[name],this.moodVelocity[name],this.target[name],dt,(this.target[name]>this.mood[name]?emotionCurvePolicy.mood_attack_ms:emotionCurvePolicy.mood_release_ms)/1000);
   }
   const weights=this.weights(),best=affectEmotions.reduce((a,b)=>weights[a]>weights[b]?a:b);
   const current=weights[this.dominant as AffectEmotion]??0;
   const wanted=weights[best]<.035?'neutral':this.dominant==='neutral'||weights[best]>current+emotionCurvePolicy.switch_margin?best:this.dominant;
   if(wanted===this.dominant){this.candidate=wanted;this.candidateMs=0;}
   else{if(wanted!==this.candidate){this.candidate=wanted;this.candidateMs=0;}this.candidateMs+=step;
    if(this.candidateMs>=(this.dominant==='neutral'?emotionCurvePolicy.initial_dwell_ms:emotionCurvePolicy.switch_dwell_ms)&&this.nowMs-this.lastSwitch>=emotionCurvePolicy.minimum_switch_ms){this.dominant=wanted;this.lastSwitch=this.nowMs;this.candidateMs=0;}}
  }
 }
 tick(dt:number,speech:{speech_id?:string|null;phase?:string;audio_time_ms?:number},active:boolean){
  this.deltaMs=0;if(!this.enabled||dt<=0)return;
  const matching=this.speechId===speech.speech_id;
  if(matching&&active&&speech.phase==='playing'){
   const audio=Math.max(this.audioMs,speech.audio_time_ms??0);
   if(this.index<0)this.select(0);
   while(this.timeline&&this.index+1<this.timeline.points.length&&audio>=this.timeline.points[this.index+1].start_fraction*this.duration){
    const boundary=Math.max(this.audioMs,this.timeline.points[this.index+1].start_fraction*this.duration);
    this.advance(boundary-this.audioMs);this.audioMs=boundary;this.select(this.index+1);
   }
   this.advance(audio-this.audioMs);this.audioMs=audio;
  }else if(speech.phase!=='paused'&&speech.phase!=='buffering'&&!(active&&this.timeline&&this.index<0)){
   this.target=zero();this.advance(dt*1000);
  }
 }
 expressions(){const w=this.weights(),mix=emotionCurvePolicy.response_mix;return {'黑脸':w.angry,'流泪':w.sad,'脸红':w.shy,'加载':0,'兔牙':0,'流冷汗':clamp((mix*this.response.tension+(1-mix)*this.mood.tension)*.6)};}
 state(){
  const weights=this.weights(),point=this.timeline?.points[this.index];
  return {schema:'emotion.curve.v1',enabled:this.enabled,clock_ms:this.nowMs,emotion:this.dominant,strength:Math.max(...Object.values(weights)),weights,
   target:{...this.target},response:{...this.response},mood:{...this.mood},vad:emotionVAD(weights),point_index:this.index,points:this.timeline?.points.length??0,
   source:point?{text:point.text,window_text:point.window_text,start_fraction:point.start_fraction,probabilities:{...point.probabilities}}:null};
 }
}
