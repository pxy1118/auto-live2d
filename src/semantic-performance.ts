import {ControlError,type Parameter} from './controller';

export const semanticDeliveries=['calm','warm','joyful','concerned','restrained_anger','ironic','firm','thoughtful','disappointed','neutral','shy','surprised'];
const acts=['praise','tease','comfort','explain','inform','refuse','confirm','greet','express','other'];
const intents=['none','wave','thank','decline','explain','emphasize','reassure','acknowledge','question','reflect','celebrate','look_toward','head_tilt','shy'];
export type SemanticBeat={anchor:string;occurrence:number;intent:string;movement:'none'|'optional'|'required';strength:'none'|'small'|'medium'|'large';delivery?:string};
export type SemanticPlan={meaning:string;affect_subject:string;speech_act:string;delivery:string;vad:number[];beats:SemanticBeat[]};
const fail=(message:string):never=>{throw new ControlError('invalid_semantic_plan',message);};
const keys=(v:any,required:string[],optional:string[]=[])=>{
 if(!v||typeof v!=='object'||Array.isArray(v)||required.some(k=>!Object.hasOwn(v,k))||Object.keys(v).some(k=>![...required,...optional].includes(k)))fail('语义计划字段不合法');
};
function anchorIndex(text:string,beat:SemanticBeat){
 let at=-1,from=0;if(!Number.isInteger(beat.occurrence)||beat.occurrence<0||beat.occurrence>text.length)fail('原文片段序号不合法');
 for(let i=0;i<=beat.occurrence;i++){at=text.indexOf(beat.anchor,from);if(at<0)fail('语义事件没有对应原文');from=at+1;}
 return at;
}
export function validateSemanticPlan(value:any,text:string):SemanticPlan{
 keys(value,['meaning','affect_subject','speech_act','delivery','vad','beats']);
 if(typeof value.meaning!=='string'||!value.meaning.trim()||value.meaning.length>120||!['avatar','other','none'].includes(value.affect_subject)||!acts.includes(value.speech_act)||!semanticDeliveries.includes(value.delivery))fail('语义解释不合法');
 if(!Array.isArray(value.vad)||value.vad.length!==3||value.vad.some((n:any)=>typeof n!=='number'||!Number.isFinite(n)||Math.abs(n)>1))fail('情感坐标不合法');
 if(!Array.isArray(value.beats)||value.beats.length>4)fail('语义事件数量不合法');
 let previous=-1;
 for(const b of value.beats){keys(b,['anchor','occurrence','intent','movement','strength'],['delivery']);
  if(typeof b.anchor!=='string'||!b.anchor.trim()||!intents.includes(b.intent)||!['none','optional','required'].includes(b.movement)||!['none','small','medium','large'].includes(b.strength)||b.delivery!==undefined&&!semanticDeliveries.includes(b.delivery))fail('语义事件不合法');
  if((b.movement==='none')!==(b.strength==='none')||b.intent==='none'&&b.movement!=='none')fail('语义动作与强度冲突');
  const at=anchorIndex(text,b);if(at<previous)fail('语义事件必须按台词顺序排列');previous=at;
 }
 return structuredClone(value);
}

const profiles:Record<string,Record<string,number>>={
 calm:{EyeSmile:.08,ParamMouthForm:.06},warm:{EyeSmile:.28,ParamMouthForm:.22,BrowInnerUp:.06},
 joyful:{EyeSmile:.50,ParamMouthForm:.4,ParamBrowLY:.1,ParamBrowRY:.1},
 concerned:{BrowInnerUp:.25,ParamMouthForm:-.12,ParamEyeBallY:-.04},
 restrained_anger:{ParamBrowLY:-.16,ParamBrowRY:-.16,ParamMouthForm:-.18},
 ironic:{ParamBrowLY:.2,ParamBrowRY:-.06,ParamMouthForm:.15,EyeSmile:.1},
 firm:{ParamBrowLY:-.08,ParamBrowRY:-.08,ParamMouthForm:-.06},
 thoughtful:{BrowInnerUp:.15,ParamBrowLY:.1,ParamEyeBallY:.06},
 disappointed:{BrowInnerUp:.24,ParamMouthForm:-.22,ParamEyeBallY:-.1},
 shy:{EyeSmile:.18,ParamMouthForm:.18,ParamEyeBallY:-.08},
 surprised:{ParamBrowLY:.28,ParamBrowRY:.28,BrowInnerUp:.12},neutral:{},
};
const emotionDelivery:Record<string,string>={neutral:'calm',happy:'joyful',angry:'restrained_anger',shy:'shy',sad:'disappointed',surprised:'surprised',confused:'thoughtful'};
export const deliveryEmotion:Record<string,string>={calm:'neutral',warm:'happy',joyful:'happy',concerned:'sad',restrained_anger:'angry',ironic:'neutral',firm:'neutral',thoughtful:'confused',disappointed:'sad',neutral:'neutral',shy:'shy',surprised:'surprised'};

