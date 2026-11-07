import {randomUUID} from 'node:crypto';
import {DEFAULT_MOTION_STYLE} from '../src/motor';
import {validatePlan} from '../src/performance-plan';
import {validateEmotionTimeline} from '../src/emotion-curve';
import {bufferedAudio} from './audio-stream';
import {semanticClauses,utteranceEnd,type ClauseSpan} from './utterance';
import {candidatePlan,type ReviewPlayback} from './review-candidates';
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const invalid=(message:string):never=>{throw Object.assign(new Error(message),{code:'invalid_performance'});};
type Utterance={index:number;text:string;clauses:ClauseSpan[];queuedAt:number;bufferWaitMs:number};
type PlanRow=ClauseSpan&{start_fraction:number;feature_id:string};
type Current=Utterance&{audio:{at:number;value:number[]}[];plans:PlanRow[]};
type Session={id:string;seq:number;buffer:string;bufferStartedAt:number;queue:Utterance[];nextClause:number;nextUtterance:number;finished:boolean;cancelled:boolean;abort:AbortController;phase:string;context:string;recent:string[];seed:number;error?:string;current?:Current;metrics:any[];review?:ReviewPlayback};
type Prepared={next:Utterance;context:string;prefill:any;audio:ReturnType<typeof bufferedAudio>;duration?:number;ttsStarted:number;firstPcmAt?:number;synthesisEndAt?:number};

