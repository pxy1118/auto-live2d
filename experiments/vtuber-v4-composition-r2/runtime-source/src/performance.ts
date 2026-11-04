import { ControlError, type Parameter, type Manifest } from './controller';
import { appearanceFields, appearanceValues, defaultAppearance, emotions, eyeNames, faceKeys, performanceCapabilities, streamChannels } from './performance-profile';
import { MotorPolicy, type MotionStyle } from './motor';
import {GestureLibrary,gestureNames,retiredGestures,gestureArmChannels,gestureFingerChannels,type GestureName} from './gesture-library';
import {BodyMotionLayer,bodyChannels,bodyMotionNames,type BodyMotionName} from './body-motion';
import {validatePlan,planFaceNames,type PerformancePlan} from './performance-plan';

const clamp=(x:number,a=0,b=1)=>Math.min(b,Math.max(a,x));
const smooth=(x:number)=>{x=clamp(x);return x*x*(3-2*x);};
const fail=(message:string):never=>{throw new ControlError('invalid_performance',message);};
const finite=(x:any,lo:number,hi:number,label:string)=>{if(typeof x!=='number'||!Number.isFinite(x)||x<lo||x>hi)fail(label);return x as number;};
type Track={start:number;values:number[][];channels:string[];motor:number;threshold:number;intent:string;confidence:number;planned:boolean};
type ActionEvent={part:'arm'|'body';name:string;variant:number;at:number;source:string};
type Cue={id:string;emotion?:string;intensity:number;expression?:string;gesture_hint?:string;until:number;clause?:number;hold_ms:number;started:boolean;gesture?:GestureName|'rest';gesture_hold_ms:number;variant?:number;serial:number;gesture_started?:boolean;body_motion?:BodyMotionName|'rest';body_variant?:number;body_strength:number;body_hold_ms:number;body_started?:boolean};

