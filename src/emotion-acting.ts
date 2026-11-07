import {EMOTION_LABELS} from './emotion-config';
import {EMOTION_BINDINGS,isBodyActionId} from './action-catalog';
import type {PerformancePlan} from './performance-plan';

/** Discrete accents need a clear leader. Continuous faces still blend all 28
 * dimensions, including ambiguous and mixed emotions. */
export function actingEmotion(values:Record<string,number>){
 const ranked=EMOTION_LABELS.map(label=>({label,score:values[label]??0})).sort((a,b)=>b.score-a.score);
 const [first,second]=ranked;
 return first.label!=='neutral'&&first.score>=.4&&first.score-second.score>=.08?first:null;
}

/** The trained head owns timing and semantic hand gestures. Only a selected
 * body beat is interpreted through the character's current emotional style.
 * A `none` decision stays silent; this is not a second action planner. */
export function styleBodyPlan(plan:PerformancePlan,values:Record<string,number>):PerformancePlan{
 if(!isBodyActionId(plan.action.id))return plan;
 const emotion=actingEmotion(values),body=emotion?EMOTION_BINDINGS.get(emotion.label)?.body:null;
 if(!body)return plan;
 return {...plan,action:{...plan.action,...body,strength:body.strength*Math.max(.65,plan.action.strength)}};
}
