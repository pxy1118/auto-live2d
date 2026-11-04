import { ControlError, type Parameter, type Manifest } from './controller';
import { appearanceFields, appearanceValues, defaultAppearance, emotions, eyeNames, faceKeys, performanceCapabilities, streamChannels } from './performance-profile';
import { MotorPolicy, type MotionStyle } from './motor';
import {GestureLibrary,gestureNames,retiredGestures,gestureArmChannels,gestureFingerChannels,type GestureName} from './gesture-library';

const clamp=(x:number,a=0,b=1)=>Math.min(b,Math.max(a,x));
const smooth=(x:number)=>{x=clamp(x);return x*x*(3-2*x);};
const fail=(message:string):never=>{throw new ControlError('invalid_performance',message);};
const finite=(x:any,lo:number,hi:number,label:string)=>{if(typeof x!=='number'||!Number.isFinite(x)||x<lo||x>hi)fail(label);return x as number;};
type Track={start:number;values:number[][];channels:string[];motor:number;threshold:number;intent:string;confidence:number};
type Cue={id:string;emotion?:string;intensity:number;expression?:string;gesture_hint?:string;until:number;clause?:number;hold_ms:number;started:boolean;gesture?:GestureName|'rest';gesture_hold_ms:number;variant?:number;serial:number;gesture_started?:boolean};

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
  private backend:'groups'|'continuous'='groups';private cueSerial=0;private gestureBlockUntil=0;
  private actionMs=0;private actionSpeechId:string|null=null;private actionAudioMs=0;
  constructor(private parameters:Parameter[],motions:Manifest['motions']=[]){this.channelMeta=parameters.filter(p=>streamChannels.includes(p.id));this.gestures=new GestureLibrary(motions);}
  start(params:any,current:Record<string,number>){
    if(typeof params.session_id!=='string'||!/^[a-f0-9]{32}$/.test(params.session_id))fail('session_id 不合法');
    if(params.motion_style!==undefined&&!['restrained','natural','lively'].includes(params.motion_style))fail('motion_style 不合法');
    if(params.motion_backend!==undefined&&!['groups','continuous'].includes(params.motion_backend))fail('motion_backend 不合法');
    this.backend=params.motion_backend??'groups';this.gestures.release(this.actionMs);this.gestureBlockUntil=0;
    this.id=params.session_id;this.active=true;this.mediaMs=0;this.mediaBase=0;this.motionMs=0;this.motionBase=0;this.gestureOrigin=null;this.speechId=null;this.clause=-1;
    this.clauseStarted=false;
    this.tracks=[];this.committed=0;this.history=[];this.lastSample=-100;this.lastValues={...current};this.lastVelocity={};this.cues.clear();
    this.pendingFaces=[];
    this.motor=new MotorPolicy(params.motion_style??'restrained');this.motor.begin(current);
    return this.state();
  }
  require(id:any){if(!this.active||id!==this.id)throw new ControlError('performance_cancelled','该表演会话已停止');}
  segment(params:any){this.require(params.session_id);if(!Number.isInteger(params.clause)||params.clause<=this.clause)fail('分句顺序错误');
    this.mediaBase=this.mediaMs;this.motionBase=this.motionMs;this.clause=params.clause;this.text=params.text;this.speechId=params.speech_id;
    this.clauseStarted=false;
    this.committed=this.motionMs;this.tracks=this.tracks.filter(t=>t.start<=this.motionMs).slice(-1);this.pendingFaces=[];
    this.motor.segment();
    return this.state();}
  cancel(id?:string){if(id!==undefined&&id!==this.id)return {cancelled:false};this.active=false;this.tracks=[];this.cues.clear();this.pendingFaces=[];this.speechId=null;this.motor.stop(this.actorMs);this.gestures.release(this.actionMs);return {cancelled:true};}
  reset(){this.cancel();this.id=null;this.gestures.clear();this.appearanceOwned=false;this.appearance={...defaultAppearance};this.auto.clear();this.face={};this.history=[];this.lastValues={};this.lastVelocity={};}
  detach(){this.cancel();this.id=null;this.gestures.clear();this.auto.clear();this.face={};this.lastValues={};this.lastVelocity={};}
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
    if(params.emotion===undefined&&expression===undefined&&params.gesture_hint===undefined&&params.gesture===undefined)fail('导演指令需要情绪、表情或动作意图');
    if(params.gesture!==undefined&&params.gesture!=='rest'&&!gestureNames.includes(params.gesture))fail('不支持的动作组');
    if(params.gesture!==undefined&&params.gesture!=='rest'&&!this.gestures.available(params.gesture))fail('当前角色缺少该动作组需要的原生动画');
    if(params.variant!==undefined&&(!Number.isInteger(params.variant)||params.variant<0||params.variant>2))fail('variant 必须为 0～2');
    const gestureHold=finite(params.gesture_hold_ms??1400,0,15000,'动作保持时间不合法');
    if(params.gesture_hint!==undefined&&(typeof params.gesture_hint!=='string'||params.gesture_hint.length>300))fail('gesture_hint 过长');
    if(params.clause!==undefined&&(!Number.isInteger(params.clause)||params.clause<0))fail('clause 不合法');
    const intensity=finite(params.intensity??.7,0,1,'intensity 必须在 0～1'),hold=finite(params.hold_ms??3000,0,600000,'hold_ms 不合法');
    const started=params.clause===undefined||params.clause<this.clause||params.clause===this.clause&&this.clauseStarted;
    this.cues.delete(id);this.cues.set(id,{id,emotion:params.emotion,expression,gesture_hint:params.gesture_hint,intensity,hold_ms:hold,
      until:started?this.actorMs+hold:Infinity,clause:params.clause,started,gesture:params.gesture,gesture_hold_ms:gestureHold,variant:params.variant,serial:++this.cueSerial});return {cue_id:id};
  }
  release(params:any){if(params.cue_id!==undefined)this.cues.delete(params.cue_id);else this.cues.clear();this.gestures.release(this.actionMs,params.cue_id);this.gestureBlockUntil=0;return {released:true};}
  private at(track:Track,time:number,id:string){
    const j=track.channels.indexOf(id);if(j<0)return undefined;
    const p=clamp((time-track.start)/50,0,track.values.length-1),i=Math.min(track.values.length-2,Math.floor(p)),u=p-i;
    const a=track.values[i][j],b=track.values[i+1][j];
    const va=(track.values[Math.min(track.values.length-1,i+1)][j]-track.values[Math.max(0,i-1)][j])/(i===0?50:100);
    const vb=(track.values[Math.min(track.values.length-1,i+2)][j]-a)/(i+2>=track.values.length?50:100);
    return (2*u**3-3*u*u+1)*a+(u**3-2*u*u+u)*50*va+(-2*u**3+3*u*u)*b+(u**3-u*u)*50*vb;
  }
  private sample(time:number,id:string){const t=[...this.tracks].reverse().find(t=>t.start<=time);return t?this.at(t,time,id):this.lastValues[id];}
  chunk(params:any){
    this.require(params.session_id);
    const {channels,values}=params;const start=finite(params.start_ms,0,86400000,'start_ms 不合法');
    if(!Array.isArray(channels)||!channels.length||new Set(channels).size!==channels.length||channels.some(id=>!streamChannels.includes(id)||!this.parameters.some(p=>p.id===id)))fail('动作通道不合法');
    if(!Array.isArray(values)||values.length!==24||values.some(row=>!Array.isArray(row)||row.length!==channels.length||row.some((x:any)=>typeof x!=='number'||!Number.isFinite(x))))fail('需要 24 帧有限动作值');
    const strengths=params.expressions??{};
    for(const [name,value] of Object.entries(strengths)){if(!Object.hasOwn(faceKeys,name))fail('表情通道不合法');finite(value,0,1,'表情强度不合法');}
    const hold=finite(params.hold_ms??3000,0,10000,'自动表情保持时间不合法');
    if(params.emotion!==undefined&&!emotions.includes(params.emotion))fail('情绪不合法');
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
    this.tracks=this.tracks.filter(t=>t.start<start).slice(-8);this.tracks.push({start,values:bounded,channels,motor,threshold,intent,confidence});this.committed=start+400;
    // Apply automatic face targets on media time, not on network arrival.
    const faceStart=params.face_start_media_ms??this.mediaMs+Math.max(0,start-this.motionMs);
    this.pendingFaces.push({at:finite(faceStart,0,86400000,'表情时钟不合法'),strengths:{...strengths},hold,emotion:params.emotion??'neutral'});
    return {accepted:true,committed_until_ms:this.committed};
  }
  private pendingFaces:{at:number;strengths:Record<string,number>;hold:number;emotion:string}[]=[];
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
      else if((this.motor.phase!=='idle'||this.gestures.active)&&(speech.phase==='idle'||!this.clauseStarted&&speech.phase!=='paused'))this.motionMs+=dt*1000;
    }
    while(this.pendingFaces.length&&this.pendingFaces[0].at<=this.mediaMs){
      const f=this.pendingFaces.shift()!;this.automaticEmotion=f.emotion;
      for(const [name,value] of Object.entries(f.strengths))if(value>.06)this.auto.set(name,{value,until:this.actorMs+f.hold});
    }
    const targets:Record<string,number>={};for(const [name,e] of this.auto)targets[name]=this.actorMs<e.until?e.value:0;
    for(const [id,c] of this.cues){
      if(!c.started&&(c.clause!<this.clause||c.clause===this.clause&&this.clauseStarted)){c.started=true;c.until=this.actorMs+c.hold_ms;}
      if(!c.started)continue;
      if(c.gesture&&!c.gesture_started){
        if(c.gesture==='rest'){this.gestures.release(this.actionMs);this.gestureBlockUntil=this.actorMs+c.gesture_hold_ms;}
        else this.gestures.request({name:c.gesture,id:c.id+':'+c.serial,cueId:c.id,source:'director',holdMs:c.gesture_hold_ms,variant:c.variant},this.actionMs,{...base,...this.lastValues},this.lastVelocity);
        c.gesture_started=true;
      }
      if(this.actorMs>=c.until){this.cues.delete(id);continue;}
      if(c.emotion){for(const n of Object.keys(faceKeys))targets[n]=0;
        const map={angry:'黑脸',shy:'脸红',sad:'流泪',confused:'圈圈眼'};
        if(map[c.emotion])targets[map[c.emotion]]=c.intensity;}
      if(c.expression){if(eyeNames.includes(c.expression))for(const name of eyeNames.slice(1))targets[name]=0;targets[c.expression]=c.intensity;}
    }
    const eye=eyeNames.slice(1).reduce((a,b)=>(targets[b]??0)>(targets[a]??0)?b:a,eyeNames[1]);
    for(const n of eyeNames.slice(1))if(n!==eye)targets[n]=0;
    if((targets[eye]??0)>0)for(const n of eyeNames.slice(1))if(n!==eye)this.face[n]=0;
    for(const name of Object.keys(faceKeys)){const old=this.face[name]??0;this.face[name]=old+(1-Math.exp(-dt/(targets[name]>old?.18:.5)))*((targets[name]??0)-old);}
    const result:Record<string,number>={};
    if(this.id)for(const p of this.channelMeta){const value=this.active?this.sample(this.motionMs,p.id):this.lastValues[p.id];if(value!==undefined)result[p.id]=clamp(value,p.min,p.max);}
    if(this.id&&(this.tracks.some(t=>t.start<=this.motionMs)||!this.active)){
      const track=[...this.tracks].reverse().find(t=>t.start<=this.motionMs);
      const cue=[...this.cues.values()].reverse().find(c=>c.started&&c.gesture_hint);
      const count=this.motor.count;
      const shaped=this.motor.apply(result,dt,{actor:this.actorMs,media:this.motionMs,playing:this.active&&this.clauseStarted&&speech.phase==='playing',ended:speech.phase==='idle',
        confidence:track?.motor??0,threshold:track?.threshold??.8,forceKey:cue?cue.id+':'+cue.until:undefined,forceIntensity:cue?.intensity,active:this.active});
      Object.assign(result,shaped);
      if(this.motor.count!==count)this.gestureOrigin={text:this.text,hint:cue?.gesture_hint,clause:this.clause};
      if(this.backend==='groups'&&this.motor.count!==count&&this.actorMs>=this.gestureBlockUntil&&track&&gestureNames.includes(track.intent as GestureName)&&track.confidence>=.65)
        this.gestures.request({name:track.intent as GestureName,id:`model:${this.id}:${this.motor.count}`,source:'model'},this.actionMs,this.lastValues,this.lastVelocity);
    }
    if(this.backend==='groups'&&(this.id||this.gestures.active))for(const id of gestureArmChannels)result[id]=(this.lastValues[id]??base[id]??0)*Math.exp(-dt/.12);
    const action=this.gestures.tick(this.actionMs,result);for(const [id,value] of Object.entries(action)){const p=this.parameters.find(p=>p.id===id);if(p)result[id]=clamp(value,p.min,p.max);}
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
  hasActions(){return this.gestures.active;}
  capabilities(){return {...performanceCapabilities(this.parameters),action_groups:this.gestures.capabilities(),default_motion_backend:'groups',motion_backends:['groups','continuous']};}
  state(){const directedEmotion=[...this.cues.values()].reverse().find(c=>c.started&&c.until>this.actorMs&&c.emotion)?.emotion;
    return {session_id:this.id,active:this.active,motion_backend:this.backend,motion_actions:this.gestures.state(this.actionMs),action_clock_ms:this.actionMs,actor_ms:this.actorMs,media_ms:this.mediaMs,motion_ms:this.motionMs,clause_media_ms:this.mediaMs-this.mediaBase,gesture_origin:this.motor.phase==='idle'?null:this.gestureOrigin,clause:this.clause,clause_started:this.clauseStarted,speech_id:this.speechId,text:this.text,
    committed_until_ms:this.committed,emotion:directedEmotion??this.automaticEmotion,automatic_emotion:this.automaticEmotion,expressions:{...this.face},appearance:this.getAppearance(),
    directives:[...this.cues.values()].map(c=>({...c,until:Number.isFinite(c.until)?c.until:null})),
    gesture_policy:this.motor.state(this.actorMs),
    channels:this.channelMeta.map(p=>p.id),values:this.channelMeta.map(p=>this.lastValues[p.id]??p.default),
    velocity:this.channelMeta.map(p=>this.lastVelocity[p.id]??0),history:this.history.map(h=>h.values)};}
}
