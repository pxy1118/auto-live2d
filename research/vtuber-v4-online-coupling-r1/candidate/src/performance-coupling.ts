import type {Parameter} from './controller';
import type {PerformancePlan} from './performance-plan';
import {ease} from './body-motion';

export const couplingModes = ['current', 'mapped', 'mapped_micro'] as const;
export type CouplingMode = typeof couplingModes[number];
export const couplingOutputs = ['AngleX', 'AngleY', 'AngleZ', 'PositionX', 'PositionY', 'PositionZ', 'ParamEyeBallX', 'ParamEyeBallY'];
const microOutputs = ['ParamEyeLOpen', 'ParamEyeROpen', 'ParamBrowLY', 'ParamBrowRY', 'BrowInnerUp', 'ParamMouthForm'];
const owned = [...couplingOutputs, ...microOutputs];
const primary = {FaceAngleX: 'AngleX', FaceAngleY: 'AngleY', FaceAngleZ: 'AngleZ', EyeRightX: 'ParamEyeBallX', EyeRightY: 'ParamEyeBallY'};
export type CouplingSetting = {Input: string; OutputLive2D: string; InputRangeLower: number; InputRangeUpper: number;
  OutputRangeLower: number; OutputRangeUpper: number; Smoothing: number; ClampInput: boolean; ClampOutput: boolean};
type Pose = Record<string, number>;
type Transition = {at: number; position: number; velocity: number};
type Micro = {gazeX: number; gazeY: number; headX: number; brows: number; smile: number; lid: number};
type Reaction = {key: string; kind: 'welcome' | 'shy' | 'cajole'; at: number; strength: number};
const zero = (): Micro => ({gazeX: 0, gazeY: 0, headX: 0, brows: 0, smile: 0, lid: 0});
const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const envelope = (t: number, rise: number, hold: number, fall: number) =>
  t <= 0 || t >= rise + hold + fall ? 0 : t < rise ? ease(t / rise) : t < rise + hold ? 1 : 1 - ease((t - rise - hold) / fall);

/** Optional execution layer. Its clock is the actor's audio-derived action clock.
 * The original raw pose and the output pose are separate; filtered output never
 * becomes a fresh mapping input. No arm, drawing-mode, wardrobe or physics output
 * is owned here. Smoothing*5ms is an experimental interpretation of asset data. */
export class PerformanceCoupling {
  private rows: CouplingSetting[];
  private meta: Map<string, Parameter>;
  private filters: Pose = {};
  private raw: Pose = {};
  private output: Pose = {};
  private velocity: Pose = {};
  private transitions = new Map<string, Transition>();
  private routing = new Map<string, boolean>();
  private manual = new Set<string>();
  private reactions: Reaction[] = [];
  private seen = new Set<string>();
  private release: {at: number; value: Micro} | null = null;
  private lastMicro = zero();
  private microSuppressed = false;
  private clock = 0;
  private lastReaction = -Infinity;
  private selected: CouplingMode = 'current';
  private seeded = false;
  readonly transitionMs = 600;

