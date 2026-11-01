export function mountSpeech(activity:{canStart:()=>boolean;busy:(value:boolean)=>void}){
  const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
  const engine=()=>(window as any).live2dDemo.engine;
  document.querySelector('#latent-panel details')!.insertAdjacentHTML('beforebegin',`<div class="speech-bar"><button id="speech-perform" class="primary">说话并表演</button><button id="speech-stop">停止说话</button><button id="speech-enable">启用声音</button><label><input id="speech-motion" type="checkbox" checked> 同步身体动作</label><span id="speech-status" role="status">检查语音服务…</span></div>`);
  let serial=0,abort:AbortController|null=null,preparing=false,wasActive=false;
  const val=(id:string)=>$<HTMLInputElement>(id).value;
  const request=async(path:string,body?:any,signal?:AbortSignal)=>{
    const r=await fetch(path,body===undefined?{signal}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal});const d=await r.json();if(!r.ok)throw new Error(d.message??d.error);return d;
  };
  const unlock=async()=>{await engine().command({method:'speech.unlock'});$('speech-enable').textContent='声音已启用';};
  $('speech-enable').onclick=()=>unlock().catch(e=>$('speech-status').textContent=e.message);
  $('speech-perform').onclick=async()=>{
    if(!activity.canStart())return;
    const id=++serial;abort?.abort();abort=new AbortController();preparing=true;
    activity.busy(true);
    $<HTMLButtonElement>('speech-perform').disabled=true;$('speech-status').textContent='正在合成大肥鱼的语音…';
    try{
      await unlock();await engine().command({method:'speech.stop'});
      const result=await request('/api/speech/prepare',{text:val('latent-text'),context:val('latent-context'),kind:val('latent-kind'),style:val('latent-style'),with_motion:$<HTMLInputElement>('speech-motion').checked},abort.signal);
      if(id!==serial)return;
      $('latent-details').textContent=JSON.stringify(result,null,2);
      await request('/api/speech/execute',{speech_id:result.speech_id},abort.signal);
      if(id!==serial)return;
      $('speech-status').textContent=`正在说话 · ${(result.duration_ms/1000).toFixed(1)} 秒`;wasActive=true;
      $('stage').scrollIntoView({behavior:'smooth',block:'center'});
    }catch(e:any){if(id===serial)$('speech-status').textContent=e.message;}
    finally{if(id===serial){preparing=false;activity.busy(false);$<HTMLButtonElement>('speech-perform').disabled=false;}}
  };
  $('speech-stop').onclick=async()=>{
    serial++;abort?.abort();preparing=false;$<HTMLButtonElement>('speech-perform').disabled=false;wasActive=false;
    activity.busy(false);
    await engine().command({method:'speech.stop'});$('speech-status').textContent='已停止。';
  };
  setInterval(()=>{
    const s=engine().speechState();
    if(s.active){wasActive=true;if(!preparing)$('speech-status').textContent=`${s.phase==='paused'?'已暂停':'正在说话'} · ${(s.audio_time_ms/1000).toFixed(1)} / ${(s.duration_ms/1000).toFixed(1)} 秒`;}
    else if(wasActive&&!preparing){wasActive=false;$('speech-status').textContent='说完啦。';}
  },120);
  request('/api/speech/status').then(s=>{$('speech-status').textContent=s.ready?'大肥鱼音色已就绪 · 每次支持 300 字以内':s.message;}).catch(()=>$('speech-status').textContent='语音服务未连接');
}
