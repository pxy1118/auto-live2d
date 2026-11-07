import {styleBodyPlan,actingEmotion} from '../src/emotion-acting';
import {EMOTION_BINDINGS} from '../src/action-catalog';
import {EMOTION_LABELS,emotionCurvePolicy} from '../src/emotion-config';
import type {PerformancePlan} from '../src/performance-plan';
export const REVIEW_CANDIDATES=['A','B','C'] as const;
export type ReviewCandidate=typeof REVIEW_CANDIDATES[number];
export type ReviewPlayback={events:any[];duration:number;candidate:ReviewCandidate};
export function candidatePlan(plan:PerformancePlan,affect:number[],candidate:ReviewCandidate){
 const display=Object.fromEntries(EMOTION_LABELS.map((l,i)=>[l,emotionCurvePolicy.response_mix*affect[i]+(1-emotionCurvePolicy.response_mix)*affect[i+28]]));
 const styled=styleBodyPlan(plan,display),action={...styled.action};
 if(candidate==='B'&&action.id!=='none'){
  action.variant=(action.variant+1)%3;action.strength*=.7;action.onset_ms=Math.min(1000,action.onset_ms+120);
 }else if(candidate==='C'){
  if(action.id==='none'){
   const emotion=actingEmotion(display),body=emotion?EMOTION_BINDINGS.get(emotion.label)?.body:null;
   if(body)Object.assign(action,body,{onset_ms:350});
  }
  if(action.id!=='none'){action.variant=(action.variant+2)%3;action.strength=Math.min(1,Math.max(.8,action.strength*1.15));}
 }
 return {...styled,action};
}
