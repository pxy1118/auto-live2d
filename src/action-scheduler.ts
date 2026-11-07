import {ACTION_REGISTRY,type ActionRegistry,type CatalogAction,type CatalogPhase} from './action-catalog';
import type {PerformancePlan} from './performance-plan';
import type {MotionHistory} from './motion-history';
import type {GestureName} from './gesture-library';
import type {BodyMotionName} from './body-motion';
export type SchedulerClock={actionMs:number;playing:boolean;directorBusy?:boolean};
export type ActionRequest={id:string;event_id:string;source:'model'|'director';cue_id?:string;variant:number;strength:number;hold_ms:number};
type PoseState={active:boolean;phase?:string};
export type SchedulerCallbacks={requestGesture:(request:{name:GestureName;variant:number;holdMs:number;strength:number;id:string;source:'model'|'director';cueId?:string})=>boolean;requestBody:(request:{name:BodyMotionName;variant:number;strength:number;holdMs:number;id:string;source:'model'|'director';cueId?:string})=>boolean;release:(cueId?:string)=>void;pose:()=>PoseState;gaps:()=>{arm:number;body:number}};

/** All action admission belongs here; samplers never make competing decisions. */
export class ActionScheduler{
 private last:({request:ActionRequest;at:number})|null=null;private pending:ActionRequest|null=null;
 private seen=new Set<string>();private recent:{id:string;kind:string;at:number}[]=[];
 private lastGroup={arm:-Infinity,body:-Infinity};private segment:{request:ActionRequest;action:CatalogAction;at:number;index:number;releasing:boolean}|null=null;
 constructor(private callbacks:SchedulerCallbacks,private options:{sameActionWindowMs?:number;registry?:ActionRegistry}={}){}
 private get registry(){return this.options.registry??ACTION_REGISTRY;}
 clear(){this.last=null;this.pending=null;this.seen.clear();this.recent=[];this.lastGroup={arm:-Infinity,body:-Infinity};this.segment=null;}
 discardPendingModel(){if(this.pending?.source==='model')this.pending=null;}
 release(_clock?:SchedulerClock,cueId?:string){
  if(!cueId||this.pending?.cue_id===cueId)this.pending=null;
  if(!cueId||this.segment?.request.cue_id===cueId)this.segment=null;
  if(!cueId||this.last?.request.cue_id===cueId)this.callbacks.release(cueId);
 }
 requestPlan(plan:PerformancePlan,clock:SchedulerClock){return this.request({id:plan.action.id,event_id:`model:${plan.clause}`,source:'model',variant:plan.action.variant,strength:plan.action.strength,hold_ms:plan.action.hold_ms},clock);}
 request(request:ActionRequest,clock:SchedulerClock):{committed:boolean;reason?:string}{
  const action=this.registry.get(request.id);if(!action)return {committed:false,reason:'unknown'};
  if(this.seen.has(request.event_id))return {committed:false,reason:'duplicate'};
  if(action.kind==='none'){this.seen.add(request.event_id);if(request.source==='director')this.release(clock);return {committed:true};}
  if(request.source==='model'){
   if(clock.directorBusy||this.pending?.source==='director')return {committed:false,reason:'director'};
   const gap=this.callbacks.gaps()[action.cooldown_group];if(clock.actionMs-this.lastGroup[action.cooldown_group]<gap)return {committed:false,reason:'cooldown'};
   if(this.recent.some(row=>row.id===request.id&&clock.actionMs-row.at<(action.repeat_window_ms??this.options.sameActionWindowMs??0)))return {committed:false,reason:'repeat'};
  }
  this.seen.add(request.event_id);if(this.seen.size>512)this.seen.delete(this.seen.values().next().value!);
  if(this.callbacks.pose().active||this.segment){
   this.segment=null;this.callbacks.release();this.pending=request;return {committed:true,reason:'transition'};
  }
  if(request.source==='director')this.pending=null;
  return {committed:this.begin(request,action,clock)};
 }
 private begin(request:ActionRequest,action:CatalogAction,clock:SchedulerClock){
  let accepted=false;
  const common={variant:request.variant,holdMs:request.hold_ms,strength:Math.max(action.intensity[0],Math.min(action.intensity[1],request.strength)),id:request.event_id,source:request.source,cueId:request.cue_id};
  if(action.kind==='gesture')accepted=this.callbacks.requestGesture({...common,name:action.id as GestureName});
  if(action.kind==='body')accepted=this.callbacks.requestBody({...common,name:action.id as BodyMotionName});
  if(action.kind==='segment'){this.segment={request,action,at:clock.actionMs,index:0,releasing:false};accepted=true;}
  if(accepted){this.last={request,at:clock.actionMs};this.lastGroup[action.cooldown_group]=clock.actionMs;this.recent.push({id:action.id,kind:action.kind,at:clock.actionMs});this.recent=this.recent.slice(-32);}
  return accepted;
 }
 tick(clock:SchedulerClock){
  if(!clock.playing)return;
  if(this.pending&&!this.callbacks.pose().active&&!(this.pending.source==='model'&&clock.directorBusy)){const next=this.pending;this.pending=null;this.begin(next,this.registry.get(next.id)!,clock);}
  const s=this.segment;if(!s)return;const phase=s.action.phases[s.index];
  if(!phase){if(!this.callbacks.pose().active)this.segment=null;return;}
  if(clock.actionMs-s.at<phase.at_ms)return;
  if(this.callbacks.pose().active){if(!s.releasing){this.callbacks.release();s.releasing=true;}return;}
  this.phase(s.request,phase,s.index);s.index++;s.releasing=false;
 }
 private phase(request:ActionRequest,phase:CatalogPhase,index:number){
  const common={id:`${request.event_id}:phase:${index}`,source:request.source,cueId:request.cue_id};
  if(phase.gesture)this.callbacks.requestGesture({...common,name:phase.gesture,variant:phase.gesture_variant??0,holdMs:phase.gesture_hold_ms??1000,strength:request.strength*(phase.gesture_strength??1)});
  else if(phase.body_motion)this.callbacks.requestBody({...common,name:phase.body_motion,variant:phase.body_variant??0,holdMs:phase.body_hold_ms??1000,strength:request.strength*(phase.body_strength??1)});
 }
 history(clock:number):MotionHistory{
  const pose=this.callbacks.pose();const phase=pose.active?(pose.phase==='blend'?'exit':pose.phase??'hold'):'idle';
  return {last_action:this.last?.request.id??'none',last_variant:this.last?.request.variant??null,age_ms:this.last?Math.max(0,clock-this.last.at):10000,phase:phase as MotionHistory['phase']};
 }
 state(){return {active_segment:this.segment?.action.id??null,pending:this.pending?.id??null,recent:this.recent.map(row=>({...row}))};}
}
