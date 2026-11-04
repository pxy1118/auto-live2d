import './performance.css';
import {gestureLabels} from './gesture-library';
import {actingVariants} from './gesture-choreography';
import {bodyMotionNames,bodyMotionLabels,bodyMotionVariants} from './body-motion';
export function mountPerformance(preparePerformance?:()=>Promise<void>){
  document.querySelector('#latent-panel')!.insertAdjacentHTML('beforebegin',`<section class="latent-shell" id="performance-panel">
    <div class="latent-heading"><div><span class="eyebrow">持续说话 · 连续表演</span><h2 id="performance-title">会话表演 v4</h2></div><span id="performance-status">检查表演模型…</span></div>
    <label class="performance-text">角色台词<textarea id="performance-text" rows="3" placeholder="文字会分段送入；说到下一句时保留姿态与情绪。">大家好呀。这件事就交给我吧。再陪我一会儿好不好？你突然这么夸我，我有点不好意思啦。</textarea></label>
    <div class="performance-row"><label>语境<input id="performance-context" placeholder="例如：和观众日常聊天" /></label><label>候选<select id="performance-kind"><option value="regression">回归</option><option value="flow">Flow</option></select></label><label>表演方式<select id="performance-backend"><option value="groups">模型组合手势与身体</option><option value="continuous">自由动作（研究）</option></select></label><label>动作风格<select id="performance-motion-style"><option value="restrained">克制（默认）</option><option value="natural">自然</option><option value="lively">活泼</option></select></label></div>
    <div id="semantic-inputs" style="display:none"><label class="performance-text">观众说了什么<textarea id="semantic-audience" rows="2" placeholder="例如：你刚提醒我保存，我还是把没保存的文件关掉了。"></textarea></label><label class="performance-text">本次导演要求<input id="semantic-director" placeholder="例如：开头向观众轻轻挥手一次；不要挥手等否定要求也会送入理解。" /></label><p>整段台词一次理解、连续说完（最多300字）。按声音进度切换表情和动作。</p></div>
    <div class="latent-buttons"><button id="performance-play" class="primary">开始流式表演</button><button id="performance-stop">停止</button><button id="performance-enable-audio">启用声音</button><a href="/dataset/vtuber-v4/review/index.html" target="_blank" rel="noopener">历史动作与评分（研究）↗</a></div>
    <div class="performance-director"><h3>身体与手势组合</h3><div class="performance-row"><label>手势<select id="performance-gesture"><option value="wave">屈肘张掌挥手</option><option value="chest">抚胸</option><option value="grass">狗尾草展示</option><option value="point">指出重点</option><option value="thanks">抚胸致谢</option><option value="explain">身前说明</option><option value="refuse">抬指示意停止</option><option value="rest">收手保持安静</option><option value="">不换手势，只播身体</option></select></label><label>手势停留秒数<input id="performance-gesture-hold" type="number" min="0" max="15" step="0.2" value="1.4" /></label><label>手势变体<select id="performance-gesture-variant"><option value="">自动变化</option><option value="0">A</option><option value="1">B</option><option value="2">C</option></select></label></div>
    <div class="performance-row"><label>身体<select id="performance-body"><option value="">随手势编排</option>${bodyMotionNames.map(n=>`<option value="${n}">${bodyMotionLabels[n]}</option>`).join('')}<option value="rest">收回附加身体动作</option></select></label><label>身体变体<select id="performance-body-variant"></select></label><label>身体幅度<input id="performance-body-strength" type="range" min="0" max="1" step="0.05" value="0.75" /></label><label>身体停留秒数<input id="performance-body-hold" type="number" min="0" max="15" step="0.2" value="2.2" /></label><button id="performance-gesture-play">播放组合</button></div><p>撒娇、前倾、轻摇、点头、歪头、侧首可独立表演，也可与单手手势组合。撒娇先前倾靠近，再轻扭身体、歪头回应；头身错开节奏，手臂沿用原生关节轨迹。</p></div>
    <div class="performance-director"><h3>临时导演指令</h3><div class="performance-row"><label>情绪<select id="performance-emotion"><option value="angry">生气</option><option value="shy">害羞</option><option value="happy">开心</option><option value="sad">难过</option><option value="confused">困惑</option><option value="neutral">平静</option></select></label>
    <label>强度 <input id="performance-strength" type="range" min="0" max="1" step="0.05" value="0.7" /></label><label>保持秒数<input id="performance-hold" type="number" min="0" max="600" value="4" /></label>
    <label>表情<select id="performance-expression"><option value="">随情绪</option><option value="＞＜">＞＜ 眼</option><option value="圈圈眼">圈圈眼</option><option value="爱心眼">爱心眼</option><option value="屑屑眼">屑屑眼</option><option value="黑脸">黑脸</option><option value="脸红">脸红</option></select></label>
    <button id="performance-direct">应用</button><button id="performance-release">恢复自动</button></div></div>
    <div class="performance-director"><h3>持久外观</h3><div class="performance-row"><label>眼镜<select id="appearance-glasses"><option value="none">不戴</option><option value="black">黑框</option><option value="monocle">单片</option></select></label><label>裙子<select id="appearance-skirt"><option value="short">短裙</option><option value="long">长裙</option></select></label><label>体型<select id="appearance-body"><option value="default">默认</option><option value="preset1">体型 1</option><option value="preset2">体型 2</option></select></label><label><input id="appearance-shoes" type="checkbox" checked />鞋子</label><label><input id="appearance-tail" type="checkbox" checked />尾巴</label><label><input id="appearance-chest" type="checkbox" />胸口衣服切换</label><button id="appearance-apply">设置外观</button></div></div>
    <p id="performance-current" role="status">模型会自动组合手势、身体与表情，也可以安静地说话。</p><p id="semantic-reading" role="status"></p><p id="performance-message" role="status">正在读取当前方案…</p><details><summary>会话进度</summary><pre id="performance-details"></pre></details></section>`);
  const get=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
  const value=(id:string)=>get<HTMLInputElement>(id).value;let session:string|null=null,seq=0,busy=false,semantic=false,runSerial=0;
  for(const option of get<HTMLSelectElement>('performance-gesture').options)if(gestureLabels[option.value])option.textContent=gestureLabels[option.value];
  const refreshVariants=()=>{const menu=get<HTMLSelectElement>('performance-gesture-variant'),selected=menu.value;menu.innerHTML='<option value="">自动变化</option>'+(actingVariants[value('performance-gesture')]??[]).map((label,i)=>`<option value="${i}">${String.fromCharCode(65+i)} · ${label}</option>`).join('');menu.value=[...menu.options].some(o=>o.value===selected)?selected:'';};
  get('performance-gesture').onchange=refreshVariants;refreshVariants();
  const refreshBodyVariants=()=>{get<HTMLSelectElement>('performance-body-variant').innerHTML='<option value="">自动变化</option>'+(bodyMotionVariants[value('performance-body')]??[]).map((label,i)=>`<option value="${i}">${String.fromCharCode(65+i)} · ${label}</option>`).join('');};
  get('performance-body').onchange=refreshBodyVariants;refreshBodyVariants();
  const command=async(method:string,params:any={})=>{const r=await fetch('/api/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,params,request_id:crypto.randomUUID()})});const d=await r.json();if(!r.ok)throw new Error(d.message??d.error);return d.result;};
  const show=(error:any)=>{get('performance-message').textContent=error.message??String(error);};
  get('performance-enable-audio').onclick=async()=>{try{if(preparePerformance)await preparePerformance();else await command('speech.unlock');get('performance-message').textContent='声音已启用，当前窗口可以控制角色。';}catch(error){show(error);}};
  get('performance-play').onclick=async()=>{
    if(busy)return;const serial=++runSerial;busy=true;get<HTMLButtonElement>('performance-play').disabled=true;
    try{
      const text=value('performance-text');if(!text.trim())throw new Error('请输入台词');
      if(semantic&&text.length>300)throw new Error('完整台词最多300字，请缩短后播放。');
      get('performance-message').textContent='正在连接当前角色并启用声音…';
      if(preparePerformance)await preparePerformance();else await command('speech.unlock');
      if(serial!==runSerial)return;
      if(session)await command('performance.cancel',{session_id:session}).catch(()=>{});
      const result=await command('performance.start',{context:value('performance-context'),kind:value('performance-kind'),motion_style:value('performance-motion-style'),motion_backend:value('performance-backend'),
        ...(semantic?{audience_message:value('semantic-audience'),director_instruction:value('semantic-director')}:{})});
      if(serial!==runSerial){await command('performance.cancel',{session_id:result.session_id}).catch(()=>{});return;}session=result.session_id;seq=0;
      if(!semantic)for(let i=0;i<text.length;i+=8){if(!busy)break;await command('performance.append',{session_id:session,seq:seq++,text:text.slice(i,i+8)});await new Promise(r=>setTimeout(r,100));}
      if(busy)await command('performance.finish',{session_id:session,seq:seq++,...(semantic?{text}:{})});get('performance-message').textContent=semantic?'正在理解整段台词并准备语音…':'正在表演，下一句会保持当前状态。';
    }catch(e){if(serial===runSerial)show(e);}finally{if(serial===runSerial){busy=false;get<HTMLButtonElement>('performance-play').disabled=false;}}
  };
  get('performance-stop').onclick=async()=>{runSerial++;busy=false;get<HTMLButtonElement>('performance-play').disabled=false;if(session)await command('performance.cancel',{session_id:session}).catch(show);else await command('performance.release').catch(show);get('performance-message').textContent='已停止；外观保持。';};
  get('performance-gesture-play').onclick=()=>{
    if(!value('performance-gesture')&&!value('performance-body')){show('请选择身体动作或手势');return;}
    command('performance.direct',{...(value('performance-gesture')?{gesture:value('performance-gesture'),gesture_hold_ms:Number(value('performance-gesture-hold'))*1000,...(value('performance-gesture-variant')!==''?{variant:Number(value('performance-gesture-variant'))}:{})}:{}),
      ...(value('performance-body')?{body_motion:value('performance-body'),body_strength:Number(value('performance-body-strength')),body_hold_ms:Number(value('performance-body-hold'))*1000,...(value('performance-body-variant')!==''?{body_variant:Number(value('performance-body-variant'))}:{})}:{})}).catch(show);
  };
  get('performance-direct').onclick=()=>command('performance.direct',{emotion:value('performance-emotion'),intensity:Number(value('performance-strength')),hold_ms:Number(value('performance-hold'))*1000,...(value('performance-expression')?{expression:value('performance-expression')}:{})}).catch(show);
  get('performance-release').onclick=()=>command('performance.release').catch(show);
  get('appearance-apply').onclick=()=>command('appearance.update',{glasses:value('appearance-glasses'),skirt:value('appearance-skirt'),body:value('appearance-body'),shoes:get<HTMLInputElement>('appearance-shoes').checked,tail:get<HTMLInputElement>('appearance-tail').checked,chest:get<HTMLInputElement>('appearance-chest').checked?'alternate':'default'}).catch(show);
  command('performance.status').then(s=>{semantic=!!s.semantic_planner;
    if(semantic){document.body.classList.add('semantic-mode');get('latent-panel').hidden=true;
      const tools=document.createElement('details');tools.id='semantic-manual-tools';tools.innerHTML='<summary>手动调整动作、表情和外观</summary>';
      const groups=[...document.querySelectorAll<HTMLElement>('#performance-panel .performance-director')];groups[0]?.before(tools);for(const group of groups)tools.append(group);
      get('performance-title').textContent='本地语义表演';get('semantic-inputs').style.display='block';get('performance-play').textContent='开始语义表演';const text=get<HTMLTextAreaElement>('performance-text');text.maxLength=300;text.placeholder='整段台词一次规划、连续播放，最多300字。';get('performance-kind').parentElement!.style.display='none';const backend=get<HTMLSelectElement>('performance-backend');backend.value='groups';backend.disabled=true;get('performance-status').textContent=s.ready?'本地语义模型已就绪 · 整段连续播放':'本地语义模型未就绪';get('performance-message').textContent='填写完整台词，可补充观众发言、语境和导演要求。';}
    else{get('performance-status').textContent=s.ready?(s.promoted?'默认方案 · v4-default-r1 · 4B 语义与协调动作':s.run?.performance_planner?'组合选择器已训练 · 研究方案':s.run?.human_calibrated?'表情已按评分校准 · 身体待验收':'已训练候选 · 待人工校准'):s.reason??'模型未就绪';get('performance-message').textContent=s.promoted?'已设为默认。说话时自动配合手势、身体与表情；外观由显式设置保持。':'当前为研究方案，默认配置保留。';}
    for(const option of get<HTMLSelectElement>('performance-kind').options)if(s.run?.eligibility?.[option.value]?.status==='rejected'){option.disabled=true;option.textContent+='（幅度检查未通过）';}}).catch(show);
  setInterval(()=>{if(session)command('performance.state').then(s=>{
    get('performance-details').textContent=JSON.stringify(s,null,2);const phase=s.queue?.phase;
    const parts=[s.motion_actions?.active?s.motion_actions.label:'',s.body_action?.active?s.body_action.label:''].filter(Boolean);
    const messages:Record<string,string>={planning:'正在理解台词并准备语音，请稍候…',synthesizing:'正在准备语音…',playing:'正在播放，表情和动作随语音执行。',finished:'本次表演已完成。',cancelled:'已停止；外观保持。',waiting:'等待下一句台词…'};
    get('performance-current').textContent=phase==='finished'?'表演已完成，角色保持待机。':phase==='cancelled'?'表演已停止。':phase==='planning'?'正在理解台词并准备语音…':parts.length?'当前表演：'+parts.join(' ＋ '):'正在自然说话，保留情绪和姿态。';
    const p=s.semantic?.plan;get('semantic-reading').textContent=p?'整段理解：'+p.meaning:'';
    if(s.queue?.error)show(s.queue.error);else if(messages[phase])get('performance-message').textContent=messages[phase];
  }).catch(()=>{});},1000);
}