/** One production driver: emotion + motion plans, independent from speech units. */
export class PerformanceService{
  private session:Session|null=null;
  private pending=new Map<string,{key:string;promise:Promise<any>}>();
  private commandTail:Promise<unknown>=Promise.resolve();
  constructor(private invoke:(command:any)=>Promise<any>){}
  private async worker(path:string,body?:any,signal?:AbortSignal){
    const response=await fetch((process.env.LATENT_URL??'http://127.0.0.1:8768')+path,{...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(120000)]):AbortSignal.timeout(2500)});
    const result:any=await response.json();if(!response.ok)throw Object.assign(new Error(result.error??'表演模型请求失败'),{httpStatus:response.status});return result;
  }
  private async infer(s:Session,path:string,body:any){
    for(let attempt=0;;attempt++){try{return await this.worker(path,body,s.abort.signal);}catch(error:any){if(error.httpStatus!==429||s.cancelled||attempt>=200)throw error;await sleep(30);}}
  }
  async status(){try{return await this.worker('/stream/status');}catch{return {ready:false,reason:'表演模型未连接'};}}
  private own(id:any){const s=this.session;if(!s||s.id!==id||s.cancelled)throw Object.assign(new Error('会话已取消或不存在'),{code:'performance_cancelled'});return s;}
  private async execute(method:string,params:any,review?:ReviewPlayback){
    if(method==='performance.status')return this.status();
    if(method==='performance.start'){
      if(this.session&&!this.session.cancelled&&!['finished','error'].includes(this.session.phase))invalid('已有表演会话，请先结束或取消');
      if(Object.keys(params).some(key=>!['context','seed','motion_style'].includes(key)))invalid('会话只接受语境、种子与表演风格');
      if(params.context!==undefined&&(typeof params.context!=='string'||params.context.length>800))invalid('context 过长');
      if(params.seed!==undefined&&(!Number.isInteger(params.seed)||params.seed<0||params.seed>=2**31))invalid('seed 不合法');
      if(params.motion_style!==undefined&&!['restrained','natural','lively'].includes(params.motion_style))invalid('motion_style 不合法');
      const [status,current]=await Promise.all([this.status(),this.invoke({method:'state.get'})]);
      if(!status.ready)throw Object.assign(new Error(status.reason??'表演模型尚未就绪'),{httpStatus:503});
      if(!current.result.speech.enabled)invalid('请先点击页面启用声音');if(current.result.recording)invalid('请先保存当前录制');
      const s:Session={id:randomUUID().replaceAll('-',''),seq:0,buffer:'',bufferStartedAt:0,queue:[],nextClause:0,nextUtterance:0,finished:false,cancelled:false,abort:new AbortController(),phase:'waiting',context:params.context??'',recent:[],seed:params.seed??41,metrics:[]};
      s.review=review;
      await this.invoke({method:'performance.begin',params:{session_id:s.id,motion_style:params.motion_style??DEFAULT_MOTION_STYLE,motion_backend:'groups',driver:'emotion'}});this.session=s;
      void this.pump(s).catch(async error=>{if(!s.cancelled){s.error=error.message;s.phase='error';s.cancelled=true;s.abort.abort();await this.invoke({method:'performance.end',params:{session_id:s.id}}).catch(()=>{});}});
      return {session_id:s.id,next_seq:0,experimental:status.experimental??false,promoted:status.promoted??false};
    }
    if(method==='performance.state'){
      const s=this.session,browser=(await this.invoke({method:'performance.state'})).result;
      return {...browser,queue:s?{phase:s.phase,pending:s.queue.length,buffered_chars:s.buffer.length,next_seq:s.seq,input_finished:s.finished,error:s.error,metrics:s.metrics.slice(-80)}:null};
    }
    if(method==='performance.append'||method==='performance.finish'){
      const s=this.own(params.session_id);if(!Number.isInteger(params.seq)||params.seq!==s.seq)invalid(`seq 应为 ${s.seq}`);if(s.finished)invalid('输入已经结束');
      const delta=params.text??'';if(typeof delta!=='string'||delta.length>2000)invalid('每次追加最多 2000 字');if(params.flush!==undefined&&typeof params.flush!=='boolean')invalid('flush 必须为布尔值');
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
  startReview(context:string,review:ReviewPlayback){
    const promise=this.commandTail.then(()=>this.execute('performance.start',{context,seed:41,motion_style:'lively'},review));
    this.commandTail=promise.catch(()=>{});return promise;
  }
  async command(command:any){
    if(command.params!==undefined&&(!command.params||typeof command.params!=='object'||Array.isArray(command.params)))invalid('params 必须为对象');
    const id=command.request_id??randomUUID(),key=JSON.stringify([command.method,command.params??{}]);if(typeof id!=='string'||!id.length||id.length>128)invalid('request_id 不合法');
    const old=this.pending.get(id);if(old){if(old.key!==key)invalid('request_id 已用于不同命令');return old.promise;}
    const promise=this.commandTail.then(()=>this.execute(command.method,command.params??{})).then(result=>({status:'applied',request_id:id,result}));this.commandTail=promise.catch(()=>{});
    this.pending.set(id,{key,promise});while(this.pending.size>512)this.pending.delete(this.pending.keys().next().value!);return promise;
  }
  private split(s:Session,flush:boolean){
    while(s.buffer.length){
      const end=utteranceEnd(s.buffer,flush);if(!end)break;
      const text=s.buffer.slice(0,end).trim();s.buffer=s.buffer.slice(end);const queuedAt=Date.now();
      if(text){const clauses=semanticClauses(text,s.nextClause);s.nextClause+=clauses.length;s.queue.push({index:s.nextUtterance++,text,clauses,queuedAt,bufferWaitMs:queuedAt-s.bufferStartedAt});}
      if(!s.buffer.length)s.bufferStartedAt=0;
    }
  }
  private async prepare(s:Session,next:Utterance,previous:string[]=[]):Promise<Prepared>{
    const history=[...s.recent,...previous].filter(Boolean).slice(-3).join('\n');
    const context=[s.context,history.slice(-Math.max(0,1199-s.context.length))].filter(Boolean).join('\n');
    const emotionContext=[...s.recent,...previous].at(-1)??'';
    const prefill=this.infer(s,'/stream/prefill',{session_id:s.id,text:next.text,context,emotion_context:emotionContext,clauses:next.clauses}).then(value=>{
      if(!Array.isArray(value.clauses)||value.clauses.length!==next.clauses.length)throw new Error('语义特征分段不完整');
      value.clauses=value.clauses.map((row:any,i:number)=>{
        const span=next.clauses[i];if(row.clause!==span.clause||row.text!==span.text||row.start!==span.start||row.end!==span.end)throw new Error('表演计划与台词不匹配');
        if(typeof row.feature_id!=='string'||!/^[a-f0-9]{32}$/.test(row.feature_id))throw new Error('缺少语义特征');
        return row;
      });value.affect_timeline=validateEmotionTimeline(value.affect_timeline,next.text);return value;
    });
    void prefill.catch(()=>s.abort.abort());
    try{
      if(s.review){
        const review=s.review,speechId=randomUUID().replaceAll('-','');
        const events=async function*(){for(const event of review.events){if(s.abort.signal.aborted)throw s.abort.signal.reason;yield {...event,speech_id:speechId};}};
        return {next,context,prefill:await prefill,audio:{events:events(),close:async()=>{}},duration:review.duration,ttsStarted:Date.now()};
      }
      for(let attempt=0;attempt<200;attempt++){
        if(s.cancelled)throw new Error('会话已取消');
        const health:any=await(await fetch((process.env.TTS_URL??'http://127.0.0.1:8769')+'/health',{signal:s.abort.signal})).json();if(!health.busy)break;await sleep(40);
      }
      const ttsStarted=Date.now();
      const response=await fetch((process.env.TTS_URL??'http://127.0.0.1:8769')+'/stream',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:next.text,seed:s.seed}),signal:s.abort.signal});
      if(!response.ok)throw new Error((await response.json() as any).error??'TTS 失败');if(!response.body)throw new Error('TTS 没有返回音频');
      const prepared:Prepared={next,context,prefill:null,audio:null!,ttsStarted};
      prepared.audio=bufferedAudio(response.body,prefill,event=>{
        if(event.type==='chunk'&&prepared.firstPcmAt===undefined)prepared.firstPcmAt=Date.now();
        if(event.type==='end'){prepared.synthesisEndAt=Date.now();prepared.duration=event.total_samples/event.sample_rate*1000;if(!Number.isFinite(prepared.duration)||prepared.duration<=0||prepared.duration>90000)throw new Error('语音时长不合法');}
      },()=>s.abort.abort());
      try{prepared.prefill=await prefill;}catch(error){await prepared.audio.close();throw error;}
      s.metrics.push({utterance:next.index,semantic_prefill_ms:prepared.prefill.semantic_ms,planner_timing:prepared.prefill.planner_timing,overlapped_with_tts:true});
      return prepared;
    }catch(error){s.abort.abort();throw error;}
  }
  private async motion(s:Session,current:Current,baseMs:number,context:string){
    const planned=new Set<number>();let lastMotion=-Infinity;
    while(!s.cancelled&&s.current===current){
      const begin=performance.now(),state=(await this.invoke({method:'performance.state'})).result;
      if(state.session_id!==s.id||!state.active){s.cancelled=true;s.phase='cancelled';s.abort.abort();return;}
      const clause=current.plans.find(c=>c.clause===state.clause);
      if(!clause||!state.clause_started||state.playback_phase!=='playing'){await sleep(30);continue;}
      const handle={session_id:s.id,feature_id:clause.feature_id,clause:clause.clause};
      if(!planned.has(clause.clause)){
        planned.add(clause.clause);
        const input={affect:state.affect_vector,planner_state:state.planner_state,motion_style:state.motion_style,audio_ms:state.media_ms-baseMs};
        const prediction=await this.infer(s,'/stream/plan',{...handle,...input});
        if(s.cancelled||s.current!==current)return;
        const original=validatePlan(prediction.plan,clause.clause),plan=s.review?candidatePlan(original,state.affect_vector,s.review.candidate):original;
        const offered=(await this.invoke({method:'performance.plan.offer',params:{session_id:s.id,speech_id:state.speech_id,clause:clause.clause,plan,input:{...input,...(s.review?{review_candidate:s.review.candidate,model_plan:original}:{})},authored_body:!!s.review}})).result;
        s.metrics.push({utterance:current.index,clause:clause.clause,event_compute_ms:prediction.timing.total_compute_ms,offered:offered.accepted});
      }
      if(performance.now()-lastMotion<400){await sleep(30);continue;}
      const time=state.motion_ms??state.media_ms,start=Math.max(time+70,state.committed_until_ms);if(start>time+650){await sleep(80);continue;}
      const audio:number[][]=[],mask:number[]=[];
      for(let i=0;i<24;i++){
        const at=state.media_ms-baseMs+start-time+i*50;let found:typeof current.audio[number]|undefined;
        for(const row of current.audio){if(row.at>at)break;found=row;}const available=!!found&&at-found.at<70;audio.push(available?found!.value:Array(12).fill(0));mask.push(available?1:0);
      }
      lastMotion=performance.now();
      const prediction=await this.infer(s,'/stream/predict',{...handle,state:state.values,history:state.history,audio,audio_mask:mask,affect:state.affect_vector,motion_phase:[0,3.4,0,(start-time)/1000]});
      if(s.cancelled||s.current!==current)return;
      const result=(await this.invoke({method:'performance.chunk',params:{...prediction,session_id:s.id,start_ms:start}})).result;
      s.metrics.push({utterance:current.index,compute_ms:prediction.timing.total_compute_ms,roundtrip_ms:performance.now()-begin,accepted:result.accepted});
      await sleep(25);
    }
  }
  private async pump(s:Session){
    let lookahead:Promise<Prepared>|null=null,playing:Prepared|undefined;
    try{while(!s.cancelled){
      if(!lookahead&&!s.queue.length){if(s.finished){s.phase='finished';return;}await sleep(40);continue;}
      s.phase='synthesizing';const prepared=lookahead?await lookahead:await this.prepare(s,s.queue.shift()!);lookahead=null;playing=prepared;
      if(s.cancelled)return;
      const next=prepared.next,current:Current={...next,audio:[],plans:prepared.prefill.clauses};let motion:Promise<void>|undefined,end=false;
      try{
        for await(const event of prepared.audio.events){
          if(s.cancelled)return;if(s.abort.signal.aborted)throw s.abort.signal.reason;
          if(event.type==='start'){
            await this.invoke({method:'speech.stream.begin',params:{...event,performance_session_id:s.id,follow:next.index>0}});
            const state=(await this.invoke({method:'performance.utterance',params:{session_id:s.id,speech_id:event.speech_id,text:next.text,clauses:current.plans.map(row=>({clause:row.clause,text:row.text,start_fraction:row.start_fraction})),affect_timeline:prepared.prefill.affect_timeline,audio_duration_ms:prepared.duration??event.estimated_duration_ms,audio_duration_final:prepared.duration!==undefined}})).result;
            s.current=current;motion=this.motion(s,current,state.media_ms,prepared.context);void motion.catch(error=>s.abort.abort(error));
          }else if(event.type==='chunk'){
            for(let i=0;i<(event.mouth.motion??[]).length;i++)current.audio.push({at:event.offset_samples/event.sample_rate*1000+event.mouth.motion_times_ms[i],value:event.mouth.motion[i]});
            await this.invoke({method:'speech.stream.append',params:event});s.phase='playing';
            if(event.index===0)s.metrics.push({utterance:next.index,first_chunk_ms:Date.now()-next.queuedAt,synthesis_to_first_chunk_ms:(prepared.firstPcmAt??Date.now())-prepared.ttsStarted});
          }else if(event.type==='end'){
            await this.invoke({method:'speech.stream.finish',params:{speech_id:event.speech_id,total_samples:event.total_samples}});end=true;
            s.metrics.push({utterance:next.index,synthesis_ms:(prepared.synthesisEndAt??Date.now())-prepared.ttsStarted,audio_duration_ms:prepared.duration,continuous_utterance:true,clauses:current.plans.length});
          }
        }
        if(!end)throw new Error('TTS 流被截断');
        while(!s.cancelled){
          if(s.abort.signal.aborted)throw s.abort.signal.reason;
          if(!lookahead&&s.queue.length){lookahead=this.prepare(s,s.queue.shift()!,[next.text]);void lookahead.catch(()=>{});}
          const state=(await this.invoke({method:'state.get'})).result;
          if(!state.performance.active||state.performance.session_id!==s.id){s.cancelled=true;s.phase='cancelled';s.abort.abort();break;}
          const moving=state.performance.motion_actions?.active||state.performance.body_action?.active;
          if(!state.speech.active&&(lookahead||!moving))break;await sleep(40);
        }
      }finally{s.current=undefined;await motion;await prepared.audio.close();playing=undefined;}
      s.recent=[...s.recent,next.text].slice(-2);if(!s.cancelled)s.phase='waiting';
    }}finally{
      if(s.cancelled||s.abort.signal.aborted){s.abort.abort();if(playing)await playing.audio.close();if(lookahead)await lookahead.then(value=>value.audio.close()).catch(()=>{});}
    }
  }
  disconnect(){const s=this.session;if(s){s.cancelled=true;s.phase='cancelled';s.abort.abort();}this.pending.clear();}
}
