import { ControlError } from './controller';
import { SpeechMotionClock } from './speech-motion';

export type MouthCue={hz:number;duration_ms:number;values:number[];method:string;energy?:number[];beats?:number[]};
export type SpeechTrajectory={method:string;params:any};
export type PreparedSpeech={id:string;buffer:AudioBuffer;mouth:MouthCue;trajectory?:SpeechTrajectory};
type Segment={buffer:AudioBuffer;mouth:MouthCue;offset:number};
type Session={id:string;segments:Segment[];sources:Set<AudioBufferSourceNode>;anchor:number|null;offset:number;
  paused:boolean;finished:boolean;sampleRate:number;samples:number;underruns:number;clock:SpeechMotionClock|null};

/** All mouth, body phase, and chunk scheduling use the same AudioContext clock. */
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
  private requireAudio(){
    if(!this.context||this.context.state!=='running')throw new ControlError('audio_locked','请先在页面启用声音，再播放语音。');
    return this.context;
  }
  private validateId(id:any){if(typeof id!=='string'||!/^[a-f0-9]{32}$/.test(id))throw new ControlError('invalid_speech','语音 ID 不合法');}
  private validateCue(cue:any,final:boolean){
    if(!cue||cue.hz!==60||!Number.isFinite(cue.duration_ms)||cue.duration_ms<1||cue.duration_ms>90000||
       !Array.isArray(cue.values)||Math.abs(cue.values.length-(Math.ceil(cue.duration_ms/1000*cue.hz)+1))>1||
       cue.values.some((v:any)=>typeof v!=='number'||!Number.isFinite(v)||v<0||v>.85)||(final&&cue.values.at(-1)!==0)){
      throw new ControlError('invalid_speech','语音口型数据不合法');
    }
    for(const key of ['energy','beats'])if(cue[key]!==undefined&&(!Array.isArray(cue[key])||cue[key].length!==cue.values.length||cue[key].some((v:any)=>typeof v!=='number'||!Number.isFinite(v)||v<0||v>1)))throw new ControlError('invalid_speech','语音节奏数据不合法');
  }
  async prepare(params:any):Promise<PreparedSpeech>{
    const context=this.requireAudio();this.validateId(params?.speech_id);
    if(params.audio_url!==`/api/speech/audio/${params.speech_id}.wav`)throw new ControlError('invalid_speech','语音地址不合法');
    this.validateCue(params.mouth,true);
    const response=await fetch(params.audio_url,{signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw new ControlError('speech_audio_missing','语音文件已失效，请重新合成');
    const buffer=await context.decodeAudioData(await response.arrayBuffer());
    if(Math.abs(buffer.duration*1000-params.mouth.duration_ms)>25)throw new ControlError('invalid_speech','音频与口型时长不匹配');
    return {id:params.speech_id,buffer,mouth:structuredClone(params.mouth),trajectory:params.trajectory?structuredClone(params.trajectory):undefined};
  }
  private create(id:string,duration:number,trajectory?:SpeechTrajectory,provisional=false):Session{
    this.requireAudio();this.stop();this.lastId=id;
    const native=trajectory?.params.events.some((e:any)=>e.method==='motions.play'&&(e.params?.slot??'full')==='full')??false;
    return this.session={id,segments:[],sources:new Set(),anchor:null,offset:0,paused:false,finished:false,sampleRate:0,samples:0,underruns:0,
      clock:trajectory?new SpeechMotionClock(trajectory.params.duration_ms,duration,native,provisional):null};
  }
  start(clip:PreparedSpeech){
    const s=this.create(clip.id,clip.mouth.duration_ms,clip.trajectory);
    s.sampleRate=clip.buffer.sampleRate;s.samples=clip.buffer.length;s.finished=true;
    s.segments.push({buffer:clip.buffer,mouth:clip.mouth,offset:0});this.schedule();return this.info();
  }
  beginStream(params:any){
    this.validateId(params?.speech_id);
    if(!Number.isFinite(params.estimated_duration_ms)||params.estimated_duration_ms<100||params.estimated_duration_ms>90000)throw new ControlError('invalid_speech','预计语音时长不合法');
    this.create(params.speech_id,params.estimated_duration_ms,params.trajectory,true);return this.info();
  }
  private own(id:any){
    if(!this.session||id!==this.session.id)throw new ControlError('speech_cancelled','该语音已经停止或被替换');
    return this.session;
  }
  append(params:any){
    const s=this.own(params?.speech_id),context=this.requireAudio();
    if(s.finished||params.index!==s.segments.length||params.offset_samples!==s.samples||!Number.isInteger(params.sample_rate)||params.sample_rate<8000||params.sample_rate>48000||
       (s.sampleRate&&params.sample_rate!==s.sampleRate)||!Number.isInteger(params.samples)||params.samples<1||params.samples>params.sample_rate*2||s.samples+params.samples>params.sample_rate*90||
       typeof params.pcm16_base64!=='string'||params.pcm16_base64.length!==4*Math.ceil(params.samples*2/3)||!/^[A-Za-z0-9+/]*={0,2}$/.test(params.pcm16_base64))throw new ControlError('invalid_speech','语音分块顺序或 PCM 数据不合法');
    this.validateCue(params.mouth,false);
    if(Math.abs(params.samples/params.sample_rate*1000-params.mouth.duration_ms)>.1)throw new ControlError('invalid_speech','分块口型时长不匹配');
    const raw=atob(params.pcm16_base64),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
    if(bytes.length!==params.samples*2)throw new ControlError('invalid_speech','PCM 样本数不匹配');
    const view=new DataView(bytes.buffer),buffer=context.createBuffer(1,params.samples,params.sample_rate),data=buffer.getChannelData(0);
    for(let i=0;i<data.length;i++)data[i]=view.getInt16(i*2,true)/32768;
    const segment={buffer,mouth:structuredClone(params.mouth),offset:s.samples/params.sample_rate};
    s.sampleRate=params.sample_rate;s.samples+=params.samples;s.segments.push(segment);
    if(!s.paused)this.schedule([segment]);return this.info();
  }
  finish(params:any){
    const s=this.own(params?.speech_id);
    if(s.finished||!s.samples||params.total_samples!==s.samples)throw new ControlError('invalid_speech','语音流未完整接收');
    s.clock?.finish(s.samples/s.sampleRate*1000,this.position()*1000);s.finished=true;this.complete(s);return this.info();
  }
  private schedule(segments=this.session!.segments){
    const s=this.session!,context=this.context!;
    if(s.anchor===null)s.anchor=context.currentTime+.10-s.offset;
    // On underrun, insert silence in wall time and hold the media clock/body.
    if(segments.length&&s.anchor+segments[0].offset<context.currentTime-.015&&s.offset<=segments[0].offset){
      s.anchor=context.currentTime+.06-segments[0].offset;s.offset=segments[0].offset;s.underruns++;
    }
    for(const segment of segments){
      const end=segment.offset+segment.buffer.duration;if(end<=s.offset+1e-6)continue;
      const source=context.createBufferSource();source.buffer=segment.buffer;source.connect(context.destination);s.sources.add(source);
      source.onended=()=>{source.disconnect();s.sources.delete(source);this.complete(s);};
      const from=Math.max(0,s.offset-segment.offset);source.start(s.anchor+segment.offset+from,from);
    }
  }
  private complete(s:Session){
    if(this.session===s&&s.finished&&!s.paused&&!s.sources.size&&this.position()>=s.samples/s.sampleRate-.005)this.session=null;
  }
  private position(){
    const s=this.session;if(!s)return 0;
    return Math.min(s.sampleRate?s.samples/s.sampleRate:0,Math.max(s.offset,s.anchor===null?s.offset:this.context!.currentTime-s.anchor));
  }
  pause(){
    const s=this.session;if(!s||s.paused)return;
    s.offset=this.position();s.paused=true;s.anchor=null;this.clearSources(s);
  }
  resume(){if(this.session?.paused){this.session.paused=false;this.schedule();}}
  private clearSources(s:Session){for(const source of s.sources){source.onended=null;source.stop();source.disconnect();}s.sources.clear();}
  stop(){const s=this.session;this.session=null;if(s)this.clearSources(s);}
  private cueAt(time:number,key:'values'|'energy'|'beats'){
    const s=this.session;if(!s||time<0)return 0;
    const segment=s.segments.find(segment=>time>=segment.offset&&time<segment.offset+segment.buffer.duration);
    if(!segment)return 0;
    const a=segment.mouth[key];if(!a)return key==='energy'?this.cueAt(time,'values')/.85:0;
    const p=(time-segment.offset)*segment.mouth.hz,i=Math.floor(p),blend=p-i;
    return (a[i]??0)*(1-blend)+(a[i+1]??a[i]??0)*blend;
  }
  sample(){
    const s=this.session,time=this.position(),started=!!s&&s.anchor!==null&&this.context!.currentTime>=s.anchor+s.offset;
    const buffered=!!s&&time<(s.sampleRate?s.samples/s.sampleRate:0)-.001;
    return {mouth:s?(started||s.paused?this.cueAt(time,'values'):0):null,started:started&&!s!.paused,
      motion_time_ms:s?.clock?.at(time*1000)??null,native_motion:s?.clock?.native??false,
      energy:buffered?this.cueAt(time,'energy'):0,beat:buffered?this.cueAt(time,'beats'):0,bodyBeat:buffered?this.cueAt(time-.09,'beats'):0};
  }
  info(){
    const s=this.session,time=this.position(),sample=this.sample();
    return {enabled:this.context?.state==='running',active:!!s,speech_id:s?.id??this.lastId,
      phase:!s?'idle':s.paused?'paused':s.anchor===null||time>=s.samples/s.sampleRate-.001&&!s.finished?'buffering':this.context!.currentTime<s.anchor+s.offset?'scheduled':'playing',
      audio_time_ms:Math.round(time*1000),duration_ms:s&&s.sampleRate?Math.round(s.samples/s.sampleRate*1000):0,
      complete:s?.finished??true,underruns:s?.underruns??0,mouth_open:sample.mouth??0,motion_time_ms:sample.motion_time_ms,
      rhythm:{energy:sample.energy,beat:sample.beat,body_beat:sample.bodyBeat},motion_timing:sample.motion_time_ms===null?'none':sample.native_motion?'native_speed':'audio_duration'};
  }
}