  constructor(parameters: Parameter[], settings: CouplingSetting[] = []) {
    this.meta = new Map(parameters.map(p => [p.id, p]));
    const rows = Array.isArray(settings) ? settings.filter(s => couplingOutputs.includes(s?.OutputLive2D)) : [];
    this.rows = rows.length === 8 && new Set(rows.map(s => s.OutputLive2D)).size === 8 && rows.every(s =>
      primary[s.Input] && this.meta.has(s.OutputLive2D) && !this.meta.get(s.OutputLive2D)!.physicsOutput &&
      [s.InputRangeLower, s.InputRangeUpper, s.OutputRangeLower, s.OutputRangeUpper, s.Smoothing].every(Number.isFinite) &&
      s.InputRangeLower !== s.InputRangeUpper && s.OutputRangeLower !== s.OutputRangeUpper && s.Smoothing >= 0) ? rows.map(s => ({...s})) : [];
  }
  get mode() { return this.selected; }
  get active() { return this.selected !== 'current' || this.transitions.size > 0; }
  get available() { return this.rows.length === 8; }
  validate(mode: unknown): asserts mode is CouplingMode {
    if (!couplingModes.includes(mode as CouplingMode)) throw new Error('motion_coupling 必须为 current、mapped 或 mapped_micro');
    if (mode !== 'current' && !this.available) throw new Error('当前资产没有完整、安全的头身映射配置');
  }
  private value(pose: Pose, id: string) { return pose[id] ?? this.meta.get(id)?.default ?? 0; }
  private bound(id: string, v: number) { const p = this.meta.get(id); return p ? clamp(v, p.min, p.max) : v; }
  private seed(pose: Pose, velocity: Pose, now: number) {
    this.output = Object.fromEntries(owned.map(id => [id, this.bound(id, this.value(pose, id))]));
    this.filters = {...this.output}; this.velocity = {...velocity}; this.clock = now; this.seeded = true;
  }
  begin(mode: CouplingMode, pose: Pose, velocity: Pose, now: number) {
    this.validate(mode);
    this.raw = Object.fromEntries(owned.map(id => [id, this.value(pose, id)]));
    this.seen.clear(); this.lastReaction = -Infinity;
    this.configure(mode, pose, velocity, now);
  }
  configure(mode: CouplingMode, pose: Pose, velocity: Pose, now: number) {
    this.validate(mode);
    const wasEnabled = this.selected !== 'current' || this.transitions.size > 0;
    this.seed(pose, velocity, now); this.reactions = []; this.release = null; this.lastMicro = zero();
    this.selected = mode; this.transitions.clear(); this.routing.clear(); this.manual.clear();
    if (mode !== 'current' || wasEnabled) for (const id of owned) if (this.meta.has(id))
      this.transitions.set(id, {at: now, position: this.output[id], velocity: velocity[id] ?? 0});
  }
  clear() {
    this.selected = 'current'; this.transitions.clear(); this.routing.clear(); this.manual.clear();
    this.reactions = []; this.seen.clear(); this.release = null; this.lastMicro = zero(); this.raw = {}; this.seeded = false;
  }
  rawValue(id: string) { return this.selected !== 'current' || this.transitions.size ? this.raw[id] : undefined; }
  cancel(now: number) {
    this.reactions = [];
    this.release = {at: now, value: {...this.lastMicro}};
  }
  /** Only structured, already accepted model plans can trigger reactions. No text keywords. */
  plan(plan: PerformancePlan, key: string, now: number) {
    if (this.selected !== 'mapped_micro' || this.seen.has(key)) return;
    this.seen.add(key); while (this.seen.size > 256) this.seen.delete(this.seen.values().next().value!);
    if (now - this.lastReaction < 2800) return;
    let kind: Reaction['kind'] | undefined, strength = 1;
    if (plan.emotion === 'shy' && plan.confidence.emotion >= .7 && plan.expressions['脸红'] > .05) {
      kind = 'shy'; strength = clamp(plan.expressions['脸红'] / .7, .2, 1);
    } else if (plan.body === 'cajole' && plan.confidence.body >= .7 && plan.body_strength > .05) {
      kind = 'cajole'; strength = plan.body_strength;
    } else if (plan.arm === 'wave' && plan.confidence.arm >= .85 && ['neutral', 'happy', 'keep'].includes(plan.emotion)) kind = 'welcome';
    if (kind) { this.reactions.push({key, kind, at: now, strength}); this.lastReaction = now; }
  }
  private micro(now: number) {
    const v = zero();
    this.reactions = this.reactions.filter(r => now - r.at < 4000);
    for (const r of this.reactions) {
      const age = now - r.at, s = r.strength;
      if (r.kind === 'welcome') {
        v.brows += .16 * s * envelope(age - 300, 160, 150, 300);
        v.smile += .22 * s * envelope(age - 200, 350, 1400, 600);
      } else if (r.kind === 'shy') {
        const gaze = s * envelope(age - 450, 260, 700, 480);
        v.gazeX += .23 * gaze; v.gazeY -= .1 * gaze;
        // First study's added head turn increased the shy acceleration proxy.
        // Keep the finite gaze, omit that extra head turn in the online candidate.
        v.brows += .1 * s * envelope(age - 550, 300, 700, 450);
        v.lid += .7 * s * envelope(age - 1300, 160, 60, 240);
        v.smile += .2 * s * envelope(age - 250, 450, 1300, 650);
      } else {
        v.lid += .85 * s * envelope(age - 650, 170, 60, 250);
        v.smile += .25 * s * envelope(age - 250, 400, 1000, 600);
        v.gazeX += .12 * s * envelope(age - 350, 250, 600, 500);
      }
    }
    if (this.release) {
      const e = 1 - ease((now - this.release.at) / 350);
      for (const id of Object.keys(v)) v[id] += this.release.value[id] * e;
      if (!e) this.release = null;
    }
    v.lid = clamp(v.lid); return v;
  }
  private inverse(output: string, value: number) {
    const s = this.rows.find(s => s.OutputLive2D === output)!;
    return s.InputRangeLower + (value - s.OutputRangeLower) / (s.OutputRangeUpper - s.OutputRangeLower) * (s.InputRangeUpper - s.InputRangeLower);
  }
  private transform(s: CouplingSetting, input: number) {
    let u = (input - s.InputRangeLower) / (s.InputRangeUpper - s.InputRangeLower);
    if (s.ClampInput) u = clamp(u);
    let value = s.OutputRangeLower + u * (s.OutputRangeUpper - s.OutputRangeLower);
    if (s.ClampOutput) value = clamp(value, Math.min(s.OutputRangeLower, s.OutputRangeUpper), Math.max(s.OutputRangeLower, s.OutputRangeUpper));
    return value;
  }
  apply(pose: Pose, base: Pose, now: number, manual: ReadonlySet<string> = new Set(), bypass: ReadonlySet<string> = new Set(), suppressMicro = false) {
    if (!this.seeded) this.seed({...base, ...pose}, {}, now);
    const dt = Math.max(0, now - this.clock), oldOutput = {...this.output};
    this.clock = now;
    this.raw = Object.fromEntries(owned.map(id => [id, this.value({...base, ...pose}, id)]));
    const active = this.selected !== 'current' || this.transitions.size > 0;
    if (!active) return pose;
    if (suppressMicro && (!this.microSuppressed || this.reactions.length)) this.cancel(now);
    this.microSuppressed = suppressMicro;
    const micro = this.micro(now);
    this.lastMicro = {...micro};
    const target = {...this.raw};
    if (this.selected !== 'current') {
      const inputs = Object.fromEntries(Object.entries(primary).map(([input, id]) => [input, this.inverse(id, this.raw[id])])) as Pose;
      inputs.FaceAngleX += micro.headX;
      inputs.EyeRightX = this.inverse('ParamEyeBallX', this.raw.ParamEyeBallX + micro.gazeX);
      inputs.EyeRightY = this.inverse('ParamEyeBallY', this.raw.ParamEyeBallY + micro.gazeY);
      for (const s of this.rows) {
        const id = s.OutputLive2D, useMapping = !bypass.has(id);
        if (this.routing.has(id) && this.routing.get(id) !== useMapping)
          this.transitions.set(id, {at: now, position: this.output[id], velocity: this.velocity[id] ?? 0});
        this.routing.set(id, useMapping);
        const wanted = this.bound(id, this.transform(s, inputs[s.Input]));
        if (!manual.has(id) && dt > 0) {
          const tau = s.Smoothing * 5;
          this.filters[id] += (wanted - this.filters[id]) * (tau ? -Math.expm1(-dt / tau) : 1);
        }
        target[id] = useMapping ? this.filters[id] : this.raw[id];
      }
    }
    for (const id of ['ParamEyeLOpen', 'ParamEyeROpen']) target[id] *= 1 - micro.lid;
    target.ParamBrowLY += micro.brows; target.ParamBrowRY += micro.brows;
    target.BrowInnerUp += micro.brows * .4; target.ParamMouthForm += micro.smile;
    const result = {...pose};
    for (const id of owned) {
      const parameter = this.meta.get(id); if (!parameter || parameter.physicsOutput) continue;
      if (manual.has(id)) {
        this.output[id] = this.filters[id] = this.value(base, id);
        this.transitions.delete(id); this.manual.add(id); continue;
      }
      if (this.manual.delete(id)) this.transitions.set(id, {at: now, position: this.output[id], velocity: this.velocity[id] ?? 0});
      const transition = this.transitions.get(id);
      let value = target[id];
      if (transition) {
        const u = clamp((now - transition.at) / this.transitionMs), w = ease(u), q = u - 6 * u ** 3 + 8 * u ** 4 - 3 * u ** 5;
        value = (1 - w) * transition.position + this.transitionMs * q * transition.velocity + w * value;
        if (u === 1) this.transitions.delete(id);
      } else if (dt === 0) value = this.output[id];
      this.output[id] = this.bound(id, value); result[id] = this.output[id];
    }
    if (dt > 0) for (const id of owned) this.velocity[id] = (this.output[id] - oldOutput[id]) / dt;
    return result;
  }
  state() { return {mode: this.selected, available: this.available, experimental: this.selected !== 'current', clock_ms: this.clock,
    transition_ms: this.transitionMs, transitioning_channels: [...this.transitions.keys()], active_reactions: this.reactions.map(r => ({...r})),
    micro: {...this.lastMicro}, owned_channels: this.selected === 'current' && !this.transitions.size ? [] : owned.filter(id => this.meta.has(id)),
    smoothing_interpretation: 'asset Smoothing * 5ms; experimental', raw: {...this.raw}, output: {...this.output}}; }
}
