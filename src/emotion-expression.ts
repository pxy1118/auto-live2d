import {OVERLAY_ATTACK_S,OVERLAY_RELEASE_S} from './emotion-config';
import {EMOTION_PROFILES,FACE_CHANNELS,OVERLAY_NAMES,EYE_TYPES,type FaceChannel,type OverlayName,type EyeType} from './emotion-profiles';
import {EMOTION_BINDINGS,type EyeAccent} from './action-catalog';

export const DEFORMATION_EXPRESSIONS=['squint','wink_left','wink_right','double_blink'] as const;
export type EyeDisplay='normal'|EyeType;
export type BlendedExpression={face:Record<FaceChannel,number>;overlay:Record<OverlayName,number>};
export type ExpressionResult=BlendedExpression&{eye:EyeDisplay;accent:null|{side:'left'|'right'|'both';kind:EyeAccent;elapsed_ms:number;closure:number}};
export type ActionEyeAccent={key:string;name:EyeAccent;elapsed_ms:number};
type Director={label:string;intensity:number;serial?:number};
type Expression={name:string;intensity:number;serial?:number};
const clamp=(x:number,lo=0,hi=1)=>Math.max(lo,Math.min(hi,Number.isFinite(x)?x:0));
const ease=(x:number)=>{x=clamp(x);return x*x*x*(10+x*(-15+6*x));};
const zeroFace=()=>Object.fromEntries(FACE_CHANNELS.map(channel=>[channel,0])) as Record<FaceChannel,number>;
const zeroOverlay=()=>Object.fromEntries(OVERLAY_NAMES.map(name=>[name,0])) as Record<OverlayName,number>;

/** No sum normalization: the already smoothed 28-dimensional evidence drives
 * additive deformation. Clamp only at the facial/rig boundaries. */
export function blendExpression(effective:Record<string,number>):BlendedExpression{
 const face=zeroFace(),overlay=zeroOverlay();
 for(const label of Object.keys(EMOTION_PROFILES)){
  const evidence=effective?.[label]??0;if(!(evidence>0))continue;
  const resource=EMOTION_BINDINGS.get(label)?.expression_profile,profile=resource?EMOTION_PROFILES[resource]:null;
  if(!profile)continue;
  for(const id of FACE_CHANNELS)face[id]+=evidence*(profile.face[id]??0);
  for(const name of OVERLAY_NAMES)overlay[name]+=evidence*(profile.overlay[name]??0);
 }
 for(const id of FACE_CHANNELS)face[id]=clamp(face[id],-1,1);
 for(const name of OVERLAY_NAMES)overlay[name]=clamp(overlay[name]);
 return {face,overlay};
}

/** Sole owner of facial deformation and short eyelid accents. Every timer uses
 * the shared acting clock, so pause and audio buffering also freeze a wink. */
export class EmotionExpressionLayer{
 private face=zeroFace();private overlay=zeroOverlay();private visibleEye:EyeDisplay='normal';
 private manualKey='';private transition:{face:Record<FaceChannel,number>;overlay:Record<OverlayName,number>;elapsed:number;duration:number}|null=null;
 private actionKey='';
 private wink:{side:'left'|'right'|'both';kind:EyeAccent;at:number;intensity:number}|null=null;
 private accent:ExpressionResult['accent']=null;
 private gazeMs=0;private blackVisible=false;private blackDwellMs=0;

