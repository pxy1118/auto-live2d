import { decodeCurve, sampleCurve, type Curve } from './motion';
import { normalizeEyeParameters } from './eye-style';

export interface Parameter {
  id: string; label: string; group: string; min: number; max: number; default: number;
  type: number; physicsOutput: boolean; physicsInput: boolean;
}
export interface Manifest {
  name: string; assetHash: string; modelUrl: string; baseUrl: string;
  display: any; physics: any;
  expressions: { name: string; file: string; data: any }[];
  motions: { name: string; file: string; data: any; hold: boolean }[];
  actionProfile?: any;
}
type Override = { from: number; to: number; start: number; duration: number; stage: 'pre' | 'post' };
type Playback = { name: string; curves: Curve[]; start: number; duration: number; loop: boolean; hold: boolean; finished: boolean; from: number[] };
type Expression = { name: string; from: number; to: number; start: number; fade: number };
type TimelineEvent = { at_ms: number; method: string; params?: any };
export class ControlError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
const clamp = (x: number, min: number, max: number) => Math.max(min, Math.min(max, x));
const smooth = (x: number) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const eyes = ['圈圈眼', '爱心眼', '＞＜', '屑屑眼'];
const bodies = ['默认体型', '体型1', '体型2'];
const recordable = new Set(['parameters.set', 'parameters.release', 'expressions.set', 'expressions.clear', 'gesture.set', 'appearance.set', 'motions.play', 'motions.stop', 'behavior.set', 'parts.set']);

export class Controller {
  time = 0;
  backgroundTime = 0;
  frame = 0;
  paused = false;
  idle = true;
  breath = true;
  blink = true;
  physicsEnabled = true;
  parameters: Parameter[];
  indices = new Map<string, number>();
  overrides = new Map<string, Override>();
  expressions = new Map<string, Expression>();
  playbacks = new Map<string, Playback>();
  partOverrides = new Map<string, number>();
  events: any[] = [];
  lastPre: number[];
  lastActionPre: number[];
  lastFinal: number[];
  gesture = { left: 'default', right: 'default' };
  timeline: { start: number; index: number; events: TimelineEvent[]; end: number } | null = null;
  recording: any = null;
  private decoded = new Map<string, Curve[]>();

