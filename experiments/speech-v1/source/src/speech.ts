import { ControlError } from './controller';

export type MouthCue={hz:number;duration_ms:number;values:number[];method:string};
export type PreparedSpeech={id:string;buffer:AudioBuffer;mouth:MouthCue;trajectory?:{method:string;params:any}};
type Session={clip:PreparedSpeech;source:AudioBufferSourceNode|null;offset:number;startAt:number|null;paused:boolean};

/** AudioContext is the media clock; the render loop only samples this clock. */
export class SpeechPlayer {
  private context:AudioContext|null=null;
  private session:Session|null=null;
  private lastId:string|null=null;

  async unlock(){
    this.context??=new AudioContext();
    if(this.context.state!=='running'){
      await Promise.race([this.context.resume(),new Promise((_,reject)=>setTimeout(()=>reject(new ControlError('audio_locked','请先点击“启用声音”或“说话并表演”。')),1200))]);
    }
    if(this.context.state!=='running')throw new ControlError('audio_locked','浏览器声音尚未启用');
    return this.info();
  }
  async prepare(params:any):Promise<PreparedSpeech>{
    if(!this.context||this.context.state!=='running')throw new ControlError('audio_locked','请先在页面点击“启用声音”，再播放语音。');
    if(!params||typeof params!=='object'||!/^\/[a-z/]+[0-9a-f]{32}\.wav$/.test(params.audio_url)||
       params.audio_url!==`/api/speech/audio/${params.speech_id}.wav`)throw new ControlError('invalid_speech','语音地址不合法');
    const cue=params.mouth;
    if(!cue||cue.hz!==60||!Number.isFinite(cue.duration_ms)||cue.duration_ms<100||cue.duration_ms>90000||
       !Array.isArray(cue.values)||Math.abs(cue.values.length-(Math.ceil(cue.duration_ms/1000*cue.hz)+1))>1||
       cue.values.some((v:any)=>typeof v!=='number'||!Number.isFinite(v)||v<0||v>.85)||cue.values.at(-1)!==0){
      throw new ControlError('invalid_speech','语音口型数据不合法');
    }
    const response=await fetch(params.audio_url,{signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw new ControlError('speech_audio_missing','语音文件已失效，请重新合成');
    const buffer=await this.context.decodeAudioData(await response.arrayBuffer());
    if(Math.abs(buffer.duration*1000-cue.duration_ms)>25)throw new ControlError('invalid_speech','音频与口型时长不匹配');
    return {id:params.speech_id,buffer,mouth:structuredClone(cue),trajectory:params.trajectory?structuredClone(params.trajectory):undefined};
  }
  start(clip:PreparedSpeech){
    if(!this.context||this.context.state!=='running')throw new ControlError('audio_locked','请重新启用浏览器声音');
    this.stop();this.lastId=clip.id;this.session={clip,source:null,offset:0,startAt:null,paused:false};this.startSource();return this.info();
  }
  private startSource(){
    const session=this.session!,context=this.context!,source=context.createBufferSource();
    source.buffer=session.clip.buffer;source.connect(context.destination);
    session.source=source;session.startAt=context.currentTime+.08;session.paused=false;
    source.onended=()=>{source.disconnect();if(this.session===session&&session.source===source)this.session=null;};
    source.start(session.startAt,session.offset);
  }
  private position(){
    const s=this.session;if(!s)return 0;
    return s.offset+(s.startAt===null?0:Math.max(0,this.context!.currentTime-s.startAt));
  }
  pause(){
    const s=this.session;if(!s||s.paused)return;
    s.offset=this.position();s.paused=true;s.startAt=null;
    if(s.source){s.source.onended=null;s.source.stop();s.source.disconnect();s.source=null;}
  }
  resume(){if(this.session?.paused)this.startSource();}
  stop(){
    const s=this.session;this.session=null;
    if(s?.source){s.source.onended=null;s.source.stop();s.source.disconnect();}
  }
  sample():{mouth:number|null;started:boolean}{
    const s=this.session;if(!s)return {mouth:null,started:false};
    const started=s.startAt!==null&&this.context!.currentTime>=s.startAt;
    const p=this.position()*s.clip.mouth.hz,a=s.clip.mouth.values,i=Math.floor(p),blend=p-i;
    return {mouth:started||s.paused?(a[i]??0)*(1-blend)+(a[i+1]??0)*blend:0,started:started&&!s.paused};
  }
  info(){
    const s=this.session;
    return {enabled:this.context?.state==='running',active:!!s,speech_id:s?.clip.id??this.lastId,
      phase:!s?'idle':s.paused?'paused':this.context!.currentTime<s.startAt!?'scheduled':'playing',
      audio_time_ms:Math.round(this.position()*1000),duration_ms:s?.clip.mouth.duration_ms??0,mouth_open:this.sample().mouth??0};
  }
}