 update(effective:Record<string,number>,dt:number,actorMs:number,director?:Director|null,expression?:Expression|null,action?:ActionEyeAccent|null):ExpressionResult{
  const seconds=Number.isFinite(dt)&&dt>0?dt:0;if(!seconds)return this.state();
  const validDirector=director&&Object.hasOwn(EMOTION_PROFILES,director.label)?director:null;
  const evidence=validDirector?(validDirector.label==='neutral'?{}:{[validDirector.label]:clamp(validDirector.intensity)}):effective;
  const targets=blendExpression(evidence);
  const faceTarget={...targets.face},overlayTarget={...targets.overlay};
  // Brief eye shifts with a stable fixation between them. They are conditioned
  // on the native lanes, not on random per-frame noise or a wall-clock timer.
  this.gazeMs+=seconds*1000;
  const glance=(period:number)=>{const phase=this.gazeMs%period;return ease((phase-period*.35)/180)*(1-ease((phase-period*.78)/180));};
  faceTarget.ParamEyeBallX+=.24*clamp(evidence.remorse??0)*glance(3200)-.64*clamp(evidence.nervousness??0)*glance(2600);
  // These are drawing visibility gains, not modified classifier scores.
  for(const name of OVERLAY_NAMES)if(name!=='黑脸')overlayTarget[name]=clamp(overlayTarget[name]*1.7);
  const intensity=clamp(expression?.intensity??1);
  if(expression&&Object.hasOwn(overlayTarget,expression.name))overlayTarget[expression.name as OverlayName]=intensity;
  if(expression?.name==='squint'){
   faceTarget.ParamEyeLOpen=faceTarget.ParamEyeROpen=-.78*intensity;
   faceTarget.LEyeSquint=faceTarget.REyeSquint=.3*intensity;
   faceTarget.EyeSmile=Math.max(faceTarget.EyeSmile,.5*intensity);
  }
  const key=JSON.stringify([validDirector??null,expression??null]),automaticKey='[null,null]';
  if(key!==this.manualKey){
   if(key!==automaticKey||this.manualKey&&this.manualKey!==automaticKey)this.transition={face:{...this.face},overlay:{...this.overlay},elapsed:0,duration:key===automaticKey?OVERLAY_RELEASE_S:OVERLAY_ATTACK_S};
   this.manualKey=key;this.wink=null;
   if(expression&&['wink_left','wink_right','double_blink'].includes(expression.name))this.wink={side:expression.name==='double_blink'?'both':expression.name==='wink_left'?'left':'right',kind:expression.name as EyeAccent,at:actorMs,intensity};
  }
  // Eye accents follow an admitted action and variant, never the emotion label
  // alone. This prevents laughter/shyness from becoming an unsolicited wink.
  if(!expression&&action&&action.key!==this.actionKey&&action.elapsed_ms>=0){
   this.actionKey=action.key;
   if(action.elapsed_ms<620)this.wink={side:action.name==='double_blink'?'both':action.name==='wink_left'?'left':'right',kind:action.name,at:actorMs-action.elapsed_ms,intensity:1};
  }
  if(this.transition)this.transition.elapsed+=seconds;
  const x=this.transition?clamp(this.transition.elapsed/this.transition.duration):1,alpha=ease(x);
  for(const id of FACE_CHANNELS)this.face[id]=this.transition?this.transition.face[id]+alpha*(faceTarget[id]-this.transition.face[id]):faceTarget[id];
  for(const name of OVERLAY_NAMES)if(name!=='黑脸')this.overlay[name]=this.transition?this.transition.overlay[name]+alpha*(overlayTarget[name]-this.transition.overlay[name]):overlayTarget[name];
  // Black shading is an authored drawing switch. Hysteresis and dwell avoid
  // flicker; never leave its texture half transparent for an entire sentence.
  if(expression?.name==='黑脸'){this.blackVisible=intensity>0;this.blackDwellMs=0;}
  else{
   const change=this.blackVisible?overlayTarget['黑脸']<=.09:overlayTarget['黑脸']>=.2;
   this.blackDwellMs=change?this.blackDwellMs+seconds*1000:0;
   if(this.blackDwellMs>=(this.blackVisible?300:120)){this.blackVisible=!this.blackVisible;this.blackDwellMs=0;}
  }
  this.overlay['黑脸']=Number(this.blackVisible);
  if(x===1)this.transition=null;
  this.visibleEye=expression&&(expression.name==='normal'||EYE_TYPES.includes(expression.name as EyeType))?expression.name as EyeDisplay:'normal';
  this.accent=null;
  if(this.wink){
   const elapsed=Math.max(0,actorMs-this.wink.at),double=this.wink.kind==='double_blink',duration=double?500:620;
   if(elapsed>=duration)this.wink=null;
   else{
    const blink=(t:number)=>t<0||t>=220?0:t<70?ease(t/70):t<110?1:1-ease((t-110)/110);
    const closure=this.wink.intensity*(double?Math.max(blink(elapsed),blink(elapsed-280)):elapsed<120?ease(elapsed/120):elapsed<300?1:1-ease((elapsed-300)/320));
    for(const lid of this.wink.side==='both'?['ParamEyeLOpen','ParamEyeROpen']:this.wink.side==='left'?['ParamEyeLOpen']:['ParamEyeROpen'])this.face[lid]+=(-1-this.face[lid])*closure;
    this.visibleEye='normal';this.accent={side:this.wink.side,kind:this.wink.kind,elapsed_ms:elapsed,closure};
   }
  }
  return this.state();
 }
 reset(){this.face=zeroFace();this.overlay=zeroOverlay();this.visibleEye='normal';this.manualKey='';this.transition=null;this.actionKey='';this.wink=null;this.accent=null;this.gazeMs=0;this.blackVisible=false;this.blackDwellMs=0;}
 state():ExpressionResult{return {face:{...this.face},overlay:{...this.overlay},eye:this.visibleEye,accent:this.accent?{...this.accent}:null};}
}
