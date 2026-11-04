import { LatentBridge } from './latent-bridge';
import { jsonLines } from './ndjson';

export class SpeechBridge {
  private prepared=new Map<string,{audio:any;trajectory:any;created:number;busy:boolean}>();
  private performing=false;
  constructor(private latent:LatentBridge,private invoke:(command:any)=>Promise<any>){}
  private async worker(path:string,body?:any){
    const response=await fetch((process.env.TTS_URL??'http://127.0.0.1:8769')+path,{
      ...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),
      signal:AbortSignal.timeout(body===undefined?2500:180000)});
    const data:any=await response.json();
    if(!response.ok)throw Object.assign(new Error(data.error??'语音服务失败'),{httpStatus:response.status});
    return data;
  }
  async status(){try{return await this.worker('/health')}catch{return {ready:false,message:'语音服务未启动，请运行 python main.py'}}}
  private validate(input:any){
    if(!input||typeof input.text!=='string'||!input.text.trim()||input.text.trim().length>300)throw new Error('语音台词需为 1～300 字');
    if(input.with_motion!==undefined&&typeof input.with_motion!=='boolean')throw new Error('with_motion 必须为布尔值');
    return input.with_motion!==false;
  }
  private motion(input:any){return this.latent.predict({text:input.text.trim(),context:input.context??'',style:input.style??'lively',kind:input.kind??'regression',seed:input.seed??41},false);}
  async prepare(input:any){
    const withMotion=this.validate(input),begin=performance.now();
    const [audio,motion]=await Promise.all([
      this.worker('/synthesize',{text:input.text.trim(),language:input.language,seed:input.seed??41}),
      withMotion?this.motion(input):Promise.resolve(null)
    ]);
    const now=Date.now();for(const [id,s] of this.prepared)if(now-s.created>300000)this.prepared.delete(id);
    this.prepared.set(audio.speech_id,{audio,trajectory:motion?.command,created:now,busy:false});
    while(this.prepared.size>20)this.prepared.delete(this.prepared.keys().next().value!);
    return {...audio,with_motion:withMotion,motion:motion?{kind:motion.kind,duration_ms:motion.command.params.duration_ms,execution_mode:motion.execution_mode,checkpoint_sha256:motion.provenance.checkpoint_sha256}:null,
      preparation_ms:Math.round(performance.now()-begin)};
  }
  async perform(input:any,emit:(event:any)=>void,signal:AbortSignal){
    const withMotion=this.validate(input);
    if(this.performing)throw Object.assign(new Error('正在准备另一段语音'),{httpStatus:429});
    this.performing=true;
    let speechId:string|undefined,started=false,complete=false,endSeen=false,first:number|undefined;
    const begin=performance.now(),workerAbort=new AbortController();
    const check=()=>signal.throwIfAborted();
    try{
      const state=(await this.invoke({method:'state.get'})).result;check();
      if(state.recording)throw new Error('请先保存当前录制，再播放语音');
      if(!state.speech?.enabled)throw new Error('请先在页面启用声音');
      const motionPromise=withMotion?this.motion(input):Promise.resolve(null);
      // Attach a rejection handler immediately while response headers are pending.
      motionPromise.catch(()=>{});
      const response=await fetch((process.env.TTS_URL??'http://127.0.0.1:8769')+'/stream',{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:input.text.trim(),language:input.language,seed:input.seed??41}),signal:AbortSignal.any([signal,workerAbort.signal])});
      if(!response.ok){const error:any=await response.json();throw Object.assign(new Error(error.error??'语音服务失败'),{httpStatus:response.status});}
      const motion=await motionPromise;check();
      if(!response.body)throw new Error('未收到语音流');
      for await(const event of jsonLines(response.body)){
        check();if(event.type==='error')throw new Error(event.error);
        if(endSeen)throw new Error('语音结束后仍收到分块');
        if(event.type==='start'){
          if(started)throw new Error('语音流重复开始');
          speechId=event.speech_id;
          started=true;await this.invoke({method:'speech.stream.begin',params:{...event,trajectory:motion?.command}});check();
          emit({...event,with_motion:withMotion,motion:motion?{kind:motion.kind,execution_mode:motion.execution_mode,checkpoint_sha256:motion.provenance.checkpoint_sha256}:null});
        }else if(event.type==='chunk'){
          if(!started||event.speech_id!==speechId)throw new Error('语音流顺序错误');
          await this.invoke({method:'speech.stream.append',params:event});check();
          first??=Math.round(performance.now()-begin);
          emit({type:'progress',speech_id:speechId,chunk:event.index,buffered_ms:Math.round((event.offset_samples+event.samples)/event.sample_rate*1000),first_chunk_ms:first});
        }else if(event.type==='end'){
          if(!started||event.speech_id!==speechId)throw new Error('语音流结束顺序错误');
          await this.invoke({method:'speech.stream.finish',params:{speech_id:speechId,total_samples:event.total_samples}});check();
          endSeen=true;emit({...event,first_chunk_ms:first,preparation_ms:Math.round(performance.now()-begin)});
        }else throw new Error('未知语音流事件');
      }
      if(!endSeen)throw new Error('语音生成中断，请重新播放');complete=true;
    }finally{
      workerAbort.abort();
      if(started&&!complete)await this.invoke({method:'speech.stop',params:{speech_id:speechId}}).catch(()=>{});
      this.performing=false;
    }
  }
  async execute(input:any){
    const saved=this.prepared.get(input?.speech_id);
    if(!saved||Date.now()-saved.created>300000)throw new Error('语音已播放或已过期，请重新合成');
    if(saved.busy)throw new Error('该语音正在准备播放');
    saved.busy=true;
    try{
      const state=(await this.invoke({method:'state.get'})).result;
      if(state.recording)throw new Error('请先保存当前录制，再播放语音');
      const {speech_id,audio_url,mouth}=saved.audio;
      const result=await this.invoke({method:'speech.play',params:{speech_id,audio_url,mouth,trajectory:saved.trajectory}});
      this.prepared.delete(speech_id);return result;
    }finally{saved.busy=false;}
  }
}
