import {DEFAULT_MOTION_STYLE} from './motor';

type PanelOptions={prepare:()=>Promise<void>;ready:()=>boolean;connected:()=>boolean;onState?:(state:any)=>void};
export function mountPerformance(options:PanelOptions){
  const host=document.getElementById('performance-panel')!;
  const styles=[['lively','活泼'],['natural','自然'],['restrained','克制']].map(([value,label])=>`<option value="${value}"${value===DEFAULT_MOTION_STYLE?' selected':''}>${label}${value===DEFAULT_MOTION_STYLE?' · 默认':''}</option>`).join('');
  host.innerHTML=`<div class="composer-heading"><span class="eyebrow">一起聊一会儿</span><h1>让她说些什么<span>。</span></h1><p>写下台词，她会伴随声音做出表情和动作。</p></div>
    <label class="script-label" for="performance-text">台词</label><textarea id="performance-text" maxlength="2000" placeholder="想说的话，直接写在这里…" spellcheck="false">大家好呀，很高兴见到你。今天也一起加油吧！</textarea>
    <div class="script-meta"><span>Ctrl / ⌘ + Enter 开始</span><span id="text-count"></span></div>
    <details class="performance-settings"><summary>语境与表演风格<span>可选</span></summary><div class="settings-content"><label for="performance-context">语境</label><textarea id="performance-context" maxlength="800" rows="2" placeholder="例如：和观众日常聊天，刚收到一句夸奖。"></textarea><label for="performance-motion-style">表演风格</label><select id="performance-motion-style">${styles}</select></div></details>
    <div class="performance-actions"><button id="performance-play" class="primary" disabled><span aria-hidden="true">▶</span>开始说话</button><button id="performance-stop" class="secondary" disabled><span aria-hidden="true">■</span>停止</button></div>
    <div id="performance-message" class="performance-message" role="status" aria-live="polite"><span class="status-dot"></span><span id="performance-status-text">正在准备角色…</span></div><p class="composer-note">表情和动作会自动配合，无需逐项设置。</p>`;
  const get=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
  const input=get<HTMLTextAreaElement>('performance-text'),play=get<HTMLButtonElement>('performance-play'),stop=get<HTMLButtonElement>('performance-stop');
  let session:string|null=null,serial=0,submitting=false,active=false,polling=false,modelReady=false,statusPolling=false,lastStatusAt=0,manualStatus='';
  const command=async(method:string,params:any={})=>{
    const response=await fetch('/api/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,params,request_id:crypto.randomUUID()}),signal:AbortSignal.timeout(25000)});
    const data=await response.json();if(!response.ok)throw new Error(data.message??data.error??'请求失败，请重试');return data.result;
  };
  function message(text:string,error=false){get('performance-status-text').textContent=text;get('performance-message').classList.toggle('error',error);}
  function buttons(){play.disabled=!options.ready()||!modelReady||submitting||active||!input.value.trim();stop.disabled=!submitting&&!active;}
  function showError(error:any){manualStatus=error.message??String(error);message(manualStatus,true);}
  input.oninput=()=>{get('text-count').textContent=`${input.value.length} / 2000`;buttons();};input.oninput(null);
  async function poll(){
    buttons();
    if((!modelReady||!options.connected())&&!statusPolling&&Date.now()-lastStatusAt>3000){
      statusPolling=true;lastStatusAt=Date.now();
      try{const status=await command('performance.status');modelReady=!!status.ready;if(!active&&!submitting&&!manualStatus)message(modelReady?'准备好了，随时开始。':'正在准备语音与表演…');}
      catch{modelReady=false;}finally{statusPolling=false;buttons();}
    }
    // One outstanding read prevents background tabs from filling the command queue.
    if(polling||!options.connected())return;
    polling=true;
    try{
      const run=serial,state=await command('performance.state'),phase=state.queue?.phase??'waiting';
      if(run!==serial||submitting)return;
      if(state.session_id)session=state.session_id;
      active=!!state.queue&&!['finished','error','cancelled'].includes(phase);
      if(!submitting&&!manualStatus){
        const labels:Record<string,string>={waiting:active?'正在准备下一句话…':'准备好了，随时开始。',planning:'正在准备表演…',synthesizing:'正在准备声音与动作…',playing:'正在说话…',finished:'说完啦。你还想聊些什么？',cancelled:'已停止。'};
        message(state.queue?.error??labels[phase]??'准备好了，随时开始。',phase==='error');
      }
      options.onState?.(state);
    }catch(error){if(active&&!submitting)showError(error);}finally{polling=false;buttons();}
  }
  async function speak(){
    if(play.disabled)return;
    const run=++serial,text=input.value;submitting=true;manualStatus='';message('正在准备声音与动作…');buttons();
    try{
      await options.prepare();if(run!==serial)return;
      if(session)await command('performance.cancel',{session_id:session}).catch(()=>{});
      const started=await command('performance.start',{context:get<HTMLTextAreaElement>('performance-context').value,motion_style:get<HTMLSelectElement>('performance-motion-style').value});
      if(run!==serial){await command('performance.cancel',{session_id:started.session_id});return;}
      session=started.session_id;active=true;
      // Submit known text directly; simulated typing only delays the first sound.
      await command('performance.finish',{session_id:session,seq:0,text});
      if(run===serial)message('正在准备声音与动作…');
    }catch(error){if(run===serial){if(session)await command('performance.cancel',{session_id:session}).catch(()=>{});active=false;showError(error);}}
    finally{if(run===serial){submitting=false;buttons();void poll();}}
  }
  play.onclick=()=>{void speak();};
  stop.onclick=async()=>{
    serial++;submitting=false;active=false;manualStatus='已停止。';message(manualStatus);buttons();
    if(session)await command('performance.cancel',{session_id:session}).catch(showError);
  };
  input.onkeydown=event=>{if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();void speak();}};
  const timer=setInterval(()=>{void poll();},750);void poll();
  return {showError,dispose:()=>clearInterval(timer)};
}