  constructor(parameters: Parameter[], public manifest: Manifest, public partIds: string[] = []) {
    this.parameters = parameters;
    parameters.forEach((p, i) => this.indices.set(p.id, i));
    this.lastPre = parameters.map(p => p.default);
    this.lastActionPre = [...this.lastPre];
    this.lastFinal = [...this.lastPre];
    for (const motion of manifest.motions) this.decoded.set(motion.name, motion.data.Curves.map(decodeCurve));
  }
  emit(type: string, detail: any = {}) {
    this.events.push({ type, time_ms: Math.round(this.time * 1000), frame: this.frame, ...detail });
    if (this.events.length > 120) this.events.shift();
  }
  private fail(message: string): never { throw new ControlError('invalid_argument', message); }
  private number(value: any, label: string) {
    if (typeof value !== 'number' || !Number.isFinite(value)) this.fail(`${label} 必须是有限数字`);
    return value as number;
  }
  private duration(value: any, fallback = 0) {
    const n = value === undefined ? fallback : this.number(value, 'duration_ms');
    if (n < 0 || n > 600000) this.fail('时长必须在 0～600000 ms 之间');
    return n / 1000;
  }
  private requireId(id: string) {
    if (!this.indices.has(id)) throw new ControlError('unknown_parameter', `不存在的参数：${id}`);
    return this.indices.get(id)!;
  }
  private expressionWeight(e: Expression) {
    return e.from + (e.to - e.from) * smooth(e.fade ? (this.time - e.start) / e.fade : 1);
  }
  reset(paused = false, preserveBackground = false) {
    this.time = 0; this.frame = 0; this.paused = paused;
    if (!preserveBackground) this.backgroundTime = 0;
    this.idle = true; this.breath = true; this.blink = true; this.physicsEnabled = true;
    this.overrides.clear(); this.expressions.clear(); this.playbacks.clear(); this.partOverrides.clear();
    this.timeline = null; this.recording = null; this.events = [];
    this.gesture = { left: 'default', right: 'default' };
    this.lastPre = this.parameters.map(p => p.default); this.lastActionPre = [...this.lastPre]; this.lastFinal = [...this.lastPre];
    this.emit('reset');
  }
  private play(name: string, options: any = {}) {
    const asset = this.manifest.motions.find(m => m.name === name);
    if (!asset) throw new ControlError('unknown_motion', `不存在的动作：${name}`);
    const slot = options.slot ?? 'full';
    if (!['full', 'left', 'right'].includes(slot)) this.fail('动作 slot 必须为 full/left/right');
    for (const key of ['loop', 'hold']) if (options[key] !== undefined && typeof options[key] !== 'boolean') this.fail(`${key} 必须为布尔值`);
    if (slot === 'full') this.playbacks.clear();
    else this.playbacks.delete('full');
    let curves = this.decoded.get(name)!;
    if (slot !== 'full') curves = curves.filter(c => !['Param56', 'Param57'].includes(c.id));
    for (const curve of curves) this.overrides.delete(curve.id);
    this.playbacks.set(slot, {
      name, curves, start: this.time, duration: asset.data.Meta.Duration,
      loop: options.loop ?? (name === 'IDLE' || name === '脱捕'),
      hold: options.hold ?? asset.hold, finished: false, from: [...this.lastPre],
    });
    this.emit('motion_started', { name, slot });
    return { motion: name, slot, duration_ms: asset.data.Meta.Duration * 1000 };
  }
  execute(method: string, params: any = {}): any {
    if (!params || typeof params !== 'object' || Array.isArray(params)) this.fail('params 必须为对象');
    let result: any = {};
    switch (method) {
      case 'trajectory.play': {
        if (!params.provenance || params.provenance.source !== 'latent_policy' || JSON.stringify(params.provenance).length > 4000) this.fail('缺少轨迹模型来源');
        result = this.execute('timeline.play', { duration_ms: params.duration_ms, events: params.events });
        if (this.recording) (this.recording.provenance ??= []).push({ ...structuredClone(params.provenance), time_ms: this.time * 1000 });
        break;
      }
      case 'parameters.set': {
        if (!params.values || typeof params.values !== 'object' || Array.isArray(params.values)) this.fail('values 必须为参数 ID 到数值的对象');
        const entries = Object.entries(params.values);
        if (!entries.length) this.fail('values 不得为空');
        const duration = this.duration(params.duration_ms);
        if (params.stage !== undefined && !['pre', 'post'].includes(params.stage)) this.fail('stage 必须为 pre 或 post');
        // Validate every member before applying any member of an atomic batch.
        const validated = entries.map(([id, value]) => {
          const index = this.requireId(id); const p = this.parameters[index];
          return { id, index, requested: this.number(value, id), value: clamp(value as number, p.min, p.max) };
        });
        for (const p of validated) {
          const stage = params.stage ?? (this.parameters[p.index].physicsOutput ? 'post' : 'pre');
          this.overrides.set(p.id, { from: stage === 'post' ? this.lastFinal[p.index] : this.lastActionPre[p.index], to: p.value, start: this.time, duration, stage });
        }
        result = { values: Object.fromEntries(validated.map(p => [p.id, p.value])), clamped: validated.filter(p => p.requested !== p.value).map(p => p.id) };
        break;
      }
      case 'parameters.release': {
        const ids = params.ids ?? [...this.overrides.keys()];
        if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) this.fail('ids 必须为字符串数组');
        ids.forEach(id => this.requireId(id)); ids.forEach(id => this.overrides.delete(id));
        break;
      }
      case 'expressions.set': {
        const name = params.name;
        if (!this.manifest.expressions.some(e => e.name === name)) throw new ControlError('unknown_expression', `不存在的表情：${name}`);
        if (typeof params.enabled !== 'boolean') this.fail('enabled 必须明确为 true/false');
        let fade = this.duration(params.fade_ms, 200);
        let strength = params.strength === undefined ? 1 : this.number(params.strength, 'strength');
        if (strength < 0 || strength > 1) this.fail('strength 必须为 0～1');
        if (eyes.includes(name)) { strength = strength > 0 ? 1 : 0; fade = 0; }
        const group = eyes.includes(name) ? eyes : bodies.includes(name) ? bodies : [];
        if (params.enabled && (eyes.includes(name) || params.exclusive !== false)) {
          for (const other of group) if (other !== name) this.expressions.delete(other);
        }
        if (bodies.includes(name) && params.enabled && params.exclusive !== false) this.overrides.delete('Clothes2');
        const previous = this.expressions.get(name);
        this.expressions.set(name, { name, from: previous ? this.expressionWeight(previous) : 0, to: params.enabled ? strength : 0, start: this.time, fade });
        result = { name, enabled: params.enabled };
        break;
      }
      case 'expressions.clear': this.expressions.clear(); break;
      case 'appearance.set': {
        const presets = { default: 0, preset1: 0.4, preset2: 1 };
        if (!Object.hasOwn(presets, params.body)) this.fail('body 必须为 default/preset1/preset2');
        bodies.forEach(name => this.expressions.delete(name));
        result = this.execute('parameters.set', { values: { Clothes2: presets[params.body] }, duration_ms: 300 });
        break;
      }
      case 'gesture.set': {
        const side = params.side;
        if (!['left', 'right'].includes(side)) this.fail('side 必须为 left/right');
        const rawFingerExpression = side === 'right' && ['竖食指开', '竖食指关'].some(name => this.expressions.has(name));
        const switchIds = side === 'right' ? ['Movement1', 'Movement3'] : ['Movement2'];
        const actualRight = this.lastPre[this.indices.get('Movement1')!] > 0.5 ? 'grass' : this.lastPre[this.indices.get('Movement3')!] > 0.5 ? 'point_index' : 'default';
        const priorPose = side === 'right' && this.gesture.right === 'default' ? actualRight : this.gesture[side];
        const names = side === 'right'
          ? { default: priorPose === 'grass' ? '狗尾草切回默认手' : '竖手指切回默认', point_index: '竖手指切出来动画', grass: '狗尾草切换出来' }
          : { default: '举手切默认手', chest: '默认手切举手' };
        if (!Object.hasOwn(names, params.pose)) this.fail('该侧手势不支持此 pose');
        if (this.gesture[side] === params.pose && !rawFingerExpression && !switchIds.some(id => this.overrides.has(id)) && !this.playbacks.has('full') && priorPose === params.pose) return { side, pose: params.pose, unchanged: true };
        if (side === 'right') ['竖食指开', '竖食指关'].forEach(name => this.expressions.delete(name));
        result = this.play(names[params.pose], { slot: side, loop: false, hold: params.pose !== 'default' });
        this.gesture[side] = params.pose;
        // An explicit zero on the competing switch makes right-hand transitions unambiguous.
        if (side === 'right') {
          const other = params.pose === 'grass' ? 'Movement3' : 'Movement1';
          this.overrides.set(other, { from: 0, to: 0, start: this.time, duration: 0, stage: 'pre' });
        }
        break;
      }
      case 'motions.play': {
        result = this.play(params.name, params);
        if (params.name.includes('狗尾草')) this.gesture.right = params.name.includes('切回') ? 'default' : 'grass';
        if (params.name.includes('竖手指')) this.gesture.right = params.name.includes('切回') ? 'default' : 'point_index';
        if (params.name.includes('举手')) this.gesture.left = params.name.startsWith('默认手') ? 'chest' : 'default';
        break;
      }
      case 'motions.stop': this.playbacks.clear(); this.gesture = { left: 'default', right: 'default' }; break;
      case 'behavior.set': {
        const keys = ['idle', 'breath', 'blink', 'physicsEnabled'];
        for (const key of Object.keys(params)) if (!keys.includes(key) || typeof params[key] !== 'boolean') this.fail(`不支持的行为设置：${key}`);
        for (const key of keys) if (params[key] !== undefined) this[key] = params[key];
        break;
      }
      case 'parts.set': {
        if (!params.values || typeof params.values !== 'object' || Array.isArray(params.values)) this.fail('values 必须为部件 ID 到透明度的对象');
        const entries = Object.entries(params.values);
        for (const [id, value] of entries) {
          if (!this.partIds.includes(id)) throw new ControlError('unknown_part', `不存在的部件：${id}`);
          this.number(value, id);
        }
        for (const [id, value] of entries) this.partOverrides.set(id, clamp(value as number, 0, 1));
        break;
      }
      case 'timeline.play': {
        if (!Array.isArray(params.events) || params.events.length > 2000) this.fail('events 必须为不超过 2000 项的数组');
        const probe = new Controller(this.parameters, this.manifest, this.partIds);
        const events = params.events.map((event: TimelineEvent) => {
          this.duration(event.at_ms);
          if (!recordable.has(event.method)) this.fail(`时间轴不支持 ${event.method}`);
          probe.execute(event.method, event.params ?? {});
          return structuredClone(event);
        }).sort((a, b) => a.at_ms - b.at_ms);
        const end = Math.max(this.duration(params.duration_ms), (events.at(-1)?.at_ms ?? 0) / 1000);
        this.timeline = { start: this.time, index: 0, events, end };
        result = { events: events.length, duration_ms: end * 1000 };
        this.emit('timeline_started', result);
        break;
      }
      case 'timeline.cancel': this.timeline = null; this.emit('timeline_cancelled'); break;
      case 'demo.play': {
        result = this.execute('timeline.play', { duration_ms: 10000, events: [
          { at_ms: 0, method: 'parameters.set', params: { values: { AngleX: -12, AngleY: 4, ParamEyeBallX: 0.4 }, duration_ms: 600 } },
          { at_ms: 200, method: 'expressions.set', params: { name: '脸红', enabled: true, strength: 0.65 } },
          { at_ms: 600, method: 'gesture.set', params: { side: 'right', pose: 'point_index' } },
          { at_ms: 2200, method: 'parameters.set', params: { values: { AngleX: 12, ParamEyeBallX: -0.4 }, duration_ms: 800 } },
          { at_ms: 3400, method: 'gesture.set', params: { side: 'right', pose: 'default' } },
          { at_ms: 4300, method: 'expressions.set', params: { name: '爱心眼', enabled: true } },
          { at_ms: 4800, method: 'gesture.set', params: { side: 'left', pose: 'chest' } },
          { at_ms: 6000, method: 'parameters.set', params: { values: { AngleX: 0, AngleY: -4, ParamEyeBallX: 0 }, duration_ms: 700 } },
          { at_ms: 7300, method: 'expressions.clear', params: {} },
          { at_ms: 7700, method: 'gesture.set', params: { side: 'left', pose: 'default' } },
          { at_ms: 9300, method: 'parameters.release', params: {} },
        ] });
        break;
      }
      default: throw new ControlError('unknown_method', `不支持的方法：${method}`);
    }
    if (this.recording && !this.recording.limitReached && recordable.has(method)) {
      this.recording.commands.push({ at_ms: this.time * 1000, method, params: structuredClone(params) });
      if (this.recording.commands.length >= 2000) { this.recording.limitReached = true; this.recording.capture_end_ms = this.time * 1000; }
    }
    this.emit('command', { method, ...(['expressions.set', 'motions.play'].includes(method) ? { name: params.name } : {}) });
    return result;
  }
  evaluate(dt: number, actionTime?:number) {
    if(actionTime!==undefined)this.time=actionTime;
    if (this.timeline) {
      const timeline = this.timeline;
      while (timeline.index < timeline.events.length && timeline.events[timeline.index].at_ms <= (this.time - timeline.start) * 1000 + 1e-5) {
        const event = timeline.events[timeline.index++]; this.execute(event.method, event.params ?? {});
      }
    }
    if (dt > 0) { if(actionTime===undefined)this.time += dt; this.backgroundTime += dt; this.frame++; }
    if (this.timeline && this.timeline.index === this.timeline.events.length && this.time - this.timeline.start >= this.timeline.end) { this.timeline = null; this.emit('timeline_finished'); }
    const values = this.parameters.map(p => p.default);
    const set = (id: string, value: number) => { const i = this.indices.get(id); if (i !== undefined) values[i] = value; };
    const applyCurves = (curves: Curve[], time: number, from?: number[], weight = 1) => {
      for (const curve of curves) {
        const i = this.indices.get(curve.id);
        if (curve.target === 'Parameter' && i !== undefined) values[i] = from ? from[i] * (1 - weight) + sampleCurve(curve, time) * weight : sampleCurve(curve, time);
      }
    };
    if (this.breath) set('ParamBreath', 0.5 + 0.5 * Math.sin(this.backgroundTime * Math.PI / 2.4));
    const idle = this.manifest.motions.find(m => m.name === 'IDLE');
    if (this.idle && idle) applyCurves(this.decoded.get('IDLE')!, this.backgroundTime % idle.data.Meta.Duration);
    for (const [slot, track] of this.playbacks) {
      const elapsed = Math.max(0, this.time - track.start);
      const time = track.loop ? elapsed % track.duration : Math.min(track.duration, elapsed);
      applyCurves(track.curves, time, track.from, smooth(elapsed / 0.18));
      if (elapsed >= track.duration && !track.loop && !track.finished) {
        track.finished = true;
        this.emit('motion_finished', { name: track.name, slot, holding: track.hold });
        if (!track.hold) this.playbacks.delete(slot);
      }
    }
    for (const [name, e] of this.expressions) {
      const weight = this.expressionWeight(e);
      for (const p of this.manifest.expressions.find(a => a.name === name)!.data.Parameters) {
        const i = this.indices.get(p.Id); if (i === undefined) continue;
        if (p.Blend === 'Overwrite') values[i] = values[i] * (1 - weight) + p.Value * weight;
        else if (p.Blend === 'Multiply') values[i] *= 1 + (p.Value - 1) * weight;
        else values[i] += p.Value * weight;
      }
      if (!e.to && this.time - e.start >= e.fade) this.expressions.delete(name);
    }
    const post: Record<string, number> = {};
    for (const [id, o] of this.overrides) {
      const value = o.from + (o.to - o.from) * smooth(o.duration ? (this.time - o.start) / o.duration : 1);
      if (o.stage === 'post') post[id] = value; else set(id, value);
    }
    normalizeEyeParameters(values, this.indices, post);
    this.lastActionPre = values.map((v, i) => clamp(v, this.parameters[i].min, this.parameters[i].max));
    // A model may deliberately close/wink an eye; open-eye targets must not suppress the resident blink.
    if (this.blink) {
      const phase = this.backgroundTime % 4.7;
      if (phase > 4.25 && phase < 4.55) {
        const open = Math.abs((phase - 4.4) / 0.15);
        for (const id of ['ParamEyeLOpen', 'ParamEyeROpen']) {
          const index = this.indices.get(id); if (index !== undefined) values[index] = Math.min(values[index], open);
        }
      }
    }
    this.lastPre = values.map((v, i) => clamp(v, this.parameters[i].min, this.parameters[i].max));
    return { pre: this.lastPre, post };
  }
  blinkLimit(){
    if(!this.blink)return Infinity;
    const phase=this.backgroundTime%4.7;
    return phase>4.25&&phase<4.55?Math.abs((phase-4.4)/.15):Infinity;
  }
  acceptFinal(values: number[]) {
    this.lastFinal = values;
    if (this.recording && this.frame % 6 === 0) {
      if (this.recording.limitReached) return;
      if (this.recording.frames.length >= 3000) { this.recording.limitReached = true; this.recording.capture_end_ms = this.time * 1000; return; }
      if (this.recording.frames.at(-1)?.frame !== this.frame) this.recording.frames.push({ frame: this.frame, time_ms: Math.round(this.time * 1000), action_driver: [...this.lastActionPre], driver: [...this.lastPre], actual: [...values] });
    }
  }
  state(full = false) {
    return {
      frame: this.frame, time_ms: Math.round(this.time * 1000), background_time_ms: Math.round(this.backgroundTime * 1000), paused: this.paused,
      behavior: { idle: this.idle, breath: this.breath, blink: this.blink, physicsEnabled: this.physicsEnabled },
      expressions: [...this.expressions.values()].filter(e => e.to > 0).map(e => ({ name: e.name, strength: e.to })),
      motions: [...this.playbacks.entries()].map(([slot, m]) => ({ name: m.name, slot, holding: m.finished && m.hold })),
      gesture: this.gesture, timeline: !!this.timeline, overrides: this.overrides.size,
      recording: this.recording ? { frames: this.recording.frames.length, commands: this.recording.commands.length, limitReached: !!this.recording.limitReached } : null,
      events: this.events.slice(-30),
      ...(full ? { values: Object.fromEntries(this.parameters.map((p, i) => [p.id, valuesafe(this.lastFinal[i])])), driver: Object.fromEntries(this.parameters.map((p, i) => [p.id, valuesafe(this.lastPre[i])])), action_driver: Object.fromEntries(this.parameters.map((p, i) => [p.id, valuesafe(this.lastActionPre[i])])) } : {}),
    };
  }
}
const valuesafe = (n: number) => Number.isFinite(n) ? n : 0;
