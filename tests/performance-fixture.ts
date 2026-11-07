import {readFileSync} from 'node:fs';
import {PerformanceController} from '../src/performance';
import {EMOTION_LABELS} from '../src/emotion-config';
import {streamChannels} from '../src/performance-profile';
export const id='a'.repeat(32),speechId='b'.repeat(32);
export const thresholds=JSON.parse(readFileSync(new URL('../models/multilingual-emotions-base/thresholds.json',import.meta.url),'utf8'));
export const parameters=streamChannels.map(id=>({id,label:id,group:'',min:-30,max:30,default:0,type:0,physicsInput:false,physicsOutput:false}));
export const base=()=>Object.fromEntries(parameters.map(p=>[p.id,p.default]));
export const motions=['默认手切举手','举手切默认手','狗尾草切换出来','狗尾草切回默认手','竖手指切出来动画','竖手指切回默认'].map(name=>({name,data:{Meta:{Duration:.5},Curves:[]}}));
export const plan=(clause=0,id='none',onset_fraction=0)=>({schema:'performance.plan.v4' as const,clause,action:{id,variant:0,strength:1,hold_ms:900,onset_fraction},confidence:{action:1}});
export function timeline(text:string,parts=[{text,label:'joy',value:.9}]){
 let offset=0;const length=Array.from(text).length;
 return {schema:'emotion.timeline.v2',labels:EMOTION_LABELS,thresholds,points:parts.map(p=>{const start=offset;offset+=Array.from(p.text).length;return {text:p.text,window_text:p.text,start,end:offset,start_fraction:start/length,probabilities:Object.fromEntries(EMOTION_LABELS.map(l=>[l,l===p.label?p.value:0]))};})};
}
export const audio=(time:number,phase='playing',speech_id=speechId)=>({speech_id,audio_time_ms:time,phase});
export function actor(label='joy'){
 const p=new PerformanceController(parameters,motions);p.start({session_id:id},base());
 const text='大家好，今天一起聊天。';p.utterance({session_id:id,speech_id:speechId,text,audio_duration_ms:10000,audio_duration_final:true,clauses:[{clause:0,text,start_fraction:0}],affect_timeline:timeline(text,[{text,label,value:.9}])});return p;
}
export function run(p:PerformanceController,from:number,to:number){let values:any;for(let t=from;t<=to;t+=20)values=p.tick(.02,audio(t),base());return values;}
