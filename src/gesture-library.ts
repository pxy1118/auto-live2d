import {decodeCurve,sampleCurve,type Curve} from './motion';
import type {Manifest} from './controller';
import {actingBody,actingVariants,gestureFingerChannels,ease as smooth} from './gesture-choreography';
export {gestureFingerChannels} from './gesture-choreography';

export const gestureNames=['wave','chest','grass','point','thanks','explain','refuse'] as const;
export const retiredGestures=['cheer'];
export type GestureName=typeof gestureNames[number];
export const gestureLabels:Record<GestureName,string>={wave:'点头倾身招呼',chest:'抚胸',grass:'狗尾草展示',point:'指出重点',thanks:'抚胸致谢',explain:'身前说明',refuse:'示意停止'};
export const gestureArmChannels=['Param36','Param39','Param41','Param42','Param43','Param62','Param59','Param60','Param61','Movement1','Movement2','Movement3','Param40'];
export const gestureBodyChannels=['AngleX','AngleY','AngleZ','PositionX','PositionY','PositionZ','LeanInput'];
const owned=[...gestureArmChannels,...gestureBodyChannels];
const native={chest:['默认手切举手','举手切默认手'],grass:['狗尾草切换出来','狗尾草切回默认手'],point:['竖手指切出来动画','竖手指切回默认']} as const;
type Clip={duration:number;curves:Curve[]};
type Request={name:GestureName;id:string;cueId?:string;source:'model'|'director';holdMs?:number;variant?:number;strength?:number};
type Active=Request&{at:number;enter:number;hold:number;exit:number;variant:number;rate:number;strength:number;native?:keyof typeof native;from:Record<string,number>;velocity:Record<string,number>;last:Record<string,number>;cut?:number};

/** Native arm-joint choreography with independent wrist/finger accents.
 * Expressions, mouth, wardrobe and secondary physics retain their owners. */
