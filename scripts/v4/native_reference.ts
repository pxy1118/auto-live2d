import {chromium} from 'playwright';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {decodeCurve,sampleCurve} from '../../src/motion';
const root=join(import.meta.dirname,'../..'),out=join(root,'test-results/v4-native-reference');mkdirSync(out,{recursive:true});
const executablePath=['C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe',process.env.BROWSER_EXECUTABLE].find(p=>p&&existsSync(p));
const browser=await chromium.launch({headless:true,executablePath}),page=await browser.newPage({viewport:{width:1100,height:900}});await page.addInitScript('window.__name = target => target;');
const poses=[
 {id:'rest',values:{}},
 {id:'native-raise',motion:'默认手切举手'},
 {id:'native-point',motion:'竖手指切出来动画'},
 {id:'r-upper-095',values:{Param36:.95}},
 {id:'r-elbow-085',values:{Param36:.15,Param39:.32,Param41:.85}},
 {id:'r-wave-045',values:{Param36:.45,Param39:.32,Param41:.85,Param42:.05}},
 {id:'r-wave-075',values:{Param36:.75,Param39:.32,Param41:.8,Param42:.05}},
 {id:'r-wave-neg',values:{Param36:.4,Param39:.3,Param41:-.85,Param42:.05}},
 {id:'both-raised-065',values:{Param36:.65,Param39:.25,Param41:.82,Param62:.65,Param59:.25,Param60:.82}},
 {id:'both-raised-095',values:{Param36:.95,Param39:.25,Param41:.8,Param62:.95,Param59:.25,Param60:.8}},
 {id:'both-raised-neg',values:{Param36:.8,Param39:.25,Param41:-.8,Param62:.8,Param59:.25,Param60:-.8}},
];
const results:any[]=[];
try{
 await page.goto(process.env.DEMO_URL??'http://127.0.0.1:8767');await page.waitForFunction(()=>(window as any).live2dDemo?.ready,{timeout:60000});
 await page.evaluate(()=>{const s=document.getElementById('stage')!;s.style.width='480px';s.style.height='720px';});
 for(const pose of poses){
  const result=await page.evaluate(async pose=>{
   const e=(window as any).live2dDemo.engine,cmd=async(method:string,params:any={})=>(await e.command({method,params})).result;
   await cmd('engine.reset');await cmd('engine.pause',{paused:true});
   if(pose.motion)await cmd('motions.play',{name:pose.motion,loop:false,hold:true});
   else if(pose.values&&Object.keys(pose.values).length)await cmd('parameters.set',{values:pose.values});
   await cmd('engine.step',{frames:120});
   const m=e._model,parents=m.getPartParentPartIndices(),handParts=['Part131','Part130','Part52'];
   const meshes:any[]=[];
   for(let i=0;i<m.getDrawableCount();i++){
    let part=m.getDrawableParentPartIndex(i),selected=false;
    for(let j=0;j<20&&part>=0;j++){if(handParts.includes(e.partIds[part])){selected=true;break;}part=parents[part];}
    if(!selected||m.getDrawableOpacity(i)<.05)continue;
    const points=Array.from(m.getDrawableVertexPositions(i)) as number[],xs=points.filter((_,i)=>i%2===0),ys=points.filter((_,i)=>i%2===1);
    meshes.push({id:m.getDrawableId(i).getString().s,part:e.partIds[part],x:xs.reduce((s,x)=>s+x,0)/xs.length,y:ys.reduce((s,x)=>s+x,0)/ys.length,minY:Math.min(...ys),maxY:Math.max(...ys)});
   }
   return {state:await cmd('state.get'),hand_meshes:meshes};
  },pose);
  await page.locator('#stage').screenshot({path:join(out,pose.id+'.png')});
  results.push({pose,...result});console.log(JSON.stringify({pose:pose.id,hands:result.hand_meshes}));
 }
 writeFileSync(join(out,'poses.json'),JSON.stringify(results,null,2));
 const refs:any={};
 for(const name of ['默认手切举手','举手切默认手','竖手指切出来动画','竖手指切回默认','狗尾草切换出来','脱捕']){
  const path=join(root,'live2d/DeepSeek/DeepSeek/Animation',name+'.motion3.json'),d=JSON.parse(readFileSync(path,'utf8').replace(/^\uFEFF/,''));
  const curves=d.Curves.filter((c:any)=>c.Target==='Parameter').map(decodeCurve);
  refs[name]={duration_ms:d.Meta.Duration*1000,hz:60,channels:curves.map(c=>c.id),values:Array.from({length:Math.ceil(d.Meta.Duration*60)+1},(_,i)=>curves.map(c=>sampleCurve(c,Math.min(d.Meta.Duration,i/60))))};
 }
 writeFileSync(join(out,'native-curves.json'),JSON.stringify(refs));
}finally{await browser.close();}
