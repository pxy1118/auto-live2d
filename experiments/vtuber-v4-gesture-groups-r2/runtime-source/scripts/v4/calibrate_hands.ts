import {chromium} from 'playwright';import {existsSync,mkdirSync,writeFileSync} from 'node:fs';import {join} from 'node:path';
const root=join(import.meta.dirname,'../..'),out=join(root,'experiments/vtuber-v4-hand-calibration');mkdirSync(out,{recursive:true});
const executablePath=['C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe',process.env.BROWSER_EXECUTABLE].find(p=>p&&existsSync(p));
const browser=await chromium.launch({headless:true,executablePath}),page=await browser.newPage();await page.addInitScript('window.__name = target => target;');
try{
 await page.goto(process.env.DEMO_URL??'http://127.0.0.1:8766');await page.waitForFunction(()=>(window as any).live2dDemo?.ready,{timeout:60000});
 const result=await page.evaluate(()=>{
  const e=(window as any).live2dDemo.engine;e.dispatch('engine.reset',{});e.dispatch('engine.pause',{paused:true});e.dispatch('behavior.set',{idle:false,breath:false,blink:false,physicsEnabled:false});
  const rows:any[]=[];let seed=44071;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const sample=(side:string,values:number[])=>{
   const ids=side==='right'?['Param36','Param39','Param41','Param42']:['Param62','Param59','Param60','Param61'];
   e.dispatch('parameters.set',{values:Object.fromEntries(ids.map((id,i)=>[id,values[i]]))});e.apply(0);const p=e.handLandmarks()[side];if(!p||!Number.isFinite(p.y))throw new Error('Missing default hand mesh');rows.push({side,input:values,y:p.y});
  };
  for(const side of ['right','left']){
   for(const upper of [0,.2,.4,.6,.75,.9,1])for(const elbow of [-1,-.75,-.5,-.25,0,.25,.5,.75,1])for(const perspective of [-.2,.1,.4])for(const wrist of [-.4,0,.4])sample(side,[upper,perspective,elbow,wrist]);
   for(let i=0;i<600;i++)sample(side,[.5+rand()*.5,-.1+rand()*.4,-.3+rand()*.6,-.5+rand()]);
  }
  return {rows,asset_hash:e.manifest.assetHash,scope:'Default palm meshes, static geometry; excludes alternate hand drawings. Native joint combinations remain available.'};
 });
 writeFileSync(join(out,'rendered-palms.json'),JSON.stringify(result));console.log(JSON.stringify({samples:result.rows.length,asset_hash:result.asset_hash}));
}finally{await browser.close();}
