import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { decodeCurve, sampleCurve } from '../../src/motion';

export const root = join(import.meta.dirname, '../..');
export const datasetRoot = join(root, 'datasets/vtuber-v3');
export const read = (path: string) => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
export const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const oldProfile = read(join(root, 'latent/profile.json'));
const sourceFile = join(root, 'live2d/DeepSeek/DeepSeek/Animation/脱捕.motion3.json');
const source = read(sourceFile);
const curves = new Map(source.Curves.map((curve: any) => [curve.Id, decodeCurve(curve)]));
export const sourceAt = (id: string, time: number): number => curves.has(id) ? sampleCurve(curves.get(id) as any, time) : 0;
export const profile = {
  id: 'dafeiyu-vtuber.v4', sampling_hz: 10, scope: 'larger cute coupled motion and learned original-expression switching',
  channels: [...oldProfile.channels.map((c:any)=>({...c,...({AngleX:{min:-24,max:24},AngleY:{min:-20,max:20},AngleZ:{min:-24,max:24},PositionX:{min:-24,max:24},PositionY:{min:-20,max:20},PositionZ:{min:-24,max:24},LeanInput:{min:-24,max:0},ParamEyeBallX:{min:-.85,max:.85},ParamEyeBallY:{min:-.75,max:.75},EyeSmile:{min:0,max:.95}}[c.id]??{})})), { id: 'ParamEyeLOpen', label: '左眼睑', min: 0, max: 1.25, neutral: 1 },
    { id: 'ParamEyeROpen', label: '右眼睑', min: 0, max: 1.25, neutral: 1 },
    { id: 'ParamMouthForm', label: '嘴形', min: -.6, max: .95, neutral: 0 },
    { id: 'ParamMouthOpenY', label: '表演开口', min: 0, max: .85, neutral: 0 }],
  expressions:['爱心眼','＞＜','屑屑眼','圈圈眼','脸红','兔牙','流冷汗','流泪','加载','黑脸','黑框眼镜','单片眼镜','钢盆','裙子切换','脱鞋','尾巴开关','胸口衣服'],
  exclusive_eye_expressions:['爱心眼','＞＜','屑屑眼','圈圈眼'],
  expression_strengths:{'脸红':.4,'黑脸':.85},
  expression_activation_thresholds:{'脸红':.82,'黑脸':.7,default:.65},
  expression_exclusions:[['黑脸','脸红'],['黑脸','爱心眼'],['黑脸','＞＜'],['黑脸','兔牙']],
  gesture_probability_threshold:.85,
  appearance_poses:['default','preset1','preset2'], native_motions:['none','脱捕'], native_motion_duration_ms:{'脱捕':13800},
  background_behavior:{idle:true,breath:true,blink:true,physicsEnabled:true},
  training_policy:{right_weights:[1,1,1],left_weights:[1,1],expression_positive_weight:1.5,expression_inactive_weight:1.5},
  source: 'program_authored_native_motion_inspired', sha256: '',
};
profile.sha256 = sha(JSON.stringify({ ...profile, sha256: undefined }));
export const sourceInfo = {
  file: 'live2d/DeepSeek/DeepSeek/Animation/脱捕.motion3.json', sha256: sha(readFileSync(sourceFile)), duration: source.Meta.Duration,
  role: 'native correlated motion texture and timing reference; not an audio-aligned human performance',
  native_channels: source.Curves.map((c: any) => c.Id),
  excluded: ['Movement1', 'Param11', 'Param55', 'Param56', 'Param57', 'Param58', 'Param36', 'Param39', 'Param41', 'Param42', 'Param43', 'JawOpen'],
  reason: 'raw tracking-loss effects are not copied; original expressions are scheduled by semantic choreography and become separate learned targets; hands retain native transitions',
};

export { families, variantCount } from './recipe';
import { expressionPlan, variantCount, type Family, type Pose } from './recipe';

