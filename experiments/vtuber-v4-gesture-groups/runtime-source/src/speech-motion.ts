const clamp=(v:number,lo=0,hi=1)=>Math.max(lo,Math.min(hi,v));

/** Monotonic semantic phase, anchored to audio samples rather than render frames. */
export class SpeechMotionClock {
  private anchorAudio=0;
  private anchorMotion=0;
  constructor(readonly sourceDuration:number,private duration:number,readonly native:boolean=false,private provisional=false){}
  at(audioMs:number){
    if(this.native)return Math.min(this.sourceDuration,Math.max(0,audioMs));
    const fraction=clamp((audioMs-this.anchorAudio)/Math.max(1,this.duration-this.anchorAudio),0,this.provisional ? .85 : 1);
    return this.anchorMotion+(this.sourceDuration-this.anchorMotion)*fraction;
  }
  finish(durationMs:number,audioMs:number){
    // Learning the final length mid-stream must never rewind expressions/gestures.
    this.anchorMotion=this.at(audioMs);this.anchorAudio=audioMs;this.duration=durationMs;this.provisional=false;
  }
}

/** Small head/chest accents; hands, expressions, and clothing remain semantic. */
export function speechAccents(energy:number,beat:number,bodyBeat:number){
  return {AngleY:-2.4*clamp(beat),AngleZ:.7*clamp(beat),PositionY:-1.1*clamp(bodyBeat),
    PositionZ:-.4*clamp(bodyBeat),LeanInput:-.6*clamp(energy)};
}
