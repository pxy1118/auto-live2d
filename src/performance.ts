import type {Parameter} from './controller';
import {ControlError} from './controller';
import {DEFAULT_MOTION_STYLE,motionStyles} from './motor';
import {appearanceFields,appearanceValues,backgroundChannels,defaultAppearance,eyeNames,faceKeys,performanceCapabilities,streamChannels} from './performance-profile';
import {EmotionCurve,validateEmotionTimeline} from './emotion-curve';
import {DEFORMATION_EXPRESSIONS,EmotionExpressionLayer} from './emotion-expression';
import {FACE_CHANNELS,OVERLAY_NAMES} from './emotion-profiles';
import {buildAffectVector,EMOTION_LABELS,MOTION_POLICY,emotionCurvePolicy} from './emotion-config';
import {actionById,EMOTION_BINDINGS} from './action-catalog';
import {styleBodyPlan} from './emotion-acting';
import {ActionScheduler} from './action-scheduler';
import {PerformanceClock} from './performance-clock';
import {validatePlan,type PerformancePlan} from './performance-plan';
import {BodyMotionLayer} from './body-motion';
import {GestureLibrary,gestureArmChannels} from './gesture-library';
const clamp=(x:number,a=0,b=1)=>Math.min(b,Math.max(a,x));
const fail=(s:string):never=>{throw new ControlError('invalid_performance',s);};
const finite=(x:any,lo:number,hi:number,s:string)=>{if(typeof x!=='number'||!Number.isFinite(x)||x<lo||x>hi)fail(s);return x as number;};
type Track={start:number;values:number[][];channels:string[]};
type Clause={clause:number;text:string;start_fraction:number};
type Cue={id:string;emotion?:string;expression?:string;intensity:number;until:number;clause?:number;hold_ms:number;started:boolean;action_id?:string;variant:number;action_strength:number;action_hold_ms:number;serial:number;action_started?:boolean};

