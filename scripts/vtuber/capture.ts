/** Reproducible Cubism recordings and rendered review evidence, on an isolated server. */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { datasetRoot, families, variantCount, makeClip, profile, read, root, sha, sourceAt, sourceInfo } from './design';

const base = process.env.DATASET_URL ?? 'http://127.0.0.1:8766';
const only = process.env.DATASET_FAMILIES?.split(',');
const priority=['anger_boundary','shy_praise','greeting_calm','config_body1','config_native'];
const selected = families.filter(f => !only || only.includes(f.id)).sort((a,b)=>(priority.includes(a.id)?priority.indexOf(a.id):-1+100)-(priority.includes(b.id)?priority.indexOf(b.id):-1+100));
for (const path of ['candidates', 'recordings', 'review/frames', 'review/animation-frames']) mkdirSync(join(datasetRoot, path), { recursive: true });
const write = (path: string, value: any) => writeFileSync(path, JSON.stringify(value, null, 2));
if (existsSync(join(datasetRoot, 'profile.json')) && read(join(datasetRoot, 'profile.json')).sha256 !== profile.sha256) throw new Error('Dataset profile changed; use a new version');
write(join(datasetRoot, 'profile.json'), profile);
write(join(datasetRoot, 'source-analysis.json'), { ...sourceInfo, sampled_hz: 20,
  samples: Array.from({ length: 264 }, (_, i) => ({ time: Math.min(i/20,13.15), values: Object.fromEntries(profile.channels.map(c => [c.id, sourceAt(c.id,Math.min(i/20,13.15))])) })) });
