export type MotionStyle='restrained'|'natural'|'lively';
export const DEFAULT_MOTION_STYLE:MotionStyle='lively';
const clamp=(v:number,a=0,b=1)=>Math.min(b,Math.max(a,v));
const smooth=(v:number)=>{v=clamp(v);return v*v*v*(10+v*(-15+6*v));};
const arms=['Param36','Param39','Param41','Param42','Param43','Param62','Param59','Param60','Param61'];
const heads=['AngleX','AngleY','AngleZ'],bodies=['PositionX','PositionY','PositionZ','LeanInput'];
export const motionStyles={restrained:{head:.5,body:.4,arm:1,gap:6000,bodyGap:4000,duration:3200},natural:{head:.75,body:.7,arm:1,gap:5000,bodyGap:3200,duration:3200},lively:{head:1,body:1,arm:1.04,gap:4000,bodyGap:2600,duration:3400}};

/** Frequency and execution envelope only. Every joint trajectory comes from the expert. */
export class MotorPolicy {
  phase:'idle'|'active'|'return'='idle';used=false;count=0;confidence=0;
  private startMedia=0;private latestMedia=0;private returnActor=0;private gapUntil=0;
  private gain=0;private evidenceMs=0;private forceKey='';private intensity=1;private engagement=0;
  private initial:Record<string,number>={};private filtered:Record<string,number>={};private returnPose:Record<string,number>={};
  private firstShape:number|null=null;private mode={chest:false,point:false};private levels={chest:0,point:0};
  constructor(public style:MotionStyle=DEFAULT_MOTION_STYLE){}
  begin(values:Record<string,number>){this.initial={...values};this.filtered={...values};this.returnPose={};this.firstShape=null;this.phase='idle';this.used=false;this.count=0;this.gapUntil=0;this.gain=0;this.evidenceMs=0;this.forceKey='';this.mode={chest:false,point:false};this.levels={chest:values.Movement2??0,point:values.Movement3??0};}
  segment(){this.used=this.phase!=='idle';this.evidenceMs=0;}
  stop(actorMs:number){if(this.phase==='active'){this.phase='return';this.returnActor=actorMs;this.returnPose={...this.filtered};}}
  apply(input:Record<string,number>,dt:number,clock:{actor:number;media:number;playing:boolean;ended:boolean;confidence:number;threshold:number;forceKey?:string;forceIntensity?:number;active:boolean}){
    const style=motionStyles[this.style],result={...input};this.latestMedia=clock.media;this.confidence=clamp(clock.confidence);
    const forced=!!clock.forceKey&&clock.forceKey!==this.forceKey;
    if(dt>0&&clock.playing&&this.confidence>=Math.max(.5,clock.threshold))this.evidenceMs+=dt*1000;else if(clock.playing)this.evidenceMs=0;
    if(dt>0&&clock.playing&&(forced||this.phase==='idle'&&!this.used&&clock.actor>=this.gapUntil&&this.evidenceMs>=90)){
      this.phase='active';this.startMedia=clock.media;this.used=true;this.count++;this.gapUntil=clock.actor+style.gap;
      const requested=clamp(clock.forceIntensity??.8);this.intensity=forced?(requested===0?0:.82+.18*requested):1;if(forced)this.forceKey=clock.forceKey!;
    }
    if(this.phase==='active'){
      this.gain=smooth((clock.media-this.startMedia)/100)*style.arm*this.intensity;
      if(clock.media-this.startMedia>=style.duration)this.stop(clock.actor);
    }
    const recovering=this.phase==='return';const recovery=recovering?1-smooth((clock.actor-this.returnActor)/750):0;
    if(recovering&&clock.actor-this.returnActor>=750){this.phase='idle';this.gain=0;}
    if(this.phase==='idle')this.gain=0;
    this.engagement+=(1-Math.exp(-dt/.15))*((this.phase==='active'?1:0)-this.engagement);
    if(clock.active){
      this.firstShape??=clock.actor;const settle=1-smooth((clock.actor-this.firstShape)/800);
      for(const [list,gain] of [[heads,Math.min(1,style.head+.3*this.engagement)],[bodies,Math.min(1,style.body+.3*this.engagement)]] as [string[],number][])
        for(const id of list)if(input[id]!==undefined)result[id]=input[id]*gain+(this.initial[id]??0)*(1-gain)*settle;
    }
    for(const id of arms){
      const target=recovering?(this.returnPose[id]??0)*recovery:(input[id]??0)*this.gain;
      const bounded=clamp(target,-1,1),previous=this.filtered[id]??0,tau=id==='Param42'||id==='Param61'?.03:.05;
      const delta=(1-Math.exp(-dt/tau))*(bounded-previous);this.filtered[id]=previous+clamp(delta,-8*dt,8*dt);result[id]=this.filtered[id];
    }
    const updateMode=(name:'chest'|'point',score:number)=>{
      if(this.phase==='idle'||recovering&&recovery<.15)this.mode[name]=false;
      else if(score>=.65)this.mode[name]=true;else if(score<=.3&&!recovering)this.mode[name]=false;
      this.levels[name]+=(1-Math.exp(-dt/.06))*((this.mode[name]?1:0)-this.levels[name]);return this.levels[name];
    };
    result.Movement1=0;result.Movement2=updateMode('chest',input.Movement2??0);result.Movement3=updateMode('point',input.Movement3??0);
    const seam=(this.mode.point||this.levels.point>.05)?clamp(input.Param40??0)*(recovering?recovery:1):0;
    this.filtered.Param40=(this.filtered.Param40??0)+(1-Math.exp(-dt/.06))*(seam-(this.filtered.Param40??0));result.Param40=this.filtered.Param40;
    return result;
  }
  state(actor:number){return {phase:this.phase,used_in_clause:this.used,count:this.count,confidence:this.confidence,cooldown_ms:Math.max(0,this.gapUntil-actor),style:this.style,
    elapsed_ms:this.phase==='active'?Math.max(0,this.latestMedia-this.startMedia):this.phase==='return'?motionStyles[this.style].duration+Math.max(0,actor-this.returnActor):this.used?motionStyles[this.style].duration+750:0,duration_ms:motionStyles[this.style].duration};}
}
