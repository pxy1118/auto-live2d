export type MotionStyle='restrained'|'natural'|'lively';
const clamp=(v:number,a=0,b=1)=>Math.min(b,Math.max(a,v));
const smooth=(v:number)=>{v=clamp(v);return v*v*(3-2*v);};
const arms=['Param36','Param39','Param41','Param42','Param43','Param62','Param59','Param60','Param61'];
const heads=['AngleX','AngleY','AngleZ'];
const bodies=['PositionX','PositionY','PositionZ','LeanInput'];
const styles={restrained:{head:.5,body:.4,arm:.55,gap:6000,duration:1600},natural:{head:.75,body:.7,arm:.8,gap:5000,duration:1800},lively:{head:1,body:1,arm:1,gap:4000,duration:2000}};

/** Sparse expression of a learned trajectory; there is no gesture clip catalog here. */
export class MotorPolicy {
  phase:'idle'|'active'|'return'='idle';
  used=false;
  count=0;
  confidence=0;
  private startMedia=0;
  private returnActor=0;
  private returnFrom=0;
  private gapUntil=0;
  private gain=0;
  private evidenceMs=0;
  private forceKey='';
  private intensity=1;
  private initial:Record<string,number>={};
  private filtered:Record<string,number>={};
  private firstShape:number|null=null;
  private mode={chest:false,point:false};
  private levels={chest:0,point:0};
  constructor(public style:MotionStyle='restrained'){}
  begin(values:Record<string,number>){this.initial={...values};this.filtered={...values};this.firstShape=null;this.phase='idle';this.used=false;this.count=0;this.gapUntil=0;this.evidenceMs=0;this.forceKey='';this.mode={chest:false,point:false};this.levels={chest:values.Movement2??0,point:values.Movement3??0};}
  segment(){this.used=false;this.evidenceMs=0;}
  stop(actorMs:number){if(this.phase==='active'){this.phase='return';this.returnActor=actorMs;this.returnFrom=this.gain;}}
  apply(input:Record<string,number>,dt:number,clock:{actor:number;media:number;playing:boolean;ended:boolean;confidence:number;threshold:number;forceKey?:string;forceIntensity?:number;active:boolean}){
    const style=styles[this.style],result={...input};this.confidence=clamp(clock.confidence);
    const forced=!!clock.forceKey&&clock.forceKey!==this.forceKey;
    if(dt>0&&clock.playing&&this.confidence>=Math.max(.8,clock.threshold))this.evidenceMs+=dt*1000;else if(clock.playing)this.evidenceMs=0;
    if(dt>0&&clock.playing&&(forced||this.phase==='idle'&&!this.used&&clock.actor>=this.gapUntil&&this.evidenceMs>=90)){
      this.phase='active';this.startMedia=clock.media;this.used=true;this.count++;this.gapUntil=clock.actor+style.gap;
      this.intensity=forced?clamp(clock.forceIntensity??.8):1;if(forced)this.forceKey=clock.forceKey!;
    }
    if(this.phase==='active'){
      this.gain=smooth((clock.media-this.startMedia)/220)*style.arm*this.intensity;
      if(clock.media-this.startMedia>=style.duration||clock.ended){this.phase='return';this.returnActor=clock.actor;this.returnFrom=this.gain;}
    }
    if(this.phase==='return'){
      this.gain=this.returnFrom*(1-smooth((clock.actor-this.returnActor)/650));
      if(clock.actor-this.returnActor>=650){this.phase='idle';this.gain=0;}
    }
    if(this.phase==='idle')this.gain=0;
    if(clock.active){
      this.firstShape??=clock.actor;const settle=1-smooth((clock.actor-this.firstShape)/800);
      for(const [list,gain] of [[heads,style.head],[bodies,style.body]] as [string[],number][])
        for(const id of list)if(input[id]!==undefined)result[id]=input[id]*gain+(this.initial[id]??0)*(1-gain)*settle;
    }
    for(const id of arms){
      const target=(input[id]??0)*this.gain;const bounded=id==='Param42'||id==='Param61'?clamp(target,-.18,.18):target;
      const previous=this.filtered[id]??0;this.filtered[id]=previous+(1-Math.exp(-dt/.14))*(bounded-previous);result[id]=this.filtered[id];
    }
    const updateMode=(name:'chest'|'point',score:number)=>{
      if(this.gain<.025)this.mode[name]=false;
      else if(score>=.85)this.mode[name]=true;else if(score<=.25)this.mode[name]=false;
      this.levels[name]+=(1-Math.exp(-dt/.12))*((this.mode[name]?1:0)-this.levels[name]);return this.levels[name];
    };
    // Grass is an explicit prop/native-motion tool, never a side effect of noisy motor values.
    result.Movement1=0;result.Movement2=updateMode('chest',input.Movement2??0);result.Movement3=updateMode('point',input.Movement3??0);result.Param40=result.Movement3;
    return result;
  }
  state(actor:number){return {phase:this.phase,used_in_clause:this.used,count:this.count,confidence:this.confidence,cooldown_ms:Math.max(0,this.gapUntil-actor),style:this.style};}
}
