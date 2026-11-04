import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { existsSync,mkdirSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
const root=join(import.meta.dirname,'../..'),out=join(root,'test-results/v4/combinations');mkdirSync(out,{recursive:true});
const executablePath=['C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe',process.env.BROWSER_EXECUTABLE].find(p=>p&&existsSync(p));
const browser=await chromium.launch({headless:true,executablePath}),page=await browser.newPage({viewport:{width:1100,height:900}});
await page.addInitScript('window.__name = target => target;');
const cases=[
 {name:'neutral',values:{}},
 {name:'black-face-tears',values:{key1:.8,key2:.65}},
 {name:'blush-squeeze-eyes',values:{key7:.85,key5:.9}},
 {name:'spiral-eyes-sweat',values:{key3:1,key13:.7}},
 {name:'heart-eyes-blush',values:{key4:.8,key7:.6}},
 {name:'smug-eyes-sweat',values:{key6:.9,key13:.7}},
 {name:'continuous-arm-sleeve',values:{Param36:.3,Param41:.12,Param42:.1}},
 {name:'arms-point-hand-mode',values:{Param36:.2,Param60:.45,Movement3:1,Param40:1}},
 {name:'arms-chest-hand-mode',values:{Param60:.45,Movement2:1}},
 {name:'appearance-glasses-short',values:{Param36:.25},appearance:{glasses:'black',skirt:'short',shoes:false}},
 {name:'appearance-monocle-body',values:{key7:.5},appearance:{glasses:'monocle',body:'preset2',tail:false,chest:'alternate',bowl:true}},
];
const results:any[]=[];
try{
 await page.goto(process.env.DEMO_URL??'http://127.0.0.1:8765');await page.waitForFunction(()=>(window as any).live2dDemo?.ready,{timeout:60000});
 await page.evaluate(()=>{const stage=document.getElementById('stage')!;stage.style.width='480px';stage.style.height='720px';});
 for(const item of cases){
  const result=await page.evaluate(async item=>{
   const engine=(window as any).live2dDemo.engine,command=async(method:string,params:any={})=>(await engine.command({method,params})).result;
   await command('engine.reset');await command('engine.pause',{paused:true});
   if(item.appearance)await command('appearance.update',item.appearance);
   if(Object.keys(item.values).length)await command('parameters.set',{values:item.values});await command('engine.step',{frames:60});
   return await command('state.get',{geometry:true});
  },item);
  assert.ok(Object.values(result.values).every(Number.isFinite));
  await page.locator('#stage').screenshot({path:join(out,item.name+'.png')});
  results.push({name:item.name,requested:item,actual:Object.fromEntries(Object.keys(item.values).map(key=>[key,result.values[key]])),finite:true,geometry:result.geometry});
 }
 writeFileSync(join(out,'report.json'),JSON.stringify({ok:true,scope:'Selected isolated combinations; screenshots require visual review. This does not validate every possible parameter combination.',cases:results},null,2));
 console.log(JSON.stringify({ok:true,cases:results.length}));
}finally{await browser.close();}
