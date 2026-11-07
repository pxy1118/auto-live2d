/** Audio advances speech acting; idle advances recovery; all buffering freezes. */
export class PerformanceClock{
 now=0;delta=0;private speech:string|null=null;private audio=0;
 step(dt:number,speech:{speech_id?:string|null;phase?:string;audio_time_ms?:number}){
  this.delta=0;if(!(dt>0))return;
  if(speech.speech_id!==this.speech){this.speech=speech.speech_id??null;this.audio=0;}
  const audio=Math.max(this.audio,Number.isFinite(speech.audio_time_ms)?speech.audio_time_ms!:0);
  if(speech.phase==='playing'){this.delta=audio-this.audio;this.audio=audio;}
  else if(speech.phase!=='paused'&&speech.phase!=='buffering')this.delta=dt*1000;
  this.now+=this.delta;
 }
}
