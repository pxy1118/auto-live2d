import { chromium } from 'playwright';
import { existsSync,mkdirSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
const root=join(import.meta.dirname,'../..'),out=join(root,'test-results/v4/audit');mkdirSync(out,{recursive:true});
const executablePath=['C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe',process.env.BROWSER_EXECUTABLE].find(p=>p&&existsSync(p));
const browser=await chromium.launch({headless:true,executablePath});const page=await browser.newPage({viewport:{width:1100,height:900}});
await page.addInitScript('window.__name = target => target;');await page.goto(process.env.DEMO_URL??'http://127.0.0.1:8765');
await page.waitForFunction(()=>(window as any).live2dDemo?.ready,{timeout:60000});
const command=async(method:string,params:any={})=>page.evaluate(async ({method,params})=>(await (window as any).live2dDemo.engine.command({method,params})).result,{method,params});
const capabilities=await command('capabilities.get'),rows:any[]=[];
try{
  await command('engine.reset',{paused:true});await command('engine.step',{frames:60});
  const geometry=()=>page.evaluate(()=>{const e=(window as any).live2dDemo.engine,m=e._model;return Array.from({length:m.getDrawableCount()},(_,i)=>[m.getDrawableOpacity(i),...Array.from(m.getDrawableVertexPositions(i))]);});
  const baseline=await geometry();
  for(let i=0;i<capabilities.parameters.length;i++){
    const p=capabilities.parameters[i],results=[];
    for(const value of [...new Set([p.min,p.default,p.max])]){
      await command('engine.reset',{paused:true});await command('parameters.set',{values:{[p.id]:value},stage:p.stage});await command('engine.step',{frames:60});
      const state=await command('state.get',{geometry:true}),mesh=await geometry();
      let delta=0;for(let d=0;d<mesh.length;d++)for(let k=0;k<mesh[d].length;k++)delta+=Math.abs(mesh[d][k]-baseline[d][k]);
      const name=`${String(i).padStart(3,'0')}-${value===p.min?'min':value===p.max?'max':'default'}.png`;
      await page.locator('#model-canvas').screenshot({path:join(out,name)});
      results.push({requested:value,actual:state.values[p.id],mesh_l1:delta,geometry:state.geometry,image:name,finite:Object.values(state.values).every(Number.isFinite)});
    }
    rows.push({...p,render_verified:true,visible_change:results.some(r=>r.mesh_l1>.01),samples:results});
    if(i%40===0)console.log(JSON.stringify({audited:i+1,total:capabilities.parameters.length}));
  }
  writeFileSync(join(out,'capabilities.json'),JSON.stringify({...capabilities,parameters:rows,verification:'isolated extremes with physics enabled; automated mesh/screenshot evidence, combinations require separate review'},null,2));
}finally{await browser.close();}