export class GestureLibrary {
  private clips=new Map<string,Clip>();private current:Active|null=null;
  private count=0;
  constructor(motions:Manifest['motions']=[],private seed=41){for(const m of motions)this.clips.set(m.name,{duration:m.data.Meta.Duration*1000,curves:m.data.Curves.filter(c=>c.Target==='Parameter'&&gestureArmChannels.includes(c.Id)).map(decodeCurve)});}
  get active(){return !!this.current;}
  clear(){this.current=null;this.count=0;}
  available(name:GestureName){return gestureNames.includes(name)&&[0,1,2].every(variant=>{const key=this.nativeKind(name,variant);return !key||native[key].every(n=>this.clips.has(n));});}
  // The default hand is drawn from the back. There is no verified palm-turn
  // channel: do not attach that drawing to the pointing arm to fake a palm.
  // Keep the learned greeting intent; use a body greeting until a palm is rigged.
  private nativeKind(name:GestureName,variant=0){return name==='wave'?undefined:['chest','thanks'].includes(name)?'chest':name==='grass'?'grass':name==='explain'&&variant<2?'chest':'point';}
  request(request:Request,actor:number,pose:Record<string,number>,velocity:Record<string,number>={}){
    if(this.current||!this.available(request.name))return false;
    const variant=request.variant??((this.seed+this.count)%3),rate=1,kind=this.nativeKind(request.name,variant),strength=Math.max(.3,Math.min(1,request.strength??1));
    this.current={...request,at:actor,variant,rate,strength,native:kind,enter:kind?this.clips.get(native[kind][0])!.duration:650,
      hold:request.holdMs??(request.name==='grass'?1800:1400),exit:kind?this.clips.get(native[kind][1])!.duration:680,from:{...pose},velocity:{...velocity},last:{...pose}};
    this.count++;return true;
  }
  release(actor:number,cueId?:string){if(this.current&&(!cueId||this.current.cueId===cueId))this.current.cut=Math.min(this.current.cut??this.current.enter+this.current.hold,Math.max(this.current.enter,actor-this.current.at));}
  private raw(a:Active,t:number){
    const result=Object.fromEntries(owned.map(id=>[id,0])),holdEnd=a.cut??a.enter+a.hold,end=holdEnd+a.exit;
    const e=smooth(t/a.enter)*(1-smooth((t-holdEnd)/a.exit)),h=Math.max(0,t-a.enter)/1000,actingTime={t,enter:a.enter,holdEnd,exit:a.exit};
    if(a.native){
      const entry=this.clips.get(native[a.native][0])!,exit=this.clips.get(native[a.native][1])!,clip=t<holdEnd?entry:exit;
      const seconds=t<holdEnd?Math.min(entry.duration,t*a.rate)/1000:(t-holdEnd)*a.rate/1000;
      for(const c of clip.curves)result[c.id]=sampleCurve(c,seconds);
      if(a.native==='grass'){result.Movement3=0;result.Param40=0;}else if(a.native==='point')result.Movement1=0;
      if(t>a.enter&&t<holdEnd){
        const wrist=a.native==='chest'?'Param61':'Param42';result[wrist]+=.035*Math.sin((t-a.enter)/600)*e*a.strength;
        const full=this.clips.get('脱捕');
        if(a.native==='grass'&&full){
          const entryPose=this.clips.get(native.grass[0])!,h=t-a.enter,back=smooth((h-Math.max(0,holdEnd-a.enter-300))/300),blend=smooth(h/250)*(1-back)*a.strength;
          for(const c of full.curves){if(!['Param36','Param39','Param41','Param42','Param43'].includes(c.id))continue;const base=sampleCurve(entryPose.curves.find(x=>x.id===c.id)!,entryPose.duration/1000);result[c.id]=base+(sampleCurve(c,3.7+Math.min(h/1000,2.8))-base)*blend;}
        }
      }
    }
    // Variants keep one primary arm; body, head and wrist beats provide variety.
    const details=smooth(h/.18)*e*a.strength;
    if(a.native==='point'){
      if(a.variant===1){result.Param42+=.21*Math.sin(h*4)*details;result.Param43-=.22*Math.sin(h*4)*details;}
    }
    if(a.native==='grass'){
      if(a.variant===1){result.Param42+=.23*Math.sin(h*3.2)*details;result.Param41+=.045*Math.sin(h*3.2+.4)*details;result.Param36+=.035*Math.sin(h*3.2)*details;}
      if(a.variant===2){result.Param41-=.065*Math.sin(Math.PI*Math.min(h/1.3,1))*details;result.Param39+=.15*Math.sin(Math.PI*Math.min(h/1.3,1))*details;result.Param42-=.16*Math.sin(h*2.8)*details;}
    }
    // Keep the other arm down even if an imported native clip includes unrelated
    // channels. Its fingers continue resident physics rather than being locked.
    const inactive=a.native==='chest'?['Param36','Param39','Param41','Param42','Param43','Movement1','Movement3','Param40']:['Param62','Param59','Param60','Param61','Movement2'];
    for(const id of inactive)result[id]=0;
    // Strength changes the acting accents, not the artist's contact pose.
    // Scaling absolute elbow angles moved the hand away from the chest and
    // left pointing gestures halfway raised, even with the correct drawing.
    for(const [id,value] of Object.entries(actingBody(a.name,a.variant,actingTime)))result[id]=value*a.strength;
    return {values:result,end};
  }
  tick(actor:number,automatic:Record<string,number>){
    const a=this.current;if(!a)return {};
    const t=Math.max(0,actor-a.at),raw=this.raw(a,t),result={...raw.values};
    const transition=300;
    if(t<transition){const u=t/transition,h00=2*u**3-3*u*u+1,h10=u**3-2*u*u+u,origin=this.raw(a,0).values,future=this.raw(a,1).values;
      for(const id of Object.keys(result))result[id]+=h00*((a.from[id]??0)-(origin[id]??0))+h10*transition*((a.velocity[id]??0)-((future[id]??0)-(origin[id]??0)));}
    if(t>=raw.end){const blend=smooth((t-raw.end)/200);for(const id of Object.keys(result))result[id]=raw.values[id]*(1-blend)+(automatic[id]??0)*blend;
      if(t>=raw.end+200){this.current=null;}}
    a.last=result;return result;
  }
  state(actor:number){const a=this.current;if(!a)return {active:false,count:this.count,pending:null};const t=actor-a.at,holdEnd=a.cut??a.enter+a.hold;return {active:true,count:this.count,name:a.name,label:gestureLabels[a.name],source:a.source,variant:a.variant,variant_label:actingVariants[a.name][a.variant],strength:a.strength,active_arm:!a.native?null:a.native==='chest'?'left':'right',elapsed_ms:t,duration_ms:holdEnd+a.exit+200,phase:t<a.enter?'enter':t<holdEnd?'hold':t<holdEnd+a.exit?'exit':'blend',owned_channels:Object.keys(this.raw(a,t).values),pending:null};}
  capabilities(){return gestureNames.map(name=>({name,label:gestureLabels[name],available:this.available(name),source:name==='wave'?'greeting_body_fallback':'native_animation_with_coordinated_body',variants:3,arm_policy:'single_primary',variant_active_arms:[0,1,2].map(v=>{const kind=this.nativeKind(name,v);return !kind?null:kind==='chest'?'left':'right';}),variant_descriptions:actingVariants[name],owned_channels:[...owned,...gestureFingerChannels],stops_audio:false,limitations:name==='wave'?['当前素材未验证掌心翻转，招呼用点头倾身，待补挥手绘制与绑定']:[]}));}
}
