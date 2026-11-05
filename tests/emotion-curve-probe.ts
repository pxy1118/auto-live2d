/** Reproducible controller diagnostics, not an emotion-recognition benchmark. */
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {EmotionCurve,affectEmotions,validateEmotionTimeline,type EmotionWeights} from '../src/emotion-curve';
import {PERFORMANCE_RUNTIME_VERSION} from '../src/performance-profile';

const parts:[string,number,Partial<EmotionWeights>][]=[
 ['sustained happy',5000,{happy:.7}],['neutral bridge',500,{}],['continued happy',3500,{happy:.7}],
 ['brief conflicting observation',200,{angry:.2}],['continued happy',3800,{happy:.7}],
 ['sustained real reversal',4500,{angry:.8}],['reassurance',4500,{happy:.65,shy:.1}],
];
const duration=parts.reduce((sum,p)=>sum+p[1],0),text='段'.repeat(duration/100);let offset=0;
const points=parts.map(([,ms,values])=>{
 const start=offset;offset+=ms/100;
 return {text:text.slice(start,offset),start,end:offset,start_fraction:start/text.length,weights:Object.fromEntries(affectEmotions.map(name=>[name,values[name]??0])),tension:0,probabilities:{}};
});
const curve=new EmotionCurve();curve.bind(validateEmotionTimeline({schema:'emotion.timeline.v1',points},text),'probe',duration);
const trace:any[]=[];let previous=curve.state(),maxFrameChange=0,switches=0;const labels=['neutral'];
for(let frame=1;frame<=duration*60/1000;frame++){
 const time=frame*1000/60;curve.tick(1/60,{speech_id:'probe',phase:'playing',audio_time_ms:time},true);const state=curve.state();
 for(const name of affectEmotions)maxFrameChange=Math.max(maxFrameChange,Math.abs(state.weights[name]-previous.weights[name]));
 if(state.emotion!==previous.emotion){switches++;labels.push(state.emotion);}
 if(frame%3===0)trace.push({media_ms:time,affect:state});previous=state;
}
const reversalAt=parts.slice(0,5).reduce((sum,p)=>sum+p[1],0),reversal=trace.find(row=>row.media_ms>=reversalAt&&row.affect.emotion==='angry');
const result={runtime:PERFORMANCE_RUNTIME_VERSION,kind:'authored-control-signals',not_classifier_accuracy:true,not_old_runtime_ab_test:true,duration_ms:duration,parts:parts.map(([name,duration_ms,weights])=>({name,duration_ms,weights})),
 metrics:{dominant_switches_including_initial:switches,labels,maximum_weight_change_per_60hz_frame:maxFrameChange,reversal_label_response_ms:reversal?reversal.media_ms-reversalAt:null},trace};
const out=join(import.meta.dirname,'..','test-results/emotion-curves-v1');mkdirSync(out,{recursive:true});writeFileSync(join(out,'curve-probe.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result.metrics,null,2));
