import { LatentBridge } from './latent-bridge';

export class SpeechBridge {
  private prepared=new Map<string,{audio:any;trajectory:any;created:number;busy:boolean}>();
  constructor(private latent:LatentBridge,private invoke:(command:any)=>Promise<any>){}
  private async worker(path:string,body?:any){
    const response=await fetch((process.env.TTS_URL??'http://127.0.0.1:8769')+path,{
      ...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),
      signal:AbortSignal.timeout(body===undefined?2500:180000)});
    const data:any=await response.json();
    if(!response.ok)throw Object.assign(new Error(data.error??'语音服务失败'),{httpStatus:response.status});
    return data;
  }
  async status(){try{return await this.worker('/health')}catch{return {ready:false,message:'语音服务未启动，请运行 start.ps1'}}}
  async prepare(input:any){
    if(!input||typeof input.text!=='string'||!input.text.trim()||input.text.trim().length>300)throw new Error('语音台词需为 1～300 字');
    if(input.with_motion!==undefined&&typeof input.with_motion!=='boolean')throw new Error('with_motion 必须为布尔值');
    const withMotion=input.with_motion!==false,begin=Date.now();
    if(withMotion&&!(await this.latent.status()).ready)throw new Error('动作专家未启动，请运行 start.ps1；也可取消同步身体动作');
    const audio=await this.worker('/synthesize',{text:input.text.trim(),language:input.language,seed:input.seed??41});
    const motion=withMotion?await this.latent.predict({text:audio.text,context:input.context??'',style:input.style??'lively',kind:input.kind??'regression',seed:input.seed??41},false):null;
    const now=Date.now();for(const [id,s] of this.prepared)if(now-s.created>300000)this.prepared.delete(id);
    this.prepared.set(audio.speech_id,{audio,trajectory:motion?.command,created:now,busy:false});
    while(this.prepared.size>20)this.prepared.delete(this.prepared.keys().next().value!);
    return {...audio,with_motion:withMotion,motion:motion?{kind:motion.kind,duration_ms:motion.command.params.duration_ms,execution_mode:motion.execution_mode,checkpoint_sha256:motion.provenance.checkpoint_sha256}:null,
      preparation_ms:Date.now()-begin};
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
