import {ControlError} from './controller';
import {actionById} from './action-catalog';
export const PLAN_SCHEMA='performance.plan.v4';
export type PlanAction={id:string;variant:number;strength:number;hold_ms:number;onset_fraction:number};
export type PerformancePlan={schema:typeof PLAN_SCHEMA;clause:number;action:PlanAction;confidence:{action:number}};
export function validatePlan(value:any,clause:number):PerformancePlan{
 const fail=():never=>{throw new ControlError('invalid_performance','动作计划不合法');};
 const number=(v:any,lo:number,hi:number)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<lo||v>hi)fail();};
 if(!Number.isInteger(clause)||clause<0||!value||value.schema!==PLAN_SCHEMA||value.clause!==clause||Object.keys(value).some(k=>!['schema','clause','action','confidence'].includes(k)))fail();
 const a=value.action,entry=actionById(a?.id);if(!a||!entry||Object.keys(a).some(k=>!['id','variant','strength','hold_ms','onset_fraction'].includes(k)))fail();
 number(a.variant,0,entry.variants-1);if(!Number.isInteger(a.variant))fail();number(a.strength,0,1);number(a.hold_ms,0,6000);number(a.onset_fraction,0,.95);
 if(!value.confidence||Object.keys(value.confidence).some(k=>k!=='action'))fail();number(value.confidence.action,0,1);
 return {...value,action:{...a},confidence:{...value.confidence}};
}
