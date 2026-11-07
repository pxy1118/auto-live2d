import contract from '../contracts/motion-history.json';
export type MotionHistory={last_action:string;last_variant:number|null;age_ms:number;phase:'idle'|'enter'|'hold'|'exit'};
export const MOTION_HISTORY_DIM=contract.dim;
export function historyVector(value:MotionHistory){
 if(Object.keys(value??{}).some(k=>!['last_action','last_variant','age_ms','phase'].includes(k)))throw Error('动作历史字段不合法');
 if(!value||typeof value.last_action!=='string'||!contract.phases.includes(value.phase)||!Number.isFinite(value.age_ms)||value.age_ms<0||value.last_variant!==null&&(!Number.isInteger(value.last_variant)||value.last_variant<0||value.last_variant>2))throw Error('动作历史不合法');
 const id=contract.actions.includes(value.last_action)?value.last_action:'<untrained>';
 return [...contract.actions.map(name=>+(name===id)),...contract.variants.map(v=>+(v===value.last_variant)),Math.min(1,value.age_ms/contract.age_scale_ms),...contract.phases.map(phase=>+(phase===value.phase))];
}
