import raw from '../contracts/action-catalog.json';
import bindings from '../contracts/emotion-bindings.json';
import {EMOTION_LABELS} from './emotion-config';
import {gestureNames,type GestureName} from './gesture-library';
import {bodyMotionNames,type BodyMotionName} from './body-motion';

export type CatalogPhase={at_ms:number;gesture?:GestureName;gesture_variant?:number;gesture_hold_ms?:number;gesture_strength?:number;body_motion?:BodyMotionName;body_variant?:number;body_strength?:number;body_hold_ms?:number};
export type CatalogAction={id:string;kind:'none'|'gesture'|'body'|'segment';label:string;emotion:string|null;variants:number;default_hold_ms:number;cooldown_group:'arm'|'body';intensity:[number,number];phases:CatalogPhase[]};
export type ActionCatalog={schema:'action.catalog.v1';actions:CatalogAction[]};
const number=(v:any,lo:number,hi:number)=>typeof v==='number'&&Number.isFinite(v)&&v>=lo&&v<=hi;
export function validateCatalog(value:any):ActionCatalog{
 const fail=():never=>{throw Error('动作目录不合法');};
 if(value?.schema!=='action.catalog.v1'||!Array.isArray(value.actions)||!value.actions.length)fail();
 const ids=new Set<string>();
 for(const a of value.actions){
  if(!a||typeof a.id!=='string'||!a.id||ids.has(a.id)||!['none','gesture','body','segment'].includes(a.kind)||!['arm','body'].includes(a.cooldown_group)||typeof a.label!=='string')fail();ids.add(a.id);
  if(!Number.isInteger(a.variants)||!number(a.variants,1,3)||!number(a.default_hold_ms,0,8000)||!Array.isArray(a.intensity)||a.intensity.length!==2||!a.intensity.every(v=>number(v,0,1))||a.intensity[0]>a.intensity[1]||!Array.isArray(a.phases))fail();
  if(a.kind==='none'&&a.id!=='none'||a.kind==='gesture'&&!gestureNames.includes(a.id)||a.kind==='body'&&!bodyMotionNames.includes(a.id))fail();
  if(a.kind==='segment'&&(!EMOTION_LABELS.includes(a.emotion)||a.emotion==='neutral'||!a.phases.length))fail();
  for(const p of a.phases){
   if(!number(p.at_ms,0,a.default_hold_ms+800)||!!p.gesture===!!p.body_motion)fail();
   if(p.gesture&&!gestureNames.includes(p.gesture)||p.body_motion&&!bodyMotionNames.includes(p.body_motion))fail();
   for(const key of ['gesture_variant','body_variant'])if(p[key]!==undefined&&(!Number.isInteger(p[key])||!number(p[key],0,2)))fail();
   for(const key of ['gesture_hold_ms','body_hold_ms'])if(p[key]!==undefined&&!number(p[key],0,6000))fail();
   for(const key of ['gesture_strength','body_strength'])if(p[key]!==undefined&&!number(p[key],0,1))fail();
  }
 }
 if(!ids.has('none'))fail();return value;
}
export class ActionRegistry{
 readonly actions=new Map<string,CatalogAction>();
 constructor(catalog:ActionCatalog){for(const action of validateCatalog(catalog).actions)this.actions.set(action.id,structuredClone(action));}
 register(action:CatalogAction){if(this.actions.has(action.id))throw Error('动作 ID 已注册');validateCatalog({schema:'action.catalog.v1',actions:[...this.actions.values(),action]});this.actions.set(action.id,structuredClone(action));}
 get(id:string){return this.actions.get(id);}
 capabilities(){return [...this.actions.values()].map(a=>({...structuredClone(a),model_selectable:MODEL_ACTION_IDS.includes(a.id)}));}
}
export const ACTION_CATALOG=validateCatalog(raw);
export const MODEL_ACTION_IDS=Object.freeze(ACTION_CATALOG.actions.filter(a=>a.kind!=='segment').map(a=>a.id));
export const ACTION_REGISTRY=new ActionRegistry(ACTION_CATALOG);
export const ACTION_BY_ID=ACTION_REGISTRY.actions;
export const actionById=(id:string)=>ACTION_REGISTRY.get(id);
export const catalogCapabilities=()=>({schema:ACTION_CATALOG.schema,actions:ACTION_REGISTRY.capabilities(),model_action_ids:MODEL_ACTION_IDS});
export const isBodyActionId=(id:string)=>actionById(id)?.kind==='body';

export type EmotionBinding={expression_profile:string|null;action_ids:string[];title?:string;description?:string;body?:{id:string;variant:number;strength:number;hold_ms:number}|null;wink?:'left'|'right'|null};
export class EmotionBindings{
 private values=new Map<string,EmotionBinding>();
 constructor(private registry:ActionRegistry=ACTION_REGISTRY){for(const label of EMOTION_LABELS)this.bind(label,bindings.bindings[label]);}
 bind(label:string,binding:EmotionBinding){
  if(!binding||!EMOTION_LABELS.includes(label)||binding.expression_profile!==null&&!EMOTION_LABELS.includes(binding.expression_profile)||!Array.isArray(binding.action_ids)||binding.action_ids.some(id=>!this.registry.get(id)))throw Error('情绪资源绑定不合法');
  const body=binding.body;
  if(body&&(this.registry.get(body.id)?.kind!=='body'||!binding.action_ids.includes(body.id)||!Number.isInteger(body.variant)||!number(body.variant,0,2)||!number(body.strength,0,1)||!number(body.hold_ms,0,6000)))throw Error('情绪身体表现不合法');
  if(binding.wink!==undefined&&binding.wink!==null&&!['left','right'].includes(binding.wink))throw Error('情绪 wink 不合法');
  this.values.set(label,structuredClone(binding));
 }
 get(label:string){const value=this.values.get(label);return value?structuredClone(value):null;}
}
export const EMOTION_BINDINGS=new EmotionBindings();
