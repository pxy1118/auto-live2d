import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';import {join} from 'node:path';import {nativePreview} from './native_preview';
const root=join(import.meta.dirname,'../..'),data=join(root,'datasets/vtuber-v4-native'),media=process.env.MEDIA_DIR??'native-showcase',experiment=process.env.EXPERIMENT_ROOT??join(root,'experiments/vtuber-v4-native'),out=join(data,'review',media);mkdirSync(out,{recursive:true});
const read=(p:string)=>JSON.parse(readFileSync(p,'utf8').replace(/^\uFEFF/,'')),profile=read(join(data,'profile.json')),parameters=read(join(root,'test-results/runtime-capabilities.json')).parameters;
const groups=[['ordinary_calm','日常聊天'],['ordinary_shy','害羞时双手安静'],['wave','完整抬手打招呼'],['cheer','双臂高举庆祝'],['point','指出重点'],['chest','抚胸表达心意'],['explain','展开说明'],['refuse','抬手示意停一下']];
const pairs:any[]=[],evidence:any[]=[];
for(let i=0;i<groups.length;i++){
 const [family,title]=groups[i],ordinary=family.startsWith('ordinary'),clip=read(join(data,'clips',ordinary?(family==='ordinary_calm'?'s000-v2.json':'s003-v2.json'):`body-${family}-00-v3.json`)),audio=read(join(data,clip.audio.replace('.wav','.json')));
 if(ordinary)clip.context=family==='ordinary_calm'?'自然地和观众聊天，角色本人情绪平静。':'自然地和观众聊天，略感害羞。';
 const clips:any[]=[];
 for(const [j,kind] of (process.env.KINDS??'regression,flow,reference').split(',').entries()){
  const preview=await nativePreview(parameters,profile,clip,audio,kind==='reference'?'regression':kind,kind==='reference',!ordinary),id=String(i).padStart(2,'0')+'-'+String.fromCharCode(65+j);
  writeFileSync(join(out,id+'.json'),JSON.stringify(preview.params));evidence.push({family,kind,...preview,params:undefined});
  clips.push({label:kind==='reference'?'原生动作校准后的参考轨迹':kind==='flow'?'新版 Flow 实际生成':'新版回归专家实际生成',media:media+'/'+id+'.webp',video:media+'/'+id+'.mp4',audio:clip.audio});
  console.log(JSON.stringify({family,kind,ranges:preview.ranges}));
 }
 pairs.push({text:title+'：'+clip.text,context:ordinary?'自动说话，保留低频动作策略。':'一次完整手势：抬起、停留或挥动、自然回收。参考轨迹借鉴原生动画的关节配合，模型实时生成连续参数。',clips});
}
writeFileSync(join(data,'review',media+'-pairs.json'),JSON.stringify(pairs,null,2));writeFileSync(join(experiment,'body-evidence.json'),JSON.stringify(evidence,null,2));
