import { randomUUID } from 'node:crypto';
import { jsonLines } from './ndjson';
import { emotions } from '../src/performance-profile';

const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const invalid=(message:string):never=>{throw Object.assign(new Error(message),{code:'invalid_performance'});};
type Session={id:string;seq:number;buffer:string;bufferStartedAt:number;queue:{index:number;text:string;queuedAt:number;bufferWaitMs:number}[];nextClause:number;finished:boolean;
  cancelled:boolean;abort:AbortController;phase:string;context:string;recent:string[];kind:string;seed:number;error?:string;
  current?:{index:number;text:string;audio:{at:number;value:number[]}[]};metrics:any[];started:number};

/** One actor, one cancellable text queue. Synthesis never waits for motion inference. */
export class PerformanceService {
  private session:Session|null=null;
  private pending=new Map<string,{key:string;promise:Promise<any>}>();
  private commandTail:Promise<unknown>=Promise.resolve();
  constructor(private invoke:(command:any)=>Promise<any>){}
  private async worker(path:string,body?:any,signal?:AbortSignal){
    const r=await fetch((process.env.LATENT_URL??'http://127.0.0.1:8768')+path,{...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(2500)});
    const result:any=await r.json();if(!r.ok)throw new Error(result.error??'v4 推理失败');return result;
  }
  async status(){try{return await this.worker('/stream/status')}catch{return {ready:false,experimental:true,reason:'动作服务未连接'}}}
  private own(id:any){const s=this.session;if(!s||s.id!==id||s.cancelled)throw Object.assign(new Error('会话已取消或不存在'),{code:'performance_cancelled'});return s;}
  private async execute(method:string,params:any){
    if(method==='performance.status')return this.status();
    if(method==='performance.start'){
      if(this.session&&!this.session.cancelled&&this.session.phase!=='finished'&&this.session.phase!=='error')invalid('已有表演会话，请先结束或取消');
      if(params.kind!==undefined&&!['regression','flow'].includes(params.kind))invalid('kind 不合法');
      if(params.context!==undefined&&(typeof params.context!=='string'||params.context.length>800))invalid('context 过长');
      if(params.seed!==undefined&&(!Number.isInteger(params.seed)||params.seed<0||params.seed>=2**31))invalid('seed 不合法');
      if(params.motion_style!==undefined&&!['restrained','natural','lively'].includes(params.motion_style))invalid('motion_style 不合法');
      const status=await this.status();if(!status.ready)throw Object.assign(new Error(status.reason??'请先训练 v4 候选检查点'),{httpStatus:503});
      const state=(await this.invoke({method:'state.get'})).result;if(!state.speech.enabled)invalid('请先在页面启用声音');
      if(state.recording)invalid('请先保存当前录制');
      const s:Session={id:randomUUID().replaceAll('-',''),seq:0,buffer:'',bufferStartedAt:0,queue:[],nextClause:0,finished:false,cancelled:false,abort:new AbortController(),
        phase:'waiting',context:params.context??'',recent:[],kind:params.kind??'regression',seed:params.seed??41,metrics:[],started:Date.now()};
      await this.invoke({method:'performance.begin',params:{session_id:s.id,motion_style:params.motion_style??'restrained'}});this.session=s;
      void this.pump(s).catch(async error=>{if(!s.cancelled){s.error=error.message;s.phase='error';s.cancelled=true;s.abort.abort();await this.invoke({method:'performance.end',params:{session_id:s.id}}).catch(()=>{});}});
      return {session_id:s.id,next_seq:0,experimental:true};
    }
    if(method==='performance.state'){
      const s=this.session;const browser=(await this.invoke({method:'performance.state'})).result;
      return {...browser,queue:s?{phase:s.phase,pending:s.queue.length,buffered_chars:s.buffer.length,next_seq:s.seq,input_finished:s.finished,error:s.error,metrics:s.metrics.slice(-80)}:null};
    }
    if(method==='performance.append'||method==='performance.finish'){
      const s=this.own(params.session_id);
      if(!Number.isInteger(params.seq)||params.seq!==s.seq)invalid(`seq 应为 ${s.seq}`);
      if(s.finished)invalid('输入已经结束');
      const delta=params.text??'';if(typeof delta!=='string'||delta.length>2000)invalid('每次追加最多 2000 字');
      if(params.flush!==undefined&&typeof params.flush!=='boolean')invalid('flush 必须为布尔值');
      if(s.buffer.length+delta.length+s.queue.reduce((n,c)=>n+c.text.length,0)>12000)invalid('待播放文本已满');
      if(!s.buffer.length&&delta.length)s.bufferStartedAt=Date.now();s.buffer+=delta;s.seq++;
      const final=method==='performance.finish';this.split(s,final||params.flush===true);if(final)s.finished=true;
      return {session_id:s.id,next_seq:s.seq,queued:s.queue.length,buffered_chars:s.buffer.length};
    }
    if(method==='performance.cancel'){
      const s=this.own(params.session_id);s.cancelled=true;s.phase='cancelled';s.abort.abort();s.queue=[];s.buffer='';
      await this.invoke({method:'performance.end',params:{session_id:s.id}});return {cancelled:true};
    }
    return (await this.invoke({method,params})).result;
  }
  handles(method:string){return ['performance.start','performance.append','performance.finish','performance.cancel','performance.state','performance.status'].includes(method);}
  async command(command:any){
    if(command.params!==undefined&&(!command.params||typeof command.params!=='object'||Array.isArray(command.params)))invalid('params 必须为对象');
    const id=command.request_id??randomUUID(),key=JSON.stringify([command.method,command.params??{}]);
    if(typeof id!=='string'||!id.length||id.length>128)invalid('request_id 不合法');
    const old=this.pending.get(id);if(old){if(old.key!==key)invalid('request_id 已用于不同命令');return old.promise;}
    const promise=this.commandTail.then(()=>this.execute(command.method,command.params??{})).then(result=>({status:'applied',request_id:id,result}));
    this.commandTail=promise.catch(()=>{});
    this.pending.set(id,{key,promise});while(this.pending.size>512)this.pending.delete(this.pending.keys().next().value!);return promise;
  }
  private split(s:Session,flush:boolean){
    while(s.buffer.length){
      const match=/[。！？!?；;，,\n]/.exec(s.buffer);let end=match?match.index+1:0;
      if(!end&&s.buffer.length>=240)end=240;if(!end&&flush)end=s.buffer.length;if(!end)break;end=Math.min(240,end);
      const text=s.buffer.slice(0,end).trim();s.buffer=s.buffer.slice(end);const queuedAt=Date.now();
      if(text)s.queue.push({index:s.nextClause++,text,queuedAt,bufferWaitMs:queuedAt-s.bufferStartedAt});if(!s.buffer.length)s.bufferStartedAt=0;
    }
  }
  private async motion(s:Session,clause:{index:number;text:string;audio:{at:number;value:number[]}[]},baseMs:number){
    while(!s.cancelled&&s.current===clause){
      const begin=performance.now(),state=(await this.invoke({method:'performance.state'})).result;
      if(state.session_id!==s.id||!state.active){s.cancelled=true;s.phase='cancelled';s.abort.abort();return;}
      const start=Math.max(state.media_ms+70,state.committed_until_ms);
      if(start>state.media_ms+650){await sleep(80);continue;}
      const audio:number[][]=[],mask:number[]=[];
      for(let i=0;i<24;i++){
        const at=start-baseMs+i*50;let found:typeof clause.audio[number]|undefined;
        for(const row of clause.audio){if(row.at>at)break;found=row;}
        const available=!!found&&at-found.at<70;audio.push(available?found!.value:Array(12).fill(0));mask.push(available?1:0);
      }
      const director=Array(9).fill(0);const cues=state.directives.filter((c:any)=>c.started).slice(-1);
      if(cues.length){const cue=cues[0];if(cue.emotion){director[emotions.indexOf(cue.emotion)]=cue.intensity;director[7]=cue.intensity;director[8]=1;}}
      const context=[s.context,...s.recent.slice(-2),...cues.map((c:any)=>c.gesture_hint??'')].filter(Boolean).join('\n').slice(-1200);
      const motor_context=[s.context,...cues.map((c:any)=>c.gesture_hint??'')].filter(Boolean).join('\n').slice(-1200);
      const names=['黑脸','流泪','脸红','加载','兔牙','流冷汗'];const face_state=names.map(n=>state.expressions[n]??0);
      const eyes=['normal','＞＜','圈圈眼','爱心眼','屑屑眼'];let selected=0;for(let i=1;i<eyes.length;i++)if((state.expressions[eyes[i]]??0)>.15)selected=i;
      face_state.push(selected?(state.expressions[eyes[selected]]??0):0,...eyes.map((_,i)=>i===selected?1:0));
      let prediction:any;
      try{prediction=await this.worker('/stream/predict',{text:clause.text,context,motor_context,kind:s.kind,seed:(s.seed+clause.index*1009+Math.round(start/400))%(2**31),
        state:state.values,history:state.history,audio,audio_mask:mask,director,face_state},s.abort.signal);}
      catch(error){if(s.cancelled)return;throw error;}
      if(s.cancelled||s.current!==clause)return;
      const result=(await this.invoke({method:'performance.chunk',params:{...prediction,session_id:s.id,start_ms:start}})).result;
      s.metrics.push({clause:clause.index,compute_ms:prediction.timing.total_compute_ms,roundtrip_ms:performance.now()-begin,accepted:result.accepted,media_ms:state.media_ms});
      if(s.metrics.length>1000)s.metrics.shift();await sleep(Math.max(10,400-(performance.now()-begin)));
    }
  }
  private async pump(s:Session){
    while(!s.cancelled){
      const next=s.queue.shift();if(!next){if(s.finished){s.phase='finished';return;}await sleep(40);continue;}
      s.phase='synthesizing';const started=Date.now();s.metrics.push({clause:next.index,text_wait_ms:next.bufferWaitMs,queue_wait_ms:started-next.queuedAt});
      const current=(await this.invoke({method:'performance.state'})).result;
      const hints=current.directives.filter((c:any)=>c.started).slice(-1).map((c:any)=>c.gesture_hint??'');
      const context=[s.context,...s.recent.slice(-2),...hints].filter(Boolean).join('\n').slice(-1200);
      const motor_context=[s.context,...hints].filter(Boolean).join('\n').slice(-1200);
      const prefill=await this.worker('/stream/prefill',{text:next.text,context,motor_context},s.abort.signal);
      s.metrics.push({clause:next.index,semantic_prefill_ms:prefill.semantic_ms});
      for(let attempt=0;attempt<100;attempt++){
        if(s.cancelled)return;
        const health:any=await(await fetch((process.env.TTS_URL??'http://127.0.0.1:8769')+'/health',{signal:s.abort.signal})).json();
        if(!health.busy)break;await sleep(50);
      }
      const ttsStarted=Date.now();
      const response=await fetch((process.env.TTS_URL??'http://127.0.0.1:8769')+'/stream',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:next.text,seed:s.seed}),signal:s.abort.signal});
      if(!response.ok)throw new Error((await response.json() as any).error??'TTS 失败');if(!response.body)throw new Error('TTS 没有返回音频');
      let motion:Promise<void>|undefined,end=false;const clause={...next,audio:[] as {at:number;value:number[]}[]};
      try{
        for await(const event of jsonLines(response.body)){
          if(s.cancelled)return;
          if(event.type==='error')throw new Error(event.error);
          if(event.type==='start'){
            await this.invoke({method:'speech.stream.begin',params:{...event,performance_session_id:s.id}});
            const segment=(await this.invoke({method:'performance.segment',params:{session_id:s.id,clause:next.index,text:next.text,speech_id:event.speech_id}})).result;
            s.current=clause;motion=this.motion(s,clause,segment.media_ms);motion.catch(()=>{});
          }else if(event.type==='chunk'){
            const features=event.mouth.motion??[],times=event.mouth.motion_times_ms??[];
            for(let i=0;i<features.length;i++)clause.audio.push({at:event.offset_samples/event.sample_rate*1000+times[i],value:features[i]});
            await this.invoke({method:'speech.stream.append',params:event});s.phase='playing';
            if(event.index===0)s.metrics.push({clause:next.index,first_chunk_ms:Date.now()-started,synthesis_to_first_chunk_ms:Date.now()-ttsStarted});
          }else if(event.type==='end'){await this.invoke({method:'speech.stream.finish',params:{speech_id:event.speech_id,total_samples:event.total_samples}});s.metrics.push({clause:next.index,synthesis_ms:Date.now()-ttsStarted});end=true;}
        }
        if(!end)throw new Error('TTS 流被截断');
        while(!s.cancelled){const state=(await this.invoke({method:'state.get'})).result;
          if(!state.performance.active||state.performance.session_id!==s.id){s.cancelled=true;s.phase='cancelled';s.abort.abort();break;}
          if(!state.speech.active)break;await sleep(60);}
      }finally{s.current=undefined;await motion;}
      s.recent.push(next.text);s.recent=s.recent.slice(-2);if(!s.cancelled)s.phase='waiting';
    }
  }
  disconnect(){const s=this.session;if(s){s.cancelled=true;s.phase='cancelled';s.abort.abort();}this.pending.clear();}
}
