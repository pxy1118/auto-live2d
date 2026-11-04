import {ControlError} from './controller';
import {gestureNames} from './gesture-library';
import {bodyMotionNames} from './body-motion';
import {emotions,eyeNames} from './performance-profile';
export const PLAN_SCHEMA='performance.plan.v1';
export const planFaceNames=['黑脸','流泪','脸红','加载','兔牙','流冷汗'];
export type PerformancePlan={schema:typeof PLAN_SCHEMA;clause:number;arm:string;body:string;emotion:string;eye:string;arm_variant:number;body_variant:number;body_strength:number;expressions:Record<string,number>;eye_strength:number;arm_hold_ms:number;body_hold_ms:number;face_hold_ms:number;onset_ms:number;confidence:Record<string,number>};
export function validatePlan(value:any,clause:number):PerformancePlan{
 const fail=():never=>{throw new ControlError('invalid_performance','组合表演计划不合法');};
 if(!value||typeof value!=='object'||Array.isArray(value)||value.schema!==PLAN_SCHEMA||value.clause!==clause)fail();
 const allowed=['schema','clause','arm','body','emotion','eye','arm_variant','body_variant','body_strength','expressions','eye_strength','arm_hold_ms','body_hold_ms','face_hold_ms','onset_ms','confidence'];
 if(Object.keys(value).some(k=>!allowed.includes(k)))fail();
 if(value.arm!=='none'&&!(gestureNames as readonly string[]).includes(value.arm)||value.body!=='none'&&!(bodyMotionNames as readonly string[]).includes(value.body)||value.emotion!=='keep'&&!emotions.includes(value.emotion)||!eyeNames.includes(value.eye))fail();
 const number=(v:any,lo:number,hi:number)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<lo||v>hi)fail();};
 for(const k of ['arm_variant','body_variant']){number(value[k],0,2);if(!Number.isInteger(value[k]))fail();}
 for(const k of ['body_strength','eye_strength'])number(value[k],0,1);
 for(const [k,lo,hi] of [['arm_hold_ms',0,3000],['body_hold_ms',0,4000],['face_hold_ms',0,8000],['onset_ms',0,1000]] as const)number(value[k],lo,hi);
 if(!value.expressions||typeof value.expressions!=='object'||Array.isArray(value.expressions)||Object.keys(value.expressions).some(k=>!planFaceNames.includes(k)))fail();
 for(const n of planFaceNames)number(value.expressions[n],0,1);
 if(!value.confidence||typeof value.confidence!=='object'||Array.isArray(value.confidence))fail();for(const n of ['arm','body','emotion','eye'])number(value.confidence[n],0,1);
 return {...value,expressions:{...value.expressions},confidence:{...value.confidence}};
}