/** A local media-clock layer. It never writes lip-open, eyelids, wardrobe or physics. */
export class SemanticPerformance {
 private plan:SemanticPlan|null=null;private events:(SemanticBeat&{at_ms:number;index:number})[]=[];private cursor=0;
 private delivery='neutral';private values:Record<string,number>={};private duration=0;private lastTime=0;
 private applied:any[]=[];private durationFinal=true;private fractions:number[]=[];
 constructor(private parameters:Parameter[]){}
 reset(){this.plan=null;this.events=[];this.cursor=0;this.delivery='neutral';this.values={};this.applied=[];this.duration=0;this.lastTime=0;this.fractions=[];this.durationFinal=true;}
 load(plan:SemanticPlan,text:string,duration:number,final=true){
  this.plan=validateSemanticPlan(plan,text);this.duration=duration;this.cursor=0;this.lastTime=0;this.delivery=plan.delivery;
  this.durationFinal=final;this.fractions=plan.beats.map(b=>anchorIndex(text,b)/Math.max(1,text.length));
  this.events=plan.beats.map((b,index)=>({...b,index,at_ms:this.fractions[index]*duration}));
 }
 finishDuration(duration:number){
  if(this.durationFinal)return;
  this.duration=duration;this.durationFinal=true;
  // Fired events stay fired. Only future onsets move when the true length arrives.
  for(let i=this.cursor;i<this.events.length;i++)this.events[i].at_ms=Math.max(this.lastTime,this.fractions[i]*duration);
 }
 tick(dt:number,time:number,playing:boolean,active:boolean,directedEmotion?:string){
  const due:typeof this.events=[];
  if(playing&&this.plan){this.lastTime=time;while(this.cursor<this.events.length&&time>=this.events[this.cursor].at_ms){const b=this.events[this.cursor++];if(b.delivery)this.delivery=b.delivery;due.push(b);}}
  const delivery=directedEmotion?emotionDelivery[directedEmotion]??'calm':active&&this.plan?this.delivery:'neutral';
  const targets={...(profiles[delivery]??{})};
  if(active&&this.plan&&!directedEmotion){const [v,a,d]=this.plan.vad;
   targets.ParamMouthForm=(targets.ParamMouthForm??0)+v*.06;
   targets.BrowInnerUp=(targets.BrowInnerUp??0)+Math.max(0,-v)*.04;
   targets.ParamEyeBallY=(targets.ParamEyeBallY??0)+d*.025;
   targets.ParamBrowLY=(targets.ParamBrowLY??0)+Math.max(0,a)*.025;
   targets.ParamBrowRY=(targets.ParamBrowRY??0)+Math.max(0,a)*.025;
  }
  for(const key of new Set([...Object.keys(this.values),...Object.keys(targets)])){
   const target=targets[key]??0,old=this.values[key]??0;this.values[key]=old+(1-Math.exp(-dt/(active?.24:.7)))*(target-old);
  }
  const offsets:Record<string,number>={};
  for(const [id,value]of Object.entries(this.values)){const p=this.parameters.find(p=>p.id===id);if(p)offsets[id]=value*(value>=0?p.max-p.default:p.default-p.min);}
  const expressions={'黑脸':delivery==='restrained_anger'?.25:0,'脸红':delivery==='shy'?.5:0,'流泪':0,'加载':0,'兔牙':0,'流冷汗':0};
  return {offsets,due,expressions,emotion:deliveryEmotion[delivery]??'neutral'};
 }
 record(event:any){this.applied.push(event);this.applied=this.applied.slice(-64);}
 state(){return {plan:this.plan,alignment:'character_ratio',duration_ms:this.duration,duration_final:this.durationFinal,elapsed_ms:this.lastTime,events:this.events,processed:this.cursor,applied:this.applied};}
}