/** One affect state, one acting clock, and one action owner. */
export class PerformanceController{
 id:string|null=null;active=false;actorMs=0;mediaMs=0;motionMs=0;clause=-1;text='';
 private clock=new PerformanceClock();private actionMs=0;private clockBase=0;
 private speechId:string|null=null;private playbackPhase='idle';private clauseStarted=false;private speechBase=0;
 private utterancePlan:{speechId:string;duration:number;final:boolean;index:number;clauses:Clause[]}|null=null;
 private pendingPlan:{plan:PerformancePlan;input:any;authoredBody:boolean}|null=null;private seenPlans=new Set<number>();
 private tracks:Track[]=[];private committed=0;private appearance={...defaultAppearance};appearanceOwned=false;
 private cues=new Map<string,Cue>();private cueSerial=0;private face:Record<string,number>={};
 private history:{at:number;values:number[]}[]=[];private lastSample=-100;
 private lastValues:Record<string,number>={};private lastVelocity:Record<string,number>={};
 private currentBase:Record<string,number>={};private channelMeta:Parameter[];
 private actionHistory:any[]=[];private planHistory:any[]=[];private seenArmCount=0;private seenBodyCount=0;
 private motionStyle:'restrained'|'natural'|'lively'=DEFAULT_MOTION_STYLE;
 private affect=new EmotionCurve();private expression=new EmotionExpressionLayer();
 private automaticEmotion='neutral';private gestures:GestureLibrary;private body=new BodyMotionLayer();private scheduler:ActionScheduler;
 constructor(private parameters:Parameter[],motions:any[]=[]){
  this.channelMeta=parameters.filter(p=>streamChannels.includes(p.id));this.gestures=new GestureLibrary(motions);
  this.scheduler=new ActionScheduler({
   requestGesture:req=>this.gestures.request(req,this.actionMs,{...this.currentBase,...this.lastValues},this.lastVelocity),
   requestBody:req=>this.body.request(req,this.actionMs),
   release:cue=>{this.gestures.release(this.actionMs,cue);this.body.release(this.actionMs,cue);},
   pose:()=>{const g=this.gestures.state(this.actionMs),b=this.body.state(this.actionMs);return {active:!!(g.active||b.active),phase:g.active?g.phase:b.active?(b.phase==='release'?'exit':b.phase):'idle'};},
   gaps:()=>this.gaps(),
  },{sameActionWindowMs:MOTION_POLICY.same_action_window_ms});
 }
 private gaps(){const s=motionStyles[this.motionStyle];return {arm:s.gap,body:s.bodyGap};}
 start(p:any,current:Record<string,number>){
  if(typeof p.session_id!=='string'||!/^[a-f0-9]{32}$/.test(p.session_id))fail('session_id 不合法');
  if(p.motion_style!==undefined&&!['restrained','natural','lively'].includes(p.motion_style))fail('motion_style 不合法');
  this.scheduler.release();this.scheduler.clear();this.id=p.session_id;this.active=true;this.motionStyle=p.motion_style??DEFAULT_MOTION_STYLE;
  // Never rewind the sampler clock while a native exit is still in progress.
  this.clockBase=this.clock.now;this.actorMs=this.actionMs=this.clock.now;this.mediaMs=this.motionMs=this.speechBase=0;
  this.speechId=null;this.clause=-1;this.text='';this.clauseStarted=false;this.utterancePlan=null;this.pendingPlan=null;this.seenPlans.clear();
  this.affect.unbind();this.expression.reset();this.tracks=[];this.committed=0;this.history=[];this.lastSample=-100;
  this.lastValues={...current};this.lastVelocity={};this.currentBase={...current};this.cues.clear();this.actionHistory=[];this.planHistory=[];
  this.seenArmCount=this.gestures.state(this.actionMs).count;this.seenBodyCount=this.body.state(this.actionMs).count;
  return this.state();
 }
 require(id:any){if(!this.active||id!==this.id)throw new ControlError('performance_cancelled','该表演会话已停止');}
 utterance(p:any){
  this.require(p.session_id);finite(p.audio_duration_ms,1,90000,'音频时长不合法');
  if(typeof p.audio_duration_final!=='boolean'||typeof p.text!=='string'||typeof p.speech_id!=='string'||!/^[a-f0-9]{32}$/.test(p.speech_id))fail('连续表演分段不合法');
  const timeline=validateEmotionTimeline(p.affect_timeline,p.text);
  if(!Array.isArray(p.clauses)||!p.clauses.length)fail('缺少语义分段');
  if(p.clauses.some(r=>!r||Object.keys(r).some(k=>!['clause','text','start_fraction'].includes(k))))fail('语义分段只接受元数据，动作在播放时规划');
  const clauses:Clause[]=p.clauses.map((r:any)=>{if(!Number.isInteger(r.clause)||r.clause<0||typeof r.text!=='string'||!r.text.trim()||!p.text.includes(r.text)||typeof r.start_fraction!=='number'||!Number.isFinite(r.start_fraction)||r.start_fraction<0||r.start_fraction>=1)fail('语义分段不合法');return {clause:r.clause,text:r.text,start_fraction:r.start_fraction};});
  if(clauses[0].start_fraction!==0||clauses.some((r,i)=>i>0&&(r.clause<=clauses[i-1].clause||r.start_fraction<=clauses[i-1].start_fraction)))fail('语义分段顺序不合法');
  this.speechBase=this.mediaMs;this.speechId=p.speech_id;this.clause=clauses[0].clause;this.text=clauses[0].text;this.clauseStarted=false;
  this.pendingPlan=null;this.utterancePlan={speechId:p.speech_id,duration:p.audio_duration_ms,final:p.audio_duration_final,index:0,clauses};
  this.affect.bind(timeline,p.speech_id,p.audio_duration_ms);return this.state();
 }
 finishSpeech(id:string,duration:number){if(!this.active||id!==this.speechId)return;finite(duration,1,90000,'音频时长不合法');if(this.utterancePlan){this.utterancePlan.duration=duration;this.utterancePlan.final=true;}this.affect.retime(id,duration);}
 offerPlan(p:any){
  this.require(p.session_id);const plan=validatePlan(p.plan,p.clause);
  if(p.speech_id!==this.speechId||p.clause!==this.clause||!this.clauseStarted||this.seenPlans.has(p.clause))return {accepted:false,reason:'stale_or_duplicate'};
  this.seenPlans.add(p.clause);this.pendingPlan={plan,input:p.input,authoredBody:p.authored_body===true};return {accepted:true};
 }
 cancel(id?:string){
  if(id!==undefined&&id!==this.id)return {cancelled:false};
  this.active=false;this.tracks=[];this.cues.clear();this.pendingPlan=null;this.speechId=null;this.utterancePlan=null;
  this.affect.reset();this.expression.reset();this.scheduler.release();this.scheduler.clear();this.automaticEmotion='neutral';return {cancelled:true};
 }
 reset(){this.cancel();this.id=null;this.gestures.clear();this.body.clear();this.appearanceOwned=false;this.appearance={...defaultAppearance};this.face={};this.history=[];this.lastValues={};this.lastVelocity={};this.planHistory=[];this.actionHistory=[];}
 detach(){const appearance=this.getAppearance(),owned=this.appearanceOwned;this.reset();this.appearance=appearance;this.appearanceOwned=owned;}
 updateAppearance(p:any){if(!p||typeof p!=='object'||Array.isArray(p)||!Object.keys(p).length)fail('外观设置不能为空');for(const [k,v] of Object.entries(p))if(!Object.hasOwn(appearanceFields,k)||!(appearanceFields[k] as any[]).includes(v))fail('不支持的外观选项：'+k);Object.assign(this.appearance,p);return {...this.appearance};}
 getAppearance(){return {...this.appearance};}
 direct(p:any){
  if(p.session_id!==undefined)this.require(p.session_id);
  const allowed=['session_id','cue_id','emotion','expression','intensity','hold_ms','clause','action_id','variant','action_strength','action_hold_ms'];
  if(Object.keys(p).some(k=>!allowed.includes(k)))fail('导演指令包含不支持的字段');
  const id=p.cue_id??crypto.randomUUID();if(typeof id!=='string'||!id.length||id.length>128)fail('cue_id 不合法');
  if(p.emotion!==undefined&&!EMOTION_LABELS.includes(p.emotion))fail('不支持的原生情绪');
  if(p.expression!==undefined&&!Object.hasOwn(faceKeys,p.expression)&&p.expression!=='normal'&&!DEFORMATION_EXPRESSIONS.includes(p.expression))fail('不支持的表情');
  if(p.action_id!==undefined&&!actionById(p.action_id))fail('动作未注册');
  if(p.emotion===undefined&&p.expression===undefined&&p.action_id===undefined)fail('导演指令需要情绪、表情或动作');
  if(p.variant!==undefined&&(!Number.isInteger(p.variant)||p.variant<0||p.variant>2))fail('variant 必须为 0～2');
  if(p.action_id!==undefined&&(p.variant??0)>=actionById(p.action_id)!.variants)fail('该动作不支持所选变体');
  if(p.clause!==undefined&&(!Number.isInteger(p.clause)||p.clause<0))fail('clause 不合法');
  const intensity=finite(p.intensity??.7,0,1,'intensity 不合法'),hold=finite(p.hold_ms??3000,0,600000,'hold_ms 不合法');
  const body=p.action_id===undefined&&p.emotion&&intensity>0?EMOTION_BINDINGS.get(p.emotion)?.body:null;
  const action=p.action_id??body?.id??(p.emotion==='neutral'?'none':undefined);
  const strength=finite(p.action_strength??(body?body.strength*intensity:1),0,1,'action_strength 不合法'),actionHold=finite(p.action_hold_ms??body?.hold_ms??1400,0,6000,'action_hold_ms 不合法');
  const started=p.clause===undefined||p.clause<this.clause||p.clause===this.clause&&this.clauseStarted;
  this.scheduler.release(undefined,id);this.cues.delete(id);this.cues.set(id,{id,emotion:p.emotion,expression:p.expression,intensity,until:started?this.actorMs+hold:Infinity,clause:p.clause,hold_ms:hold,started,action_id:action,variant:p.variant??body?.variant??0,action_strength:strength,action_hold_ms:actionHold,serial:++this.cueSerial});
  return {cue_id:id};
 }
 release(p:any){if(p.cue_id!==undefined)this.cues.delete(p.cue_id);else this.cues.clear();this.scheduler.release(undefined,p.cue_id);return {released:true};}
 private at(track:Track,time:number,id:string){
  const j=track.channels.indexOf(id);if(j<0)return undefined;
  const pos=clamp((time-track.start)/50,0,track.values.length-1),i=Math.min(track.values.length-2,Math.floor(pos)),u=pos-i;
  const a=track.values[i][j],b=track.values[i+1][j],va=(track.values[Math.min(track.values.length-1,i+1)][j]-track.values[Math.max(0,i-1)][j])/(i===0?50:100),vb=(track.values[Math.min(track.values.length-1,i+2)][j]-a)/(i+2>=track.values.length?50:100);
  return (2*u**3-3*u*u+1)*a+(u**3-2*u*u+u)*50*va+(-2*u**3+3*u*u)*b+(u**3-u*u)*50*vb;
 }
 private sample(time:number,id:string){const t=[...this.tracks].reverse().find(t=>t.start<=time);return t?this.at(t,time,id):undefined;}
 chunk(p:any){
  this.require(p.session_id);const {channels,values}=p,start=finite(p.start_ms,0,86400000,'start_ms 不合法');
  if(!Array.isArray(channels)||!channels.length||new Set(channels).size!==channels.length||channels.some(id=>!(backgroundChannels as readonly string[]).includes(id)||!this.parameters.some(p=>p.id===id)))fail('动作通道不合法');
  if(!Array.isArray(values)||values.length!==24||values.some(r=>!Array.isArray(r)||r.length!==channels.length||r.some(x=>typeof x!=='number'||!Number.isFinite(x))))fail('需要 24 帧有限动作值');
  if(start<this.motionMs-80||start<this.committed-1)return {accepted:false,reason:'late_or_committed'};
  const bounded=values.map((r:number[])=>r.map((x,j)=>{const p=this.parameters.find(q=>q.id===channels[j])!;return clamp(x,p.min,p.max);}));
  for(let j=0;j<channels.length;j++){
   const id=channels[j],p0=this.sample(start,id)??bounded[0][j],v0=(this.sample(start+1,id)??p0)-p0,p1=bounded[3][j],v1=(bounded[4][j]-bounded[2][j])/100;
   for(let i=0;i<3;i++){const u=i/3;bounded[i][j]=(2*u**3-3*u*u+1)*p0+(u**3-2*u*u+u)*150*v0+(-2*u**3+3*u*u)*p1+(u**3-u*u)*150*v1;}
  }
  this.tracks=this.tracks.filter(t=>t.start<start).slice(-8);this.tracks.push({start,values:bounded,channels});this.committed=start+400;return {accepted:true,committed_until_ms:this.committed};
 }
 private directorActionBusy(){return [...this.cues.values()].some(c=>c.started&&c.action_id!==undefined&&this.actorMs<c.until);}
 private nextClause(audio:number){
  const t=this.utterancePlan;if(!t)return;
  while(t.index+1<t.clauses.length&&audio>=t.clauses[t.index+1].start_fraction*t.duration){const c=t.clauses[++t.index];this.clause=c.clause;this.text=c.text;this.pendingPlan=null;}
 }
 tick(dt:number,speech:any,base:Record<string,number>){
  this.currentBase=base;this.clock.step(dt,speech);const delta=this.clock.delta/1000;
  this.actorMs=this.actionMs=this.clock.now;this.playbackPhase=speech.phase??'idle';
  this.motionMs=Math.max(this.motionMs,this.clock.now-this.clockBase);
  this.affect.tick(delta,speech,this.active);
  const affect=this.affect.state();this.automaticEmotion=affect.emotion;
  const display=Object.fromEntries(EMOTION_LABELS.map(label=>[label,emotionCurvePolicy.response_mix*affect.response[label]+(1-emotionCurvePolicy.response_mix)*affect.mood[label]]));
  if(this.active&&speech.speech_id===this.speechId){
   const audio=Math.max(0,speech.audio_time_ms??0);this.mediaMs=Math.max(this.mediaMs,this.speechBase+audio);
   if(speech.phase==='playing'){this.clauseStarted=true;this.nextClause(audio);}
  }
  // Cue lifetimes and transitions use exactly the same frozen-or-advancing delta.
  for(const [id,c] of this.cues){
   if(!c.started&&(c.clause===undefined||c.clause<this.clause||c.clause===this.clause&&this.clauseStarted)){c.started=true;c.until=this.actorMs+c.hold_ms;}
   if(!c.started)continue;
   if(this.actorMs>=c.until){this.scheduler.release(undefined,id);this.cues.delete(id);continue;}
   if(delta>0&&c.action_id!==undefined&&!c.action_started){
    this.scheduler.request({id:c.action_id,event_id:'director:'+c.serial,source:'director',cue_id:id,variant:c.variant,strength:c.action_strength,hold_ms:c.action_hold_ms},{actionMs:this.actionMs,playing:true});c.action_started=true;
   }
  }
  const playing=this.active&&this.clauseStarted&&speech.phase==='playing';
  if(this.pendingPlan&&playing){
   const row=this.pendingPlan,t=this.utterancePlan!,clauseStart=t.clauses[t.index].start_fraction*t.duration;
   if((speech.audio_time_ms??0)-clauseStart>=row.plan.action.onset_ms){
    this.pendingPlan=null;const styled=row.authoredBody?row.plan:styleBodyPlan(row.plan,display),answer=this.scheduler.requestPlan(styled,{actionMs:this.actionMs,playing:true,directorBusy:this.directorActionBusy()});
    this.planHistory.push({clause:this.clause,at_ms:this.actionMs,plan:row.plan,performed_action:styled.action,input:row.input,...answer});this.planHistory=this.planHistory.slice(-32);
   }
  }
  this.scheduler.tick({actionMs:this.actionMs,playing:delta>0,directorBusy:this.directorActionBusy()});
  const cues=[...this.cues.values()].filter(c=>c.started&&this.actorMs<c.until);
  const emotion=[...cues].reverse().find(c=>c.emotion!==undefined),expression=[...cues].reverse().find(c=>c.expression!==undefined);
  const face=this.expression.update(display,delta,this.actorMs,emotion?{label:emotion.emotion!,intensity:emotion.intensity,serial:emotion.serial}:null,expression?{name:expression.expression!,intensity:expression.intensity,serial:expression.serial}:null);
  for(const name of OVERLAY_NAMES)this.face[name]=face.overlay[name]??0;
  for(const name of eyeNames.slice(1))this.face[name]=face.eye===name?1:0;
  const result:Record<string,number>={},automatic={...base};
  for(const id of backgroundChannels){const value=this.sample(this.motionMs,id),p=this.parameters.find(p=>p.id===id);if(value!==undefined&&p){result[id]=automatic[id]=clamp(value,p.min,p.max);}}
  const offset=this.body.tick(this.actionMs);
  for(const [id,value] of Object.entries(offset)){const p=this.parameters.find(p=>p.id===id);if(p)result[id]=automatic[id]=clamp((automatic[id]??p.default)+value,p.min,p.max);}
  // Gesture exit already blends against automatic, which includes the body once.
  const gesture=this.gestures.tick(this.actionMs,automatic);
  for(const [id,value] of Object.entries(gesture)){const p=this.parameters.find(p=>p.id===id);if(p)result[id]=clamp(value,p.min,p.max);}
  const arm=this.gestures.state(this.actionMs),body=this.body.state(this.actionMs);
  if(arm.active&&arm.count!==this.seenArmCount){this.actionHistory.push({part:'arm',name:arm.name,variant:arm.variant,at:this.actionMs,source:arm.source});this.seenArmCount=arm.count;}
  if(body.active&&body.count!==this.seenBodyCount){this.actionHistory.push({part:'body',name:body.name,variant:body.variant,at:this.actionMs,source:body.source});this.seenBodyCount=body.count;}
  this.actionHistory=this.actionHistory.slice(-32);
  for(const id of FACE_CHANNELS){const p=this.parameters.find(p=>p.id===id);if(p)result[id]=clamp((result[id]??base[id]??p.default)+(face.face[id]??0),p.min,p.max);}
  if(this.id||cues.length)for(const [name,key] of Object.entries(faceKeys))result[key]=clamp(this.face[name]??0);
  if(this.appearanceOwned||this.id)Object.assign(result,appearanceValues(this.appearance));
  const composed:Record<string,number>={};for(const p of this.channelMeta)composed[p.id]=result[p.id]??base[p.id]??p.default;
  if(delta>0){
   for(const [id,value] of Object.entries(composed)){this.lastVelocity[id]=(value-(this.lastValues[id]??value))/(delta*1000);this.lastValues[id]=value;}
   if(this.actorMs-this.lastSample>=49){this.history.push({at:this.actorMs,values:this.channelMeta.map(p=>composed[p.id])});this.history=this.history.slice(-20);this.lastSample=this.actorMs;}
  }
  return result;
 }
 rememberPose(values:Record<string,number>){for(const id of [...gestureArmChannels,...backgroundChannels])if(values[id]!==undefined)this.lastValues[id]=values[id];}
 hasActions(){return this.gestures.active||this.body.active||!!this.scheduler.state().active_segment;}
 capabilities(){return {...performanceCapabilities(this.parameters),action_groups:this.gestures.capabilities(),body_motions:this.body.capabilities(),plan_policy:'native28_motion',minimum_gap_ms:this.gaps(),director_priority:true,motion_backends:['groups']};}
 state(){
  const a=this.affect.state(),directed=[...this.cues.values()].reverse().find(c=>c.started&&this.actorMs<c.until&&c.emotion!==undefined)?.emotion;
  const vector=this.active?buildAffectVector({response:a.response,mood:a.mood,tension:a.tension,vad:a.vad,intensity:a.intensity,style:this.motionStyle}):null;
  return {session_id:this.id,active:this.active,driver:'native28_motion',motion_driver:'native28_motion',motion_backend:'groups',motion_style:this.motionStyle,
   motion_actions:this.gestures.state(this.actionMs),body_action:this.body.state(this.actionMs),action_plan:this.scheduler.state(),plan_history:this.planHistory,action_history:this.actionHistory,
   planner_state:this.scheduler.history(this.actionMs),action_clock_ms:this.actionMs,actor_ms:this.actorMs,media_ms:this.mediaMs,motion_ms:this.motionMs,playback_phase:this.playbackPhase,
   clause:this.clause,clause_started:this.clauseStarted,speech_id:this.speechId,text:this.text,committed_until_ms:this.committed,
   utterance:this.utterancePlan?{speech_id:this.speechId,duration_ms:this.utterancePlan.duration,duration_final:this.utterancePlan.final,index:this.utterancePlan.index,clauses:this.utterancePlan.clauses.length}:null,
   emotion:directed??this.automaticEmotion,automatic_emotion:this.automaticEmotion,affect:a,affect_vector:vector,expression:this.expression.state(),
   emotion_pose:{...Object.fromEntries(Object.entries(faceKeys).map(([n,k])=>[k,this.face[n]??0])),...this.face},expressions:Object.fromEntries(Object.entries(faceKeys).map(([n,k])=>[k,this.face[n]??0])),
   gestures:this.gestures.state(this.actionMs),body_motion:this.body.state(this.actionMs),directives:[...this.cues.values()].map(c=>({...c,until:Number.isFinite(c.until)?c.until:null})),
   channels:this.channelMeta.map(p=>p.id),values:this.channelMeta.map(p=>this.lastValues[p.id]??p.default),velocity:this.channelMeta.map(p=>this.lastVelocity[p.id]??0),history:this.history.map(h=>h.values),motion_backends:['groups']};
 }
}
