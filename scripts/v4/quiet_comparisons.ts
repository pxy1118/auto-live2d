import { mkdirSync,readFileSync,writeFileSync,copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { compilePreview } from './compile_preview';
const root=join(import.meta.dirname,'../..'),data=join(root,'datasets/vtuber-v4'),review=join(data,'review'),out=join(review,'comparisons-restrained');mkdirSync(out,{recursive:true});
const read=(p:string)=>JSON.parse(readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const originals=read(join(review,'comparison-pairs.json')),oldKey=read(join(root,'experiments/vtuber-v4/blind-key.json'));
const parameters=read(join(root,'test-results/runtime-capabilities.json')).parameters,profile=read(join(data,'profile.json'));
const pairs:any[]=[],key:any[]=[];
for(let i=0;i<24;i++){
 const item=originals[i],audio=read(join(data,item.clips[0].audio.replace('.wav','.json')));
 const candidate=await compilePreview(parameters,profile,{text:item.text,context:item.context},audio);
 const baseline=oldKey[i].models.find((m:any)=>m.model==='v3').label;
 const labels=i%2?['A','B']:['B','A'];
 writeFileSync(join(out,`${String(i).padStart(2,'0')}-${labels[0]}.json`),JSON.stringify(candidate.params));
 copyFileSync(join(review,'comparisons',`${String(i).padStart(2,'0')}-${baseline}.json`),join(out,`${String(i).padStart(2,'0')}-${labels[1]}.json`));
 pairs.push({text:item.text,context:item.context,clips:['A','B'].map(label=>({media:`comparisons-restrained/${String(i).padStart(2,'0')}-${label}.webp`,audio:item.clips[0].audio}))});
 key.push({index:i,models:[{label:labels[0],model:'v4-restrained-regression',provenance:candidate.provenance,gesture_policy:candidate.gesture_policy},{label:labels[1],model:'v3'}]});
 console.log(JSON.stringify({prepared:i+1,total:24,gestures:candidate.gesture_policy.count}));
}
writeFileSync(join(review,'comparison-pairs-restrained.json'),JSON.stringify(pairs));writeFileSync(join(root,'experiments/vtuber-v4-restrained/blind-key.json'),JSON.stringify(key,null,2));
