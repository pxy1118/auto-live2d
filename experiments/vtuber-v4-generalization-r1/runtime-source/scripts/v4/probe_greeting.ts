import {chromium} from 'playwright';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const root=join(import.meta.dirname,'../..'),out=join(root,'test-results/v4-groups-r2/poses');mkdirSync(out,{recursive:true});
const executablePath=['C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe',process.env.BROWSER_EXECUTABLE].find(p=>p&&existsSync(p));
const browser=await chromium.launch({headless:true,executablePath}),page=await browser.newPage({viewport:{width:1000,height:900}});await page.addInitScript('window.__name=target=>target;');
const poses:any[]=[];
for(const upper of [-.45,-.25,-.1])for(const elbow of [-.78,-.88,-.96])poses.push({name:`low-u${upper}-e${elbow}`,values:{Param36:upper,Param39:.2,Param41:elbow,Param62:upper,Param59:.2,Param60:elbow,RHand:-1,RHand2:-.65,LHand:-1,LHand2:-.65}});
const proof:any[]=[];
try{
 await page.goto(process.env.DEMO_URL??'http://127.0.0.1:8776');await page.waitForFunction(()=>(window as any).live2dDemo?.ready,{timeout:60000});
 await page.evaluate(()=>{const s=document.getElementById('stage')!;s.style.width='480px';s.style.height='720px';(window as any).live2dDemo.engine.framing='portrait';});
 for(const pose of poses){
  const result=await page.evaluate(async pose=>{
   const e=(window as any).live2dDemo.engine;e.dispatch('engine.reset',{});e.dispatch('engine.pause',{paused:true});e.dispatch('behavior.set',{blink:false,idle:false});
   e.dispatch('parameters.set',{values:pose.values});e.apply(0);e.draw();
   return e.dispatch('state.get',{hand_landmarks:true});
  },pose);
  await page.locator('#stage').screenshot({path:join(out,pose.name+'.png')});proof.push({pose,result});
 }
 writeFileSync(join(out,'poses.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify({poses:proof.length}));
}finally{await browser.close();}
