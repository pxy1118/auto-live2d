/** Research-only, independently implemented mapping. Production never imports this. */
import {ease} from '../../src/body-motion';

export type VtsSetting={Input:string;OutputLive2D:string;InputRangeLower:number;InputRangeUpper:number;
 OutputRangeLower:number;OutputRangeUpper:number;Smoothing:number;ClampInput:boolean;ClampOutput:boolean};
export const mappedOutputs=['AngleX','AngleY','AngleZ','PositionX','PositionY','PositionZ','ParamEyeBallX','ParamEyeBallY'];
export const conditions=['current','mapped','mapped_micro'] as const;
export type Condition=typeof conditions[number];
const clip=(x:number,a:number,b:number)=>Math.max(a,Math.min(b,x));

export class AssetInputMapper{
 readonly rows:VtsSetting[];private values=new Map<string,number>();
 constructor(settings:VtsSetting[]){
  this.rows=settings.filter(s=>mappedOutputs.includes(s.OutputLive2D));
  if(this.rows.length!==8||new Set(this.rows.map(s=>s.OutputLive2D)).size!==8)throw Error('Expected eight unique head/gaze mappings');
  for(const s of this.rows){
   if(![s.InputRangeLower,s.InputRangeUpper,s.OutputRangeLower,s.OutputRangeUpper,s.Smoothing].every(Number.isFinite)||
      s.InputRangeLower===s.InputRangeUpper||s.OutputRangeLower===s.OutputRangeUpper||s.Smoothing<0)throw Error('Invalid mapping ranges');
   this.values.set(s.OutputLive2D,this.transform(s,0));
  }
 }
 private transform(s:VtsSetting,input:number){
  let u=(input-s.InputRangeLower)/(s.InputRangeUpper-s.InputRangeLower);
  if(s.ClampInput)u=clip(u,0,1);
  let value=s.OutputRangeLower+u*(s.OutputRangeUpper-s.OutputRangeLower);
  if(s.ClampOutput)value=clip(value,Math.min(s.OutputRangeLower,s.OutputRangeUpper),Math.max(s.OutputRangeLower,s.OutputRangeUpper));
  return value;
 }
 inverse(output:string,value:number){
  const s=this.rows.find(s=>s.OutputLive2D===output);if(!s||!Number.isFinite(value))throw Error('Invalid inverse mapping');
  return s.InputRangeLower+(value-s.OutputRangeLower)/(s.OutputRangeUpper-s.OutputRangeLower)*(s.InputRangeUpper-s.InputRangeLower);
 }
 step(inputs:Record<string,number>,dt:number){
  if(!Number.isFinite(dt)||dt<0||dt>.1)throw Error('Invalid sample interval');
  const result:Record<string,number>={};
  for(const s of this.rows){
   const input=inputs[s.Input];if(!Number.isFinite(input))throw Error(`Missing input ${s.Input}`);
   const target=this.transform(s,input),tau=s.Smoothing*.005;
   const old=this.values.get(s.OutputLive2D)!;
   const value=tau===0?target:old+(target-old)*(-Math.expm1(-dt/tau));
   this.values.set(s.OutputLive2D,value);result[s.OutputLive2D]=value;
  }
  return result;
 }
}

/** C2 finite envelope with explicit enter/hold/leave, no clipped sinusoid. */
export function bump(age:number,rise:number,hold:number,fall:number){
 if(age<=0||age>=rise+hold+fall)return 0;
 return age<rise?ease(age/rise):age<rise+hold?1:1-ease((age-rise-hold)/fall);
}

export function microAt(scene:any,now:number){
 const v={gazeX:0,gazeY:0,headX:0,headY:0,brows:0,smile:0,lid:1};
 if(scene.id==='neutral')return v;
 for(const cue of scene.cues){
  const age=now-cue.at_ms;
  if(scene.id==='welcome'){
   if(cue.index===0){v.brows+=.16*bump(age-300,160,150,300);v.smile+=.22*bump(age-200,350,1400,600);}
   else {v.lid-=.55*bump(age-500,100,30,170);v.smile+=.18*bump(age-200,350,1200,600);}
  }else if(scene.id==='shy'){
   if(cue.index===0){const gaze=bump(age-450,260,700,480);v.gazeX+=.23*gaze;v.gazeY-=.1*gaze;
    v.headX+=.6*bump(age-600,300,500,550);v.brows+=.1*bump(age-550,300,700,450);v.lid-=.7*bump(age-1300,160,60,240);}
   v.smile+=.2*bump(age-250,450,1300,650);
  }else if(scene.id==='cajole'){
   v.lid-=(cue.index===0?.85:.55)*bump(age-650,170,60,250);
   v.smile+=.25*bump(age-250,400,1000,600);
   if(cue.index===0){v.gazeX+=.12*bump(age-350,250,600,500);v.headX+=.35*bump(age-500,350,500,600);}
  }
 }
 v.lid=clip(v.lid,0,1);return v;
}

const extra=['ParamEyeLOpen','ParamEyeROpen','ParamMouthForm','ParamBrowLY','ParamBrowRY','BrowInnerUp'];

export function generateMappedInputs(settings:VtsSetting[],baseline:any,scene:any,condition:Condition,defaults:Record<string,number>={}){
 const mapper=new AssetInputMapper(settings),old=baseline.params,channels=[...new Set([...old.channels,...mappedOutputs,...extra])];
 const values:number[][]=[],trace:any[]=[],computes:number[]=[];
 for(let f=0;f<old.values.length;f++){
  const started=performance.now(),now=f/60*1000;
  const row:Record<string,number>=Object.fromEntries(channels.map(k=>[k,defaults[k]??(k==='ParamEyeLOpen'||k==='ParamEyeROpen'?1:0)]));
  old.channels.forEach((k:string,j:number)=>row[k]=old.values[f][j]);
  const micro=condition==='mapped_micro'?microAt(scene,now):{gazeX:0,gazeY:0,headX:0,headY:0,brows:0,smile:0,lid:1};
  const virtual={FaceAngleX:mapper.inverse('AngleX',row.AngleX)+micro.headX,
   FaceAngleY:mapper.inverse('AngleY',row.AngleY)+micro.headY,FaceAngleZ:mapper.inverse('AngleZ',row.AngleZ),
   EyeRightX:mapper.inverse('ParamEyeBallX',row.ParamEyeBallX+micro.gazeX),
   EyeRightY:mapper.inverse('ParamEyeBallY',row.ParamEyeBallY+micro.gazeY)};
  if(condition!=='current')Object.assign(row,mapper.step(virtual,f===0?0:1/60));
  row.ParamEyeLOpen*=micro.lid;row.ParamEyeROpen*=micro.lid;
  row.ParamBrowLY+=micro.brows;row.ParamBrowRY+=micro.brows;row.BrowInnerUp+=micro.brows*.4;row.ParamMouthForm+=micro.smile;
  values.push(channels.map(k=>row[k]));computes.push(performance.now()-started);trace.push({at_ms:now,virtual,micro});
 }
 return {condition,frames:values.length,params:{...old,channels,values,image_hz:60,full_update:true,verify_hands:true},trace,computes};
}