/** Session state lives independently of legacy timelines and the audio stream lifetime. */
export class PerformanceController {
  id:string|null=null;
  active=false;
  actorMs=0;
  mediaMs=0;
  motionMs=0;
  clause=-1;
  text='';
  private mediaBase=0;
  private motionBase=0;
  private gestureOrigin:{text:string;hint?:string;clause:number}|null=null;
  private speechId:string|null=null;
  private clauseStarted=false;
  private tracks:Track[]=[];
  private committed=0;
  private appearance={...defaultAppearance};
  private cues=new Map<string,Cue>();
  private auto=new Map<string,{value:number;until:number}>();
  private face:Record<string,number>={};
  private history:{at:number;values:number[]}[]=[];
  private lastSample=-100;
  private lastValues:Record<string,number>={};
  private lastVelocity:Record<string,number>={};
  private channelMeta:Parameter[];
  private automaticEmotion='neutral';
  private motor=new MotorPolicy();
  private gestures:GestureLibrary;
  private body=new BodyMotionLayer();private lastBodyOffset:Record<string,number>={};private lastBodyVelocity:Record<string,number>={};
  private backend:'groups'|'continuous'='groups';private cueSerial=0;private gestureBlockUntil=0;
  private actionMs=0;private actionSpeechId:string|null=null;private actionAudioMs=0;
  private plannerEnabled=false;private pendingPlan:PerformancePlan|null=null;private seenPlanClauses=new Set<number>();
  private planHistory:any[]=[];private actionHistory:ActionEvent[]=[];private seenArmCount=0;private seenBodyCount=0;private automaticEmotionUntil=Infinity;
  constructor(private parameters:Parameter[],motions:Manifest['motions']=[]){this.channelMeta=parameters.filter(p=>streamChannels.includes(p.id));this.gestures=new GestureLibrary(motions);}
  start(params:any,current:Record<string,number>){
    if(typeof params.session_id!=='string'||!/^[a-f0-9]{32}$/.test(params.session_id))fail('session_id 不合法');
    if(params.motion_style!==undefined&&!['restrained','natural','lively'].includes(params.motion_style))fail('motion_style 不合法');
    if(params.motion_backend!==undefined&&!['groups','continuous'].includes(params.motion_backend))fail('motion_backend 不合法');
    this.backend=params.motion_backend??'groups';this.gestures.release(this.actionMs);this.body.release(this.actionMs);this.gestureBlockUntil=0;
    this.id=params.session_id;this.active=true;this.mediaMs=0;this.mediaBase=0;this.motionMs=0;this.motionBase=0;this.gestureOrigin=null;this.speechId=null;this.clause=-1;
    this.clauseStarted=false;
    this.tracks=[];this.committed=0;this.history=[];this.lastSample=-100;this.lastValues={...current};this.lastVelocity={};this.cues.clear();
    this.pendingFaces=[];
    this.plannerEnabled=false;this.pendingPlan=null;this.seenPlanClauses.clear();this.planHistory=[];this.actionHistory=[];
    this.seenArmCount=this.gestures.state(this.actionMs).count;this.seenBodyCount=this.body.state(this.actionMs).count;
    this.motor=new MotorPolicy(params.motion_style??'restrained');this.motor.begin(current);
    return this.state();
  }
  require(id:any){if(!this.active||id!==this.id)throw new ControlError('performance_cancelled','该表演会话已停止');}
  segment(params:any){this.require(params.session_id);if(!Number.isInteger(params.clause)||params.clause<=this.clause)fail('分句顺序错误');
    this.mediaBase=this.mediaMs;this.motionBase=this.motionMs;this.clause=params.clause;this.text=params.text;this.speechId=params.speech_id;
    this.clauseStarted=false;
    this.committed=this.motionMs;this.tracks=this.tracks.filter(t=>t.start<=this.motionMs).slice(-1);this.pendingFaces=[];this.pendingPlan=null;
    this.motor.segment();
    return this.state();}
  cancel(id?:string){if(id!==undefined&&id!==this.id)return {cancelled:false};this.active=false;this.tracks=[];this.cues.clear();this.pendingFaces=[];this.pendingPlan=null;this.speechId=null;this.motor.stop(this.actorMs);this.gestures.release(this.actionMs);this.body.release(this.actionMs);return {cancelled:true};}
  private clearPlanning(){this.plannerEnabled=false;this.pendingPlan=null;this.seenPlanClauses.clear();this.planHistory=[];this.actionHistory=[];this.seenArmCount=0;this.seenBodyCount=0;this.automaticEmotion='neutral';this.automaticEmotionUntil=Infinity;}
  reset(){this.cancel();this.id=null;this.gestures.clear();this.body.clear();this.lastBodyOffset={};this.lastBodyVelocity={};this.appearanceOwned=false;this.appearance={...defaultAppearance};this.auto.clear();this.face={};this.history=[];this.lastValues={};this.lastVelocity={};this.clearPlanning();}
  detach(){this.cancel();this.id=null;this.gestures.clear();this.body.clear();this.lastBodyOffset={};this.lastBodyVelocity={};this.auto.clear();this.face={};this.lastValues={};this.lastVelocity={};this.clearPlanning();}
  updateAppearance(params:any){
    if(!params||typeof params!=='object'||Array.isArray(params)||!Object.keys(params).length)fail('外观设置不能为空');
    for(const [key,value] of Object.entries(params))if(!Object.hasOwn(appearanceFields,key)||!(appearanceFields[key] as any[]).includes(value))fail(`不支持的外观选项：${key}`);
    Object.assign(this.appearance,params);return {...this.appearance};
  }
  getAppearance(){return {...this.appearance};}
  direct(params:any){
    if(params.session_id!==undefined)this.require(params.session_id);
    const id=params.cue_id??crypto.randomUUID();if(typeof id!=='string'||id.length>128||!id.length)fail('cue_id 不合法');
    if(params.emotion!==undefined&&!emotions.includes(params.emotion))fail('不支持的情绪');
    const expression=params.expression==='><'?'＞＜':params.expression;
    if(expression!==undefined&&!Object.hasOwn(faceKeys,expression))fail('不支持的表情');
    if(params.emotion===undefined&&expression===undefined&&params.gesture_hint===undefined&&params.gesture===undefined&&params.body_motion===undefined)fail('导演指令需要情绪、表情或动作意图');
    if(params.body_motion!==undefined&&params.body_motion!=='rest'&&!bodyMotionNames.includes(params.body_motion))fail('不支持的身体动作');
    if(params.body_variant!==undefined&&(!Number.isInteger(params.body_variant)||params.body_variant<0||params.body_variant>2))fail('body_variant 必须为 0～2');
    const bodyStrength=finite(params.body_strength??.75,0,1,'body_strength 必须在 0～1'),bodyHold=finite(params.body_hold_ms??2200,0,15000,'身体动作保持时间不合法');
    if(params.gesture!==undefined&&params.gesture!=='rest'&&!gestureNames.includes(params.gesture))fail('不支持的动作组');
    if(params.gesture!==undefined&&params.gesture!=='rest'&&!this.gestures.available(params.gesture))fail('当前角色缺少该动作组需要的原生动画');
    if(params.variant!==undefined&&(!Number.isInteger(params.variant)||params.variant<0||params.variant>2))fail('variant 必须为 0～2');
    const gestureHold=finite(params.gesture_hold_ms??1400,0,15000,'动作保持时间不合法');
    if(params.gesture_hint!==undefined&&(typeof params.gesture_hint!=='string'||params.gesture_hint.length>300))fail('gesture_hint 过长');
    if(params.clause!==undefined&&(!Number.isInteger(params.clause)||params.clause<0))fail('clause 不合法');
    const intensity=finite(params.intensity??.7,0,1,'intensity 必须在 0～1'),hold=finite(params.hold_ms??3000,0,600000,'hold_ms 不合法');
    const started=params.clause===undefined||params.clause<this.clause||params.clause===this.clause&&this.clauseStarted;
    this.cues.delete(id);this.cues.set(id,{id,emotion:params.emotion,expression,gesture_hint:params.gesture_hint,intensity,hold_ms:hold,
      until:started?this.actorMs+hold:Infinity,clause:params.clause,started,gesture:params.gesture,gesture_hold_ms:gestureHold,variant:params.variant,serial:++this.cueSerial,
      body_motion:params.body_motion,body_variant:params.body_variant,body_strength:bodyStrength,body_hold_ms:bodyHold});return {cue_id:id};
  }
  release(params:any){if(params.cue_id!==undefined)this.cues.delete(params.cue_id);else this.cues.clear();this.gestures.release(this.actionMs,params.cue_id);this.body.release(this.actionMs,params.cue_id);this.gestureBlockUntil=0;return {released:true};}
  private underlay(id:string){return this.lastValues[id]===undefined?undefined:this.lastValues[id]-(this.lastBodyOffset[id]??0);}
  private armOrigin(base:Record<string,number>={}){return Object.fromEntries(Object.entries({...base,...this.lastValues}).map(([id,value])=>[id,value-(this.lastBodyOffset[id]??0)]));}
  private armVelocity(){return Object.fromEntries(Object.entries(this.lastVelocity).map(([id,value])=>[id,value-(this.lastBodyVelocity[id]??0)]));}
  private at(track:Track,time:number,id:string){
    const j=track.channels.indexOf(id);if(j<0)return undefined;
    const p=clamp((time-track.start)/50,0,track.values.length-1),i=Math.min(track.values.length-2,Math.floor(p)),u=p-i;
    const a=track.values[i][j],b=track.values[i+1][j];
    const va=(track.values[Math.min(track.values.length-1,i+1)][j]-track.values[Math.max(0,i-1)][j])/(i===0?50:100);
    const vb=(track.values[Math.min(track.values.length-1,i+2)][j]-a)/(i+2>=track.values.length?50:100);
    return (2*u**3-3*u*u+1)*a+(u**3-2*u*u+u)*50*va+(-2*u**3+3*u*u)*b+(u**3-u*u)*50*vb;
  }
  private sample(time:number,id:string){const t=[...this.tracks].reverse().find(t=>t.start<=time);return t?this.at(t,time,id):this.underlay(id);}
  chunk(params:any){
    this.require(params.session_id);
    const {channels,values}=params;const start=finite(params.start_ms,0,86400000,'start_ms 不合法');
    if(!Array.isArray(channels)||!channels.length||new Set(channels).size!==channels.length||channels.some(id=>!streamChannels.includes(id)||!this.parameters.some(p=>p.id===id)))fail('动作通道不合法');
    if(!Array.isArray(values)||values.length!==24||values.some(row=>!Array.isArray(row)||row.length!==channels.length||row.some((x:any)=>typeof x!=='number'||!Number.isFinite(x))))fail('需要 24 帧有限动作值');
    const strengths=params.expressions??{};
    for(const [name,value] of Object.entries(strengths)){if(!Object.hasOwn(faceKeys,name))fail('表情通道不合法');finite(value,0,1,'表情强度不合法');}
    const hold=finite(params.hold_ms??3000,0,10000,'自动表情保持时间不合法');
    if(params.emotion!==undefined&&!emotions.includes(params.emotion))fail('情绪不合法');
    const plan=params.performance_plan===undefined?null:validatePlan(params.performance_plan,this.clause);
    const faceStart=finite(params.face_start_media_ms??this.mediaMs+Math.max(0,start-this.motionMs),0,86400000,'表情时钟不合法');
    if(start<this.motionMs-80||start<this.committed-1)return {accepted:false,reason:'late_or_committed',media_ms:this.mediaMs,motion_ms:this.motionMs,committed_until_ms:this.committed};
    const bounded=values.map(row=>row.map((x:number,j:number)=>{const p=this.parameters.find(p=>p.id===channels[j])!;return clamp(x,p.min,p.max);}));
    // Replace only the uncommitted tail. Anchor position AND velocity at the new boundary.
    for(let j=0;j<channels.length;j++){
      const id=channels[j],p0=this.sample(start,id)??bounded[0][j],v0=(this.sample(start+1,id)??p0)-p0;
      const p1=bounded[3][j],v1=(bounded[4][j]-bounded[2][j])/100;
      for(let i=0;i<3;i++){const u=i/3;bounded[i][j]=(2*u**3-3*u*u+1)*p0+(u**3-2*u*u+u)*150*v0+(-2*u**3+3*u*u)*p1+(u**3-u*u)*150*v1;}
    }
    const retired=retiredGestures.includes(params.gesture_intent);
    const motor=finite(retired?0:params.motor_probability??0,0,1,'motor_probability 不合法'),threshold=finite(params.motor_threshold??.8,0,1,'motor_threshold 不合法');
    const intent=retired?'none':params.gesture_intent??'none';if(intent!=='none'&&!gestureNames.includes(intent))fail('动作组预测不合法');const confidence=finite(retired?0:params.gesture_confidence??0,0,1,'动作组置信度不合法');
    this.tracks=this.tracks.filter(t=>t.start<start).slice(-8);this.tracks.push({start,values:bounded,channels,motor,threshold,intent,confidence,planned:!!plan});this.committed=start+400;
    // Apply automatic face targets on media time, not on network arrival.
    if(plan){this.plannerEnabled=true;if(!this.seenPlanClauses.has(this.clause)){this.seenPlanClauses.add(this.clause);this.pendingPlan=plan;}}
    else this.pendingFaces.push({at:faceStart,strengths:{...strengths},hold,emotion:params.emotion??'neutral'});
    return {accepted:true,committed_until_ms:this.committed};
  }
  private pendingFaces:{at:number;strengths:Record<string,number>;hold:number;emotion:string}[]=[];
  private gaps(){return this.motor.style==='lively'?{arm:4000,body:2600}:this.motor.style==='natural'?{arm:5000,body:3200}:{arm:6000,body:4000};}
  private latest(part:'arm'|'body'){return [...this.actionHistory].reverse().find(a=>a.part===part);}
  private consumePlan(base:Record<string,number>){
    const p=this.pendingPlan!;this.pendingPlan=null;const event:any={clause:this.clause,at_ms:this.actionMs,plan:p,arm_applied:false,body_applied:false};
    const arm=this.latest('arm'),body=this.latest('body'),gap=this.gaps(),cues=[...this.cues.values()].filter(c=>c.started?c.until>this.actorMs:c.clause!==undefined&&c.clause<=this.clause&&this.clauseStarted);
    if(this.backend==='groups'&&p.arm!=='none'){
      const uncertain=p.confidence.arm<(p.arm==='grass'?.95:.85);
      const blocked=uncertain||this.gestures.active||this.actorMs<this.gestureBlockUntil||cues.some(c=>!!c.gesture)||arm&&this.actionMs-arm.at<gap.arm;
      if(!blocked){const variant=arm?.name===p.arm&&arm.variant===p.arm_variant?(p.arm_variant+1)%3:p.arm_variant;event.arm_applied=this.gestures.request({name:p.arm as GestureName,id:`plan:${this.id}:${this.clause}:arm`,source:'model',variant,holdMs:p.arm_hold_ms},this.actionMs,this.armOrigin(base),this.armVelocity());}
      else event.arm_skipped=uncertain?'low_confidence':'busy_directed_or_cooldown';
    }
    if(this.backend==='groups'&&p.body!=='none'&&p.body_strength>.05){
      const blocked=this.body.active||cues.some(c=>!!c.body_motion)||body&&this.actionMs-body.at<gap.body;
      if(!blocked){const variant=body?.name===p.body&&body.variant===p.body_variant?(p.body_variant+1)%3:p.body_variant;event.body_applied=this.body.request({name:p.body as BodyMotionName,id:`plan:${this.id}:${this.clause}:body`,source:'model',variant,strength:p.body_strength,holdMs:p.body_hold_ms},this.actionMs);}
      else event.body_skipped='busy_directed_or_cooldown';
    }
    if(p.emotion!=='keep'&&p.confidence.emotion>=.7){
      this.automaticEmotion=p.emotion;this.automaticEmotionUntil=this.actorMs+p.face_hold_ms;
      for(const name of Object.keys(faceKeys))this.auto.set(name,{value:0,until:this.automaticEmotionUntil});
      if(p.emotion!=='neutral')for(const name of planFaceNames)this.auto.set(name,{value:p.expressions[name],until:this.automaticEmotionUntil});
    }
    if(p.confidence.eye>=.6){for(const name of eyeNames.slice(1))this.auto.set(name,{value:name===p.eye&&p.eye_strength>.05?1:0,until:this.actorMs+p.face_hold_ms});}
    this.planHistory.push(event);this.planHistory=this.planHistory.slice(-32);
  }
  private observeActions(){
    const arm=this.gestures.state(this.actionMs),body=this.body.state(this.actionMs);
    if(arm.active&&arm.count!==this.seenArmCount){this.actionHistory.push({part:'arm',name:arm.name!,variant:arm.variant!,at:this.actionMs,source:arm.source!});this.seenArmCount=arm.count;}
    if(body.active&&body.count!==this.seenBodyCount){this.actionHistory.push({part:'body',name:body.name!,variant:body.variant!,at:this.actionMs,source:body.source!});this.seenBodyCount=body.count;}
    this.actionHistory=this.actionHistory.slice(-32);
  }
  private plannerState(){
    const arm=this.latest('arm'),body=this.latest('body');let selected=0;for(let i=1;i<eyeNames.length;i++)if((this.face[eyeNames[i]]??0)>.15)selected=i;
    return {emotion:this.automaticEmotion,face_state:[...planFaceNames.map(n=>this.face[n]??0),selected>0?this.face[eyeNames[selected]]??0:0,...eyeNames.map((_,i)=>i===Math.max(0,selected)?1:0)],
      last_arm:arm?.name??'none',last_body:body?.name??'none',last_arm_variant:arm?.variant??null,last_body_variant:body?.variant??null,
      arm_age_ms:arm?this.actionMs-arm.at:6000,body_age_ms:body?this.actionMs-body.at:4000,arm_active:this.gestures.active,body_active:this.body.active};
  }
  tick(dt:number,speech:any,base:Record<string,number>){
    if(dt>0)this.actorMs+=dt*1000;
    if(dt>0){
      if(speech.speech_id!==this.actionSpeechId){this.actionSpeechId=speech.speech_id??null;this.actionAudioMs=0;}
      const audio=Number.isFinite(speech.audio_time_ms)?speech.audio_time_ms:0;
      if(speech.phase==='playing')this.actionMs+=Math.max(0,audio-this.actionAudioMs);
      else if(speech.phase!=='paused'&&!(speech.phase==='buffering'&&this.actionAudioMs>0))this.actionMs+=dt*1000;
      this.actionAudioMs=audio;
    }
    if(this.active&&speech.speech_id===this.speechId){
      this.mediaMs=Math.max(this.mediaMs,this.mediaBase+speech.audio_time_ms);
      if(!this.clauseStarted&&speech.phase==='playing'&&this.motionMs>this.motionBase)this.motionBase=this.motionMs;
      if(speech.phase==='playing'||speech.audio_time_ms>0)this.clauseStarted=true;
      if(speech.phase==='playing')this.motionMs=Math.max(this.motionMs,this.motionBase+speech.audio_time_ms);
      else if((this.motor.phase!=='idle'||this.gestures.active||this.body.active)&&(speech.phase==='idle'||!this.clauseStarted&&speech.phase!=='paused'))this.motionMs+=dt*1000;
    }
    if(this.active&&this.pendingPlan&&this.clauseStarted&&speech.phase==='playing'&&this.mediaMs-this.mediaBase>=this.pendingPlan.onset_ms)this.consumePlan(base);
    if(this.actorMs>=this.automaticEmotionUntil)this.automaticEmotion='neutral';
    while(this.pendingFaces.length&&this.pendingFaces[0].at<=this.mediaMs){
      const f=this.pendingFaces.shift()!;this.automaticEmotion=f.emotion;this.automaticEmotionUntil=this.actorMs+f.hold;
      for(const [name,value] of Object.entries(f.strengths))if(value>.06)this.auto.set(name,{value,until:this.actorMs+f.hold});
    }
    const targets:Record<string,number>={};for(const [name,e] of this.auto)targets[name]=this.actorMs<e.until?e.value:0;
    for(const [id,c] of this.cues){
      if(!c.started&&(c.clause!<this.clause||c.clause===this.clause&&this.clauseStarted)){c.started=true;c.until=this.actorMs+c.hold_ms;}
      if(!c.started)continue;
      if(c.gesture&&!c.gesture_started){
        if(c.gesture==='rest'){this.gestures.release(this.actionMs);this.gestureBlockUntil=this.actorMs+c.gesture_hold_ms;}
        else this.gestures.request({name:c.gesture,id:c.id+':'+c.serial,cueId:c.id,source:'director',holdMs:c.gesture_hold_ms,variant:c.variant},this.actionMs,this.armOrigin(base),this.armVelocity());
        c.gesture_started=true;
      }
      if(c.body_motion&&!c.body_started){
        if(c.body_motion==='rest')this.body.release(this.actionMs);
        else this.body.request({name:c.body_motion,id:c.id+':'+c.serial,cueId:c.id,holdMs:c.body_hold_ms,variant:c.body_variant,strength:c.body_strength},this.actionMs);
        c.body_started=true;
      }
      if(this.actorMs>=c.until){this.cues.delete(id);continue;}
      if(c.emotion){for(const n of Object.keys(faceKeys))targets[n]=0;
        const map={angry:'黑脸',shy:'脸红',sad:'流泪',confused:'圈圈眼'};
        if(map[c.emotion])targets[map[c.emotion]]=c.intensity;}
      if(c.expression){if(eyeNames.includes(c.expression))for(const name of eyeNames.slice(1))targets[name]=0;targets[c.expression]=c.intensity;}
    }
    const eye=eyeNames.slice(1).reduce((a,b)=>(targets[b]??0)>(targets[a]??0)?b:a,eyeNames[1]);
    for(const name of Object.keys(faceKeys)){
      if(eyeNames.includes(name)){this.face[name]=name===eye&&(targets[eye]??0)>0?1:0;continue;}
      const old=this.face[name]??0;this.face[name]=old+(1-Math.exp(-dt/(targets[name]>old?.18:.5)))*((targets[name]??0)-old);
    }
    const result:Record<string,number>={};
    if(this.id)for(const p of this.channelMeta){const value=this.active?this.sample(this.motionMs,p.id):this.underlay(p.id);if(value!==undefined)result[p.id]=clamp(value,p.min,p.max);}
    if(this.id&&(this.tracks.some(t=>t.start<=this.motionMs)||!this.active)){
      const track=[...this.tracks].reverse().find(t=>t.start<=this.motionMs);
      const cue=[...this.cues.values()].reverse().find(c=>c.started&&c.gesture_hint);
      const count=this.motor.count;
      const shaped=this.motor.apply(result,dt,{actor:this.actorMs,media:this.motionMs,playing:this.active&&this.clauseStarted&&speech.phase==='playing',ended:speech.phase==='idle',
        confidence:track?.motor??0,threshold:track?.threshold??.8,forceKey:cue?cue.id+':'+cue.until:undefined,forceIntensity:cue?.intensity,active:this.active});
      Object.assign(result,shaped);
      if(this.motor.count!==count)this.gestureOrigin={text:this.text,hint:cue?.gesture_hint,clause:this.clause};
      if(this.backend==='groups'&&!this.plannerEnabled&&this.motor.count!==count&&this.actorMs>=this.gestureBlockUntil&&track&&gestureNames.includes(track.intent as GestureName)&&track.confidence>=.65)
        this.gestures.request({name:track.intent as GestureName,id:`model:${this.id}:${this.motor.count}`,source:'model'},this.actionMs,this.armOrigin(),this.armVelocity());
    }
    if(this.backend==='groups'&&(this.id||this.gestures.active))for(const id of gestureArmChannels)result[id]=(this.lastValues[id]??base[id]??0)*Math.exp(-dt/.12);
    const action=this.gestures.tick(this.actionMs,result);for(const [id,value] of Object.entries(action)){const p=this.parameters.find(p=>p.id===id);if(p)result[id]=clamp(value,p.min,p.max);}
    // Keep offsets out of the fallback pose: an idle/no-track session must not
    // add last frame's offset again. The continuous expert sees actual history.
    const offset=this.body.tick(this.actionMs),applied:Record<string,number>={};
    for(const [id,value] of Object.entries(offset)){const p=this.parameters.find(p=>p.id===id);if(!p)continue;const underlay=result[id]??base[id]??p.default;result[id]=clamp(underlay+value,p.min,p.max);applied[id]=result[id]-underlay;}
    if(dt>0)this.lastBodyVelocity=Object.fromEntries(bodyChannels.map(id=>[id,((applied[id]??0)-(this.lastBodyOffset[id]??0))/(dt*1000)]));
    this.lastBodyOffset=applied;
    this.observeActions();
    const faceOwned=this.id||this.auto.size||[...this.cues.values()].some(c=>!!c.emotion||!!c.expression)||Object.values(this.face).some(v=>Math.abs(v)>.0001);
    for(const [name,key] of Object.entries(faceKeys))if(faceOwned)result[key]=clamp(this.face[name]??0);
    // Explicit appearance ownership begins on a session or an appearance command.
    if(this.appearanceOwned||this.id)Object.assign(result,appearanceValues(this.appearance));
    if(dt>0){for(const [id,value] of Object.entries(result)){this.lastVelocity[id]=(value-(this.lastValues[id]??value))/(dt*1000);this.lastValues[id]=value;}
      if(this.actorMs-this.lastSample>=49){this.history.push({at:this.actorMs,values:this.channelMeta.map(p=>result[p.id]??base[p.id]??p.default)});this.history=this.history.slice(-20);this.lastSample=this.actorMs;}}
    return result;
  }
  appearanceOwned=false;
  rememberPose(values:Record<string,number>){for(const id of [...gestureArmChannels,...gestureFingerChannels,'AngleX','AngleY','AngleZ','PositionX','PositionY','PositionZ','LeanInput'])if(values[id]!==undefined)this.lastValues[id]=values[id];}
  hasActions(){return this.gestures.active||this.body.active;}
  capabilities(){return {...performanceCapabilities(this.parameters),action_groups:this.gestures.capabilities(),body_motions:this.body.capabilities(),automatic_plan:{schema:'performance.plan.v1',one_per_clause:true,history_conditioned:true,wardrobe_output:false,independent_strengths:true,minimum_gap_ms:this.gaps(),execution_confidence_min:{arm:.85,grass:.95,emotion:.7,eye:.6},director_priority:true},default_motion_backend:'groups',motion_backends:['groups','continuous']};}
  state(){const directedEmotion=[...this.cues.values()].reverse().find(c=>c.started&&c.until>this.actorMs&&c.emotion)?.emotion;
    return {session_id:this.id,active:this.active,motion_backend:this.backend,motion_actions:this.gestures.state(this.actionMs),body_action:this.body.state(this.actionMs),planner_enabled:this.plannerEnabled,planner_state:this.plannerState(),plan_history:this.planHistory,action_history:this.actionHistory,planner_policy:this.gaps(),action_clock_ms:this.actionMs,actor_ms:this.actorMs,media_ms:this.mediaMs,motion_ms:this.motionMs,clause_media_ms:this.mediaMs-this.mediaBase,gesture_origin:this.motor.phase==='idle'?null:this.gestureOrigin,clause:this.clause,clause_started:this.clauseStarted,speech_id:this.speechId,text:this.text,
    committed_until_ms:this.committed,emotion:directedEmotion??this.automaticEmotion,automatic_emotion:this.automaticEmotion,expressions:{...this.face},appearance:this.getAppearance(),
    directives:[...this.cues.values()].map(c=>({...c,until:Number.isFinite(c.until)?c.until:null})),
    gesture_policy:this.motor.state(this.actorMs),
    channels:this.channelMeta.map(p=>p.id),values:this.channelMeta.map(p=>this.lastValues[p.id]??p.default),
    velocity:this.channelMeta.map(p=>this.lastVelocity[p.id]??0),history:this.history.map(h=>h.values)};}
}
