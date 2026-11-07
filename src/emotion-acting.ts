import {EMOTION_LABELS} from './emotion-config';

/** Discrete accents need a clear leader. Continuous faces still blend all 28
 * dimensions, including ambiguous and mixed emotions. */
export function actingEmotion(values:Record<string,number>){
 const ranked=EMOTION_LABELS.map(label=>({label,score:values[label]??0})).sort((a,b)=>b.score-a.score);
 const [first,second]=ranked;
 return first.label!=='neutral'&&first.score>=.4&&first.score-second.score>=.08?first:null;
}