const executablePath = [process.env.BROWSER_EXECUTABLE, 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(p => p && existsSync(p));
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const errors: string[] = [];
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 860 } });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(base);
  await page.waitForFunction(() => (window as any).live2dDemo?.ready, { timeout: 60000 });
  await page.addStyleTag({ content: '#stage{width:360px;height:480px!important;min-height:0!important}#model-canvas{width:360px!important;height:480px!important}' });
  const capabilities: any = await page.evaluate(() => (window as any).live2dDemo.engine.describe());
  for (const c of profile.channels) {
    const p = capabilities.parameters.find((p: any) => p.id === c.id);
    if (!p || c.min < p.min || c.max > p.max || p.physicsOutput) throw new Error(`Invalid independent driver ${c.id}`);
  }
  write(join(datasetRoot, 'runtime-source.json'), { asset_hash: capabilities.asset_hash, sdk: capabilities.sdk, parameters: capabilities.parameters.length,
    drawables: capabilities.drawables, physics_groups: capabilities.physics_groups, profile_sha256: profile.sha256 });
  // Full original reference, replayed through the same actual Cubism engine.
  if (!existsSync(join(datasetRoot, 'review/frames/native-reference-0.png'))) {
    const native: any = await page.evaluate(() => {
      const e = (window as any).live2dDemo.engine;
      e.framing = 'portrait'; e.dispatch('engine.reset', { paused: true }); e.dispatch('behavior.set', { idle: true, breath: true, blink: true, physicsEnabled:true });
      e.dispatch('motions.play', { name: '脱捕', loop: false });
      const images: any[] = [], trace: any[] = [];
      for (let i=0;i<=132;i++) {
        if(i) e.dispatch('engine.step',{frames:6});
        trace.push(e.dispatch('state.get',{geometry:true}));
        if ([0,15,35,55,75,95,115,132].includes(i)) {e.draw();images.push({time_ms:i*100,png:e.canvas.toDataURL('image/png')});}
      }
      return {images,trace};
    });
    native.images.forEach((frame: any, i: number) => writeFileSync(join(datasetRoot, `review/frames/native-reference-${i}.png`), Buffer.from(frame.png.split(',')[1], 'base64')));
    write(join(datasetRoot, 'review/native-reference-trace.json'), native.trace);
  }
  let count = 0;
  for (const family of selected) for (let variant=0;variant<variantCount(family);variant++) {
    const clip = makeClip(family,variant);
    const path = join(datasetRoot,'candidates',clip.id+'.json');
    if (existsSync(path)) {
      const previous = read(path);
      if (JSON.stringify(previous.design) !== JSON.stringify(clip.design) || JSON.stringify(previous.values)!==JSON.stringify(clip.values)) throw new Error(`Candidate changed: ${clip.id}`);
      continue;
    }
    const captured: any = await page.evaluate(({ clip, channels }) => {
      const e = (window as any).live2dDemo.engine;
      e.framing = clip.framing; e.dispatch('recording.start',{paused:true,annotation:{source_type:'program_authored',family:clip.family,style:'vtuber_coupled',human_reviewed:false}});
      e.dispatch('behavior.set',{idle:true,breath:true,blink:true,physicsEnabled:true});
      e.dispatch(clip.command.method,clip.command.params);
      const trace: any[] = [], images: any[] = [], animation: any[] = [];
      const steps=Math.round(clip.duration_ms/100),keyframes=[0,7,14,25,46,steps];
      for (let i=0;i<=steps;i++) {
        if(i) e.dispatch('engine.step',{frames:6});
        const s = e.dispatch('state.get',{geometry:true});
        trace.push({time_ms:s.time_ms,driver:channels.map((c:any)=>s.driver[c.id]),action_driver:channels.map((c:any)=>s.action_driver[c.id]),actual:channels.map((c:any)=>s.values[c.id]),
          behavior:s.behavior,background_time_ms:s.background_time_ms,motions:s.motions,
          breath_value:s.values.ParamBreath,idle_value:s.values.Param32,appearance_value:s.values.Clothes2,
          geometry:s.geometry,gesture:s.gesture,hand_values:[s.values.Movement1,s.values.Movement2,s.values.Movement3],
          physics_angle:[s.values.ParamAngleX,s.values.ParamAngleY,s.values.ParamAngleZ],
          physics_body:[s.values.ParamBodyAngleX,s.values.ParamBodyAngleY,s.values.ParamBodyAngleZ],
          expressions:s.expressions,expression_values:{key1:s.values.key1,key3:s.values.key3,key4:s.values.key4,key5:s.values.key5,key6:s.values.key6,key7:s.values.key7,key8:s.values.key8,key9:s.values.key9,key10:s.values.key10,key11:s.values.key11,key12:s.values.key12,key13:s.values.key13,key2:s.values.key2}});
        if (keyframes.includes(i) || (clip.representative && i%2===0)) {
          e.draw();const png=e.canvas.toDataURL('image/png');
          if(keyframes.includes(i)) images.push({time_ms:i*100,png});
          if(clip.representative && i%2===0) animation.push({time_ms:i*100,png});
        }
      }
      return {recording:e.dispatch('recording.stop',{}),trace,images,animation};
    }, { clip, channels: profile.channels });
    if(captured.recording.asset_hash !== capabilities.asset_hash || captured.recording.frames.length !== Math.round(clip.duration_ms/100) || captured.recording.limitReached) throw new Error(`Recording incomplete ${clip.id}`);
    write(join(datasetRoot,'recordings',clip.id+'.json'),captured.recording);
    const frames: any[] = [];
    captured.images.forEach((frame: any, i: number) => { const relative=`review/frames/${clip.id}-${i}.png`;const buffer=Buffer.from(frame.png.split(',')[1],'base64');writeFileSync(join(datasetRoot,relative),buffer);frames.push({file:relative,time_ms:frame.time_ms,sha256:sha(buffer)}); });
    captured.animation.forEach((frame: any, i: number) => writeFileSync(join(datasetRoot,`review/animation-frames/${clip.id}-${String(i).padStart(2,'0')}.png`),Buffer.from(frame.png.split(',')[1],'base64')));
    write(path,{...clip,asset_hash:capabilities.asset_hash,recording_file:`recordings/${clip.id}.json`,recording_sha256:sha(Buffer.from(JSON.stringify(captured.recording,null,2))),rendered_frames:frames,trace:captured.trace,
      audit_status:'pending',human_reviewed:false});
    count++;
    if (variant===variantCount(family)-1) console.log(JSON.stringify({captured:count,family:family.id,total:selected.reduce((sum,f)=>sum+variantCount(f),0)}));
  }
  if(errors.length) throw new Error(errors.join('\n'));
  console.log(JSON.stringify({ok:true,new_clips:count,dataset:datasetRoot,browser_errors:errors}));
} finally { await browser.close(); }
