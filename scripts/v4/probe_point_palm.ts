import {chromium} from 'playwright';import {existsSync,mkdirSync,writeFileSync} from 'node:fs';import {join} from 'node:path';
const root=join(import.meta.dirname,'../..'),out=join(root,'test-results/v4-groups-r3/poses');mkdirSync(out,{recursive:true});
const executablePath=['C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe',process.env.BROWSER_EXECUTABLE].find(p=>p&&existsSync(p));
const browser=await chromium.launch({headless:true,executablePath}),page=await browser.newPage({viewport:{width:1000,height:900}});await page.addInitScript('window.__name=target=>target;');
const poses:any[]=[];
for(const mode of [0,.35,1])for(const seam of [0,1])poses.push({name:`point-mode${mode}-seam${seam}`,values:{Param36:0,Param39:.322,Param41:.702,Param42:0,Param43:0,Param40:seam,Movement3:mode,RHand:.8,RHand2:.2}});
for(const upper of [-.35,-.15,0])for(const forearm of [.702,-.88])poses.push({name:`palm-u${upper}-e${forearm}`,values:{Param36:upper,Param39:.322,Param41:forearm,Param42:0,Param40:1,Movement3:0,RHand:.65,RHand2:.2}});
try{
 await page.goto(process.env.DEMO_URL??'http://127.0.0.1:8777');await page.waitForFunction(()=>(window as any).live2dDemo?.ready,{timeout:60000});
 await page.evaluate(()=>{const s=document.getElementById('stage')!;s.style.width='480px';s.style.height='720px';(window as any).live2dDemo.engine.framing='portrait';});
 const proof:any[]=[];
 for(const pose of poses){const state=await page.evaluate(pose=>{const e=(window as any).live2dDemo.engine;e.dispatch('engine.reset',{});e.dispatch('engine.pause',{paused:true});e.dispatch('behavior.set',{idle:false,blink:false});e.dispatch('parameters.set',{values:pose.values});e.apply(0);e.draw();return e.dispatch('state.get',{hand_landmarks:true});},pose);await page.locator('#stage').screenshot({path:join(out,pose.name+'.png')});proof.push({pose,state});}
 writeFileSync(join(out,'point-palm.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify({poses:proof.length}));
}finally{await browser.close();}
