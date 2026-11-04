export function mountSpeech(activity:{canStart:()=>boolean;busy:(value:boolean)=>void}){
  const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
  const engine=()=>(window as any).live2dDemo.engine;
  document.querySelector('#latent-panel details')!.insertAdjacentHTML('beforebegin',`<div class="speech-bar"><button id="speech-perform" class="primary">说话并表演</button><button id="speech-stop">停止说话</button><button id="speech-enable">启用声音</button><label><input id="speech-motion" type="checkbox" checked> 同步身体动作</label><span id="speech-status" role="status">检查语音服务…</span></div>`);
  let serial=0,abort:AbortController|null=null,preparing=false,wasActive=false,streaming=true;
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
    $<HTMLButtonElement>('speech-perform').disabled=true;$('speech-status').textContent='大肥鱼准备开口…';
    try{
      await unlock();await engine().command({method:'speech.stop'});
      const input={text:val('latent-text'),context:val('latent-context'),kind:val('latent-kind'),style:val('latent-style'),with_motion:$<HTMLInputElement>('speech-motion').checked};
      if(streaming){
        const response=await fetch('/api/speech/perform',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),signal:abort.signal});
        if(!response.ok){const error=await response.json();throw new Error(error.message??error.error);}
        const reader=response.body!.getReader(),decoder=new TextDecoder();let pending='',complete=false;
        try{
          for(;;){
            const {done,value}=await reader.read();if(id!==serial)return;
            pending+=decoder.decode(value,{stream:!done});
            if(pending.length>256000)throw new Error('语音响应数据过大');
            let end:number;
            while((end=pending.indexOf('\n'))>=0){
              const line=pending.slice(0,end);pending=pending.slice(end+1);if(!line.trim())continue;
              const event=JSON.parse(line);
              if(event.type==='error')throw new Error(event.error);
              if(event.type==='end'){complete=true;$('latent-details').textContent=JSON.stringify(event,null,2);}
              if(event.type==='progress')wasActive=true;
            }
            if(done){if(pending.trim()||!complete)throw new Error('语音生成中断');break;}
          }
        }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
      }else{
        const result=await request('/api/speech/prepare',input,abort.signal);
        if(id!==serial)return;
        $('latent-details').textContent=JSON.stringify(result,null,2);
        await request('/api/speech/execute',{speech_id:result.speech_id},abort.signal);
      }
      if(id!==serial)return;
      wasActive=true;
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
    if(s.active){wasActive=true;
      $('speech-status').textContent=s.phase==='buffering'?'正在准备接下来的语音…':`${s.phase==='paused'?'已暂停':'正在说话'} · ${(s.audio_time_ms/1000).toFixed(1)}${s.complete?' / '+(s.duration_ms/1000).toFixed(1):''} 秒`;
    }
    else if(wasActive&&!preparing){wasActive=false;$('speech-status').textContent='说完啦。';}
  },120);
  request('/api/speech/status').then(s=>{streaming=!!s.streaming;$('speech-status').textContent=s.ready?'大肥鱼音色已就绪 · '+(s.streaming?'可以边生成边说':'每次支持 300 字以内'):s.message;}).catch(()=>$('speech-status').textContent='语音服务未连接');
}
