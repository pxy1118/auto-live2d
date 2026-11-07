import './style.css';
import {Live2DEngine} from './engine';
import {mountPerformance} from './performance-panel';
import {mountReview} from './review-panel';

const app=document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML=`
  <header class="app-header">
    <a class="brand" href="/" aria-label="Live2D 首页"><span class="brand-mark">a<span>↗</span></span><span>Live2D<small>让声音有表情</small></span></a>
    <div class="connection-tools"><a class="text-button" href="${location.pathname==='/review'?'/':'/review'}">${location.pathname==='/review'?'返回说话':'表演评分'}</a><button id="claim-runtime" class="text-button" hidden>在此窗口使用</button><span id="connection" class="connection" role="status"><i></i><span>正在连接</span></span></div>
  </header>
  <main class="workspace">
    <section class="stage-shell" aria-label="角色预览">
      <div class="stage-heading"><span class="actor-name"><i></i>大肥鱼</span><div class="view-switch" aria-label="预览视角"><button id="full-view" class="active" aria-pressed="true">全身</button><button id="portrait-view" aria-pressed="false">半身</button></div></div>
      <div id="stage" class="stage"><canvas id="model-canvas" aria-label="大肥鱼 Live2D 实时预览"></canvas><div id="loading" class="loading"><span class="loader-ring"></span><strong id="loading-label">正在准备角色</strong><div class="progress-track"><span id="progress"></span></div><p>稍等一下，马上就好。</p></div></div>
      <div class="stage-footer"><span id="current-line">准备好，就开始聊天吧。</span><span class="stage-note">实时表演</span></div>
    </section>
    <section id="performance-panel" class="composer" aria-label="说话与表演"></section>
  </main>
  <footer class="app-footer"><span>语音、表情与动作，一起自然发生。</span><span>角色原画：神宫凉子</span></footer>`;

const get=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const engine=new Live2DEngine(get<HTMLCanvasElement>('model-canvas'),(message,percent)=>{
  get('loading-label').textContent=message;get('progress').style.width=`${percent}%`;
});
let capabilities:any,socket:WebSocket,isConnected=false;
let claim:{promise:Promise<void>;resolve:()=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}|null=null;
function connection(label:string,ready=false){get('connection').classList.toggle('ready',ready);get('connection').querySelector('span')!.textContent=label;}
function connect(){
  socket=new WebSocket(`ws://${location.host}/ws`);
  socket.onopen=()=>socket.send(JSON.stringify({type:'hello',role:'runtime',capabilities}));
  socket.onmessage=async event=>{
    const message=JSON.parse(event.data);
    if(message.type==='connected'){
      isConnected=true;connection('角色已就绪',true);get('claim-runtime').hidden=true;
      if(claim){clearTimeout(claim.timer);claim.resolve();claim=null;}
    }else if(message.type==='command'){
      try{const response=await engine.command(message);socket.send(JSON.stringify({type:'result',request_id:message.request_id,response}));}
      catch(error:any){socket.send(JSON.stringify({type:'result',request_id:message.request_id,error:{code:error.code??'command_failed',message:error.message}}));}
    }else if(message.type==='busy'){
      isConnected=false;connection('其他窗口正在使用');get('claim-runtime').hidden=false;
      if(claim){clearTimeout(claim.timer);claim.reject(new Error(message.message));claim=null;}
    }
  };
  socket.onclose=()=>{
    isConnected=false;connection('正在重新连接');get('claim-runtime').hidden=true;void engine.command({method:'speech.stop'}).catch(()=>{});
    if(claim){clearTimeout(claim.timer);claim.reject(new Error('连接已断开，请稍后重试'));claim=null;}
    setTimeout(connect,1500);
  };
}
function claimRuntime(){
  if(isConnected)return Promise.resolve();
  if(claim)return claim.promise;
  if(!socket||socket.readyState!==WebSocket.OPEN)return Promise.reject(new Error('角色还在连接，请稍后再试'));
  let resolve!:()=>void,reject!:(error:Error)=>void;
  const promise=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});
  const timer=setTimeout(()=>{claim=null;reject(new Error('连接角色超时，请重试'));},5000);
  claim={promise,resolve,reject,timer};socket.send(JSON.stringify({type:'hello',role:'runtime',capabilities,takeover:true}));return promise;
}
async function preparePerformance(){
  // Start audio activation within the user's click, before awaiting connection.
  const audio=engine.command({method:'speech.unlock'});await Promise.all([audio,claimRuntime()]);
}
const panel=(location.pathname==='/review'?mountReview:mountPerformance)({prepare:preparePerformance,ready:()=>engine.ready,connected:()=>isConnected,onState:state=>{
  get('current-line').textContent=state.queue?.phase==='playing'&&state.text?state.text:'准备好，就开始聊天吧。';
}});
get('claim-runtime').onclick=()=>{void preparePerformance().catch(error=>panel.showError(error));};
for(const framing of ['full','portrait'] as const)get(`${framing}-view`).onclick=()=>{
  engine.framing=framing;
  for(const name of ['full','portrait']){get(`${name}-view`).classList.toggle('active',name===framing);get(`${name}-view`).setAttribute('aria-pressed',String(name===framing));}
};
try{capabilities=await engine.initialize();get('loading').hidden=true;connect();}
catch(error:any){get('loading').classList.add('failed');get('loading-label').textContent='角色载入失败';get('loading').querySelector('p')!.textContent=error.message;connection('连接失败');panel.showError(error);}
(window as any).live2dDemo={engine,get ready(){return engine.ready&&isConnected;}};