const smooth = (x: number) => { x = Math.min(1, Math.max(0, x)); return x*x*(3-2*x); };
function key(t: number, points: [number, number][]) {
  if (t <= points[0][0]) return points[0][1];
  const i = points.findIndex(p => p[0] >= t);
  if (i < 0) return points.at(-1)![1];
  const a = points[i-1], b = points[i];
  return a[1] + (b[1]-a[1])*smooth((t-a[0])/(b[0]-a[0]));
}
const envelope = (t: number) => smooth((t-.12)/.6) * (1-smooth((t-4.8)/1.3));
function gestureLabels(pose: Pose, time: number) {
  const on = time >= 1.2 && time < 3.2;
  return { right: on && (pose.hand === 'point' || pose.hand === 'both') ? 1 : on && pose.hand === 'grass' ? 2 : 0,
    left: on && (pose.hand === 'chest' || pose.hand === 'both') ? 1 : 0 };
}

export function makeClip(family: Family, variant: number) {
  const p = {...family.pose}, count=variantCount(family), amplitude=[.6,.72,.85,.95,1.05,1.18][variant];
  if(family.id==='celebrate' && variant<4) delete p.hand;
  const tempo = [.95, 1.02, 1.08, .97, 1.04, .92, 1.06, 1][variant];
  const sourceStart = .35 + variant * .63;
  const values: number[][] = [], right: number[] = [], left: number[] = [];
  for (let i=0; i<64; i++) {
    const time = i/10, t = time*tempo, e = envelope(time);
    const beat = key(t, [[0,0],[.4,-.12],[1.15,1],[2.2,.55],[3.05,.9],[4.2,.22],[5.6,0],[6.4,0]]);
    const follow = key(t-.18, [[0,0],[.4,-.12],[1.15,1],[2.2,.55],[3.05,.9],[4.2,.22],[5.6,0],[6.4,0]]);
    const eyeLead = key(t+.12, [[0,0],[.4,-.12],[1.15,1],[2.2,.55],[3.05,.9],[4.2,.22],[5.6,0],[6.4,0]]);
    const texture = (id: string) => .14 * (sourceAt(id, Math.min(12.8, sourceStart+t*1.25))-sourceAt(id, sourceStart));
    let yaw = p.yaw*beat;
    let pitch = p.pitch*beat;
    if (family.id === 'agree_nod') pitch = key(t, [[0,0],[.35,1.2],[.85,-6],[1.3,2.8],[1.8,-3.7],[2.25,.8],[3.3,0],[6.4,0]]);
    if (family.id === 'deny_playful') yaw = key(t, [[0,0],[.45,-1.5],[1.1,9],[1.8,-8],[2.5,5.5],[3.3,-2],[4.4,0],[6.4,0]]);
    const bounce = (p.bounce ?? .1)*Math.sin(t*5.2)*Math.exp(-Math.max(0,t-.6)*.6);
    const output: Record<string,number> = {
      AngleX: amplitude*e*(yaw + texture('AngleX')),
      AngleY: amplitude*e*(pitch + texture('AngleY') + bounce*.7),
      AngleZ: amplitude*e*(p.tilt*beat + texture('AngleZ')),
      PositionX: amplitude*e*(-p.yaw*.27*follow + texture('PositionX')*.6),
      PositionY: amplitude*e*(-p.pitch*.22*follow + texture('PositionY')*.5 + bounce*.8),
      PositionZ: amplitude*e*(-p.tilt*.32*follow + texture('PositionZ')*.7),
      LeanInput: (p.lean ?? -.8)*amplitude*Math.max(0,follow)*e,
      ParamEyeBallX: -.018*p.yaw*eyeLead*e,
      ParamEyeBallY: (p.gazeY ?? -.025*p.pitch)*eyeLead*e,
      EyeSmile: (p.smile ?? .15)*Math.max(0,beat)*e,
      ParamBrowLY: (p.brow ?? .03)*beat*e,
      ParamBrowRY: (p.brow ?? .03)*beat*e*.88,
      ParamEyeLOpen: 1, ParamEyeROpen: 1,
      ParamMouthForm: (p.mouth ?? .2)*Math.max(0,beat)*e,
      ParamMouthOpenY: (p.open ?? 0)*Math.max(0,beat)*e,
    };
    for(const id of ['AngleX','AngleY']) output[id]*=1.65;
    output.AngleZ*=1.9;
    for(const id of ['PositionX','PositionY','PositionZ']) output[id]*=5.5;
    output.LeanInput*=2.15;
    output.ParamEyeBallX*=1.25;output.ParamEyeBallY*=1.25;
    output.EyeSmile*=1.25;output.ParamMouthForm*=1.2;output.ParamMouthOpenY*=1.2;
    // Blinks are synchronized to the attention shift; no periodic mouth flapping without audio.
    const close = 0; // Automatic blinking stays resident; only deliberate winks are learned.
    output.ParamEyeLOpen = 1-close; output.ParamEyeROpen = 1-close;
    if (p.wink) output.ParamEyeLOpen = Math.min(output.ParamEyeLOpen, 1-key(time, [[0,0],[1.25,0],[1.42,.94],[1.72,.94],[1.98,0],[6.4,0]]));
    if (family.id === 'surprise') {
      const surprise = key(time, [[0,0],[.5,0],[.85,1],[1.65,1],[2.3,0],[6.4,0]]);
      output.ParamEyeLOpen = Math.min(1.22,output.ParamEyeLOpen+surprise*.18);
      output.ParamEyeROpen = Math.min(1.22,output.ParamEyeROpen+surprise*.18);
    }
    // A neutral final tail permits complete native gesture exits before clip end.
    values.push(profile.channels.map(c => {
      const value = output[c.id];
      if (value < c.min-1e-6 || value > c.max+1e-6 || !Number.isFinite(value)) throw new Error(`${family.id}: ${c.id} out of bounds: ${value}`);
      return Number(value.toFixed(6));
    }));
    const hands = gestureLabels(p,time); right.push(hands.right); left.push(hands.left);
  }
  const expressions=Array.from({length:64},(_,i)=>profile.expressions.map(name=>(expressionPlan[family.id]??[]).some(([start,end,names])=>i/10>=start&&i/10<end&&names.includes(name))?1:0));
  const events: any[] = values.map((frame,i) => ({at_ms:i*100,method:'parameters.set',params:{values:Object.fromEntries(profile.channels.map((c,j) => [c.id,frame[j]])),duration_ms:100,stage:'pre'}}));
  for(let j=0;j<profile.expressions.length;j++){
    let last=0;expressions.forEach((frame,i)=>{if(frame[j]!==last){events.push({at_ms:i*100,method:'expressions.set',params:{name:profile.expressions[j],enabled:!!frame[j],strength:(profile.expression_strengths as any)[profile.expressions[j]]??1,fade_ms:180}});last=frame[j];}});
  }
  for (const [side, labels, poses] of [['right',right,['default','point_index','grass']],['left',left,['default','chest']]] as const) {
    let last = 0;
    labels.forEach((label,i) => { if(label !== last){events.push({at_ms:i*100,method:'gesture.set',params:{side,pose:poses[label]}});last=label;} });
  }
  events.sort((a,b) => a.at_ms-b.at_ms);
  const appearance=Array.from({length:64},(_,i)=>family.body && i>=10 && i<40 ? ['default','preset1','preset2'].indexOf(family.body) : 0);
  if(family.body){events.push({at_ms:1000,method:'appearance.set',params:{body:family.body}},{at_ms:4000,method:'appearance.set',params:{body:'default'}});}
  events.sort((a,b)=>a.at_ms-b.at_ms);
  const id = `${family.id}-${String(variant+1).padStart(2,'0')}`;
  return { id, family:family.id, label:family.label, variant, split:family.split, duration_ms:family.nativeMotion?13800:6400,
    profile_sha256:profile.sha256, source_type:'program_authored', style:'lively', kind:family.kind??(family.id.startsWith('anger')||family.id==='celebrate'?'expressive':'quiet'), representative:variant===Math.min(2,count-1), framing:family.id.startsWith('config_')?'full':'portrait', native_motion:family.nativeMotion??null, source_motion_sha256:sourceInfo.sha256,
    design:{variant_count:count,amplitude,tempo,source_start:sourceStart,head_body_lag_ms:180,gaze_lead_ms:120,hand_schedule:'1200ms enter / 3200ms exit',amplitude_revision:'head 1.65x / tilt 1.9x / body 5.5x / lean 2.15x; expressions supervised'},
    captions:[{utterance:family.texts[variant%family.texts.length],context:family.contexts[variant%family.contexts.length],style:variant<2?'restrained':variant<4?'natural':'lively'}],
    values,right,left,expressions,appearance,native_target:family.nativeMotion?1:0,command:{method:'timeline.play',params:{duration_ms:family.nativeMotion?13800:6400,events:family.nativeMotion?[{at_ms:0,method:'motions.play',params:{name:family.nativeMotion,loop:false}}]:events}} };
}
