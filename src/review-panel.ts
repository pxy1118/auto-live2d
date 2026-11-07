import scenarioFile from '../contracts/review-scenarios.json';
type Options={prepare:()=>Promise<void>;ready:()=>boolean;connected:()=>boolean;onState?:(s:any)=>void};
const candidates=['A','B','C'];
const issues=['动作太少','动作太多','动作僵硬','情绪不对','时机不对','表情不自然'];
export function mountReview(options:Options){
 document.body.classList.add('review-page');
 const host=document.getElementById('performance-panel')!;
 host.innerHTML=`<div class="composer-heading"><span class="eyebrow">一起打磨她的表现</span><h1>选出喜欢的表演<span>。</span></h1><p>同一份声音，三种候选。看完后选出更自然的一版。</p></div>
 <div class="review-form"><label for="review-scenario">从一条练习开始，也可以自己写</label><select id="review-scenario"><option value="">自定义台词</option>${scenarioFile.scenarios.map(s=>`<option value="${s.id}">${s.title}</option>`).join('')}</select>
 <label for="review-text">台词 · 最多 180 字</label><textarea id="review-text" maxlength="180" rows="3">你终于回来啦，我今天很想你。再陪我聊一会儿，好不好嘛？</textarea>
 <label for="review-context">语境</label><textarea id="review-context" maxlength="800" rows="2">你正在和熟悉的观众聊天。</textarea>
 <div class="performance-actions"><button id="review-create" class="primary">准备候选</button><button id="review-stop" class="secondary" disabled>停止</button></div></div>
 <p id="review-status" class="review-status" role="status" aria-live="polite">选择台词后准备，音频只生成一次。</p>
 <div id="review-candidates" class="review-candidates">${candidates.map(c=>`<div class="review-candidate"><button id="review-play-${c}" class="secondary" disabled>播放 ${c}</button><span id="review-state-${c}">未观看</span><label>评分<select id="review-score-${c}" aria-label="候选 ${c} 评分"><option value="">留空</option>${[1,2,3,4,5].map(n=>`<option value="${n}">${n} 分</option>`).join('')}</select></label></div>`).join('')}</div>
 <fieldset id="review-vote" disabled><legend>看完三个版本，你更喜欢哪一个？</legend><div class="review-choices">${[...candidates,'neither','tie'].map(c=>`<label><input type="radio" name="review-choice" value="${c}">${c==='neither'?'都不合适':c==='tie'?'差不多':c}</label>`).join('')}</div><div class="review-issues">${issues.map((s,i)=>`<label><input type="checkbox" value="${s}" id="review-issue-${i}">${s}</label>`).join('')}</div><textarea id="review-note" maxlength="1000" rows="2" placeholder="哪里喜欢，哪里需要调整？可留空。" aria-label="评分备注"></textarea><button id="review-save" class="primary" disabled>保存选择</button></fieldset>
 <details class="performance-settings"><summary>已保存的样本<span id="review-count">0 条</span></summary><div class="settings-content"><select id="review-history" aria-label="历史样本"><option value="">选择一条样本继续</option></select><p class="acting-description">选择会保存在本机。评分后不会自动开始训练。</p></div></details>`;
 const el=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
 const text=el<HTMLTextAreaElement>('review-text'),context=el<HTMLTextAreaElement>('review-context'),scenario=el<HTMLSelectElement>('review-scenario'),history=el<HTMLSelectElement>('review-history');
 let current:any=null,busy=false,working=false,polling=false,selected='',historyKey='';
 const request=async(method:string,params:any={})=>{const r=await fetch('/api/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,params,request_id:crypto.randomUUID()}),signal:AbortSignal.timeout(method==='review.create'?130000:25000)});const d=await r.json();if(!r.ok)throw Error(d.message??'请求失败');return d.result;};
 const message=(s:string,error=false)=>{el('review-status').textContent=s;el('review-status').classList.toggle('error',error);};
 const showError=(e:any)=>message(e.message??String(e),true);
 function buttons(){
  const locked=busy||working;
  document.body.classList.toggle('review-playing',locked);
  el<HTMLButtonElement>('review-create').disabled=!options.ready()||locked||!text.value.trim();el<HTMLButtonElement>('review-stop').disabled=!locked;
  for(const c of candidates)el<HTMLButtonElement>('review-play-'+c).disabled=!options.ready()||locked||!current||current.status!=='ready';
  el<HTMLFieldSetElement>('review-vote').disabled=locked||!current||!candidates.every(c=>current.takes[c]?.complete);
  el<HTMLButtonElement>('review-save').disabled=locked||!selected||!current||!candidates.every(c=>current.takes[c]?.complete);
  text.disabled=context.disabled=scenario.disabled=history.disabled=locked;
 }
 function clearVote(){selected='';for(const input of host.querySelectorAll<HTMLInputElement>('input'))input.checked=false;for(const c of candidates)el<HTMLSelectElement>('review-score-'+c).value='';el<HTMLTextAreaElement>('review-note').value='';}
 function render(){
  for(const c of candidates){const t=current?.takes[c];el('review-state-'+c).textContent=t?.complete?'已看完':t?.status==='playing'?'播放中…':t?.status==='interrupted'?'已中断，请重播':'未观看';}
  buttons();
 }
 function edit(){current=null;clearVote();render();message('台词已修改，请重新准备候选。');}
 text.oninput=context.oninput=edit;
 scenario.onchange=()=>{const s=scenarioFile.scenarios.find(s=>s.id===scenario.value);if(s){text.value=s.text;context.value=s.context;}edit();};
 host.querySelectorAll<HTMLInputElement>('input[name="review-choice"]').forEach(input=>input.onchange=()=>{selected=input.value;buttons();});
 el('review-create').onclick=async()=>{working=true;buttons();message('正在准备共用音频…');try{await options.prepare();current=await request('review.create',{text:text.value,context:context.value,scenario_id:scenario.value});clearVote();message('候选已准备。依次播放 A、B、C，再选择你喜欢的版本。');}catch(e){showError(e);}finally{working=false;await refresh();render();}};
 for(const c of candidates)el('review-play-'+c).onclick=async()=>{working=true;buttons();message(`正在播放 ${c}…`);document.querySelector('.stage-shell')?.scrollIntoView({behavior:'smooth',block:'start'});try{await options.prepare();current=await request('review.play',{case_id:current.id,candidate:c});busy=true;clearVote();}catch(e){showError(e);}finally{working=false;render();}};
 el('review-stop').onclick=async()=>{try{await request('review.stop');message('已停止。中断的候选需要重新完整观看。');}catch(e){showError(e);}};
 el('review-save').onclick=async()=>{working=true;buttons();try{await request('review.rate',{case_id:current.id,choice:selected,takes:Object.fromEntries(candidates.map(c=>[c,current.takes[c].id])),scores:Object.fromEntries(candidates.map(c=>[c,el<HTMLSelectElement>('review-score-'+c).value?Number(el<HTMLSelectElement>('review-score-'+c).value):null])),issues:[...host.querySelectorAll<HTMLInputElement>('.review-issues input:checked')].map(i=>i.value),note:el<HTMLTextAreaElement>('review-note').value});message('已保存选择。可以换下一条台词，或重新观看修改评分。');}catch(e){showError(e);}finally{working=false;await refresh();buttons();}};
 history.onchange=async()=>{if(!history.value)return;try{current=await request('review.get',{case_id:history.value});text.value=current.text;context.value=current.context;scenario.value=current.scenario_id??'';clearVote();render();message(current.status!=='ready'?(current.error??'音频未准备完成，请重新准备'):current.latest_rating?'这条已有评分，可以重新观看并提交新的选择。':'已载入，可继续观看和评分。',current.status!=='ready');}catch(e){showError(e);}};
 async function refresh(){
  if(polling)return;polling=true;
  try{const list=await request('review.list');const wasBusy=busy;busy=list.busy;
   const nextKey=JSON.stringify(list.cases.map(r=>[r.id,r.latest_rating?.id]));
   if(nextKey!==historyKey){const choice=history.value;history.replaceChildren(new Option('选择一条样本继续',''));for(const row of list.cases)history.add(new Option(`${row.latest_rating?'已评 · ':''}${row.text.slice(0,25)}`,row.id));history.value=choice;historyKey=nextKey;}
   el('review-count').textContent=list.cases.length+' 条';
   if(current){const row=list.cases.find(r=>r.id===current.id);if(row)current=row;}
   if(!working&&wasBusy&&!busy&&current)message(current.takes&&candidates.every(c=>current.takes[c]?.complete)?'三个版本已看完，可以保存选择。':'播放结束，可以继续看下一个版本。');
   render();if(options.connected()){const state=await request('performance.state');options.onState?.(state);}
  }catch(e){if(current&&!working)showError(e);}finally{polling=false;buttons();}
 }
 const timer=setInterval(()=>{void refresh();},800);void refresh();buttons();
 return {showError,dispose:()=>clearInterval(timer)};
}
