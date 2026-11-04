/** Independent, fixed-condition research policy; never imported by production. */
export type Pose = Record<string, number>;
export type Meta = {id: string; min: number; max: number; default: number; physicsOutput: boolean};
export type Emotion = 'neutral' | 'happy' | 'shy' | 'angry';
export type Activity = 'idle' | 'playing' | 'buffering' | 'paused';
const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
export const smooth = (u: number) => { u = clamp(u); return 10 * u ** 3 - 15 * u ** 4 + 6 * u ** 5; };
type Sample = {value: number; velocity: number};

/** Quintic Hermite entry/replacement, matching position and velocity in ms. */
export class Curve {
  private at = 0; private from = 0; private speed = 0; private to = 0; private duration = 1;
  constructor(value = 0, velocity = 0, now = 0) { this.from = this.to = value; this.speed = velocity; this.at = now; }
  sample(now: number): Sample {
    const u = clamp((now - this.at) / this.duration);
    const w = smooth(u), dw = 30 * u ** 2 - 60 * u ** 3 + 30 * u ** 4;
    const q = u - 6 * u ** 3 + 8 * u ** 4 - 3 * u ** 5;
    const dq = 1 - 18 * u ** 2 + 32 * u ** 3 - 15 * u ** 4;
    return {value: (1 - w) * this.from + this.duration * q * this.speed + w * this.to,
      velocity: now >= this.at + this.duration ? 0 : dw * (this.to - this.from) / this.duration + dq * this.speed};
  }
  move(target: number, now: number, duration: number) {
    if (![target, now, duration].every(Number.isFinite) || duration <= 0) throw Error('Invalid curve');
    const old = this.sample(now); this.from = old.value; this.speed = old.velocity;
    this.to = target; this.at = now; this.duration = duration;
  }
}

export class Region {
  private curve: Curve; private releaseAt = Infinity; private fall = 500; private leaving = false;
  constructor(value = 0, velocity = 0, now = 0) { this.curve = new Curve(value, velocity, now); }
  set(target: number, now: number, rise: number, hold: number, fall: number) {
    if (![hold, rise, fall].every(Number.isFinite) || hold < 0 || rise <= 0 || fall <= 0) throw Error('Invalid region timing');
    this.sample(now); this.curve.move(target, now, rise); this.releaseAt = now + rise + hold; this.fall = fall; this.leaving = false;
  }
  release(now: number, fall = 300) { this.sample(now); this.curve.move(0, now, fall); this.leaving = true; }
  sample(now: number) {
    if (!this.leaving && now >= this.releaseAt) { this.curve.move(0, this.releaseAt, this.fall); this.leaving = true; }
    return this.curve.sample(now);
  }
}

/** Audio drives speech; idle drives silence; pause and rebuffer freeze both. */
export class StudyClock {
  now = 0; private speech: string | null = null; private audio = 0;
  step(dt: number, phase: Activity, speech: string | null, audio: number) {
    if (![dt, audio].every(Number.isFinite) || dt < 0 || audio < 0) throw Error('Invalid clock input');
    if (!dt || phase === 'paused') return this.now;
    if (speech !== this.speech) { this.speech = speech; this.audio = 0; }
    if (phase === 'playing') { this.now += Math.max(0, audio - this.audio); this.audio = Math.max(this.audio, audio); }
    else if (phase === 'idle') this.now += dt;
    return this.now;
  }
}

const affectTargets: Record<Emotion, number[]> = {neutral: [0, 0, 0], happy: [.65, .45, .25], shy: [.15, .25, -.65], angry: [-.7, .65, .55]};
export const idleKeys = ['ParamEyeBallX', 'ParamEyeBallY', 'AngleX', 'AngleZ', 'PositionX', 'LeanInput', 'ParamEyeLOpen', 'ParamEyeROpen'];
export const allowed = [...idleKeys, 'ParamBrowLY', 'ParamBrowRY', 'LEyeSquint', 'REyeSquint', 'ParamMouthForm', 'key1', 'key7'];
const randomGenerator = (seed: number) => () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; };
type IdleName = 'glance' | 'tilt' | 'settle' | 'slow_blink';
type Idle = {name: IdleName; direction: number; at: number; end: number; lanes: Map<string, Region>; yielded: boolean};

export class LivelinessPolicy {
  private metadata: Map<string, Meta>;
  private random: () => number;
  private affect = [new Region(), new Region(), new Region()];
  private regions = new Map<string, Region>();
  private director = new Map<string, {value: Curve; weight: Region}>();
  private seen = new Set<string>();
  private nextIdle: number;
  private currentIdle: Idle | null = null;
  private recent: string[] = [];
  private cooldown = new Map<IdleName, number>();
  private last = 0;
  private cancelled = false;
  epoch = 1;
  events: {at: number; kind: string; name?: string; direction?: number}[] = [];
  constructor(parameters: Meta[], seed = 9137) {
    this.metadata = new Map(parameters.map(p => [p.id, p]));
    for (const id of allowed) { const m = this.metadata.get(id); if (!m || m.physicsOutput) throw Error('Unsafe research ownership: ' + id); }
    this.random = randomGenerator(seed); this.nextIdle = this.interval();
  }
  private interval() { return 10000 + this.random() * 8000; }
  private lane(map: Map<string, Region>, id: string) { if (!map.has(id)) map.set(id, new Region()); return map.get(id)!; }
  emotion(emotion: Emotion, intensity: number, hold: number, now: number, key: string, epoch = this.epoch) {
    if (epoch !== this.epoch || this.cancelled || this.seen.has(key)) return false;
    if (!Object.hasOwn(affectTargets, emotion) || !Number.isFinite(intensity) || intensity < 0 || intensity > 1 || !Number.isFinite(hold) || hold < 0) throw Error('Invalid emotion');
    this.seen.add(key); while (this.seen.size > 256) this.seen.delete(this.seen.values().next().value!);
    affectTargets[emotion].forEach((value, i) => this.affect[i].set(value * intensity, now, 1200, Math.max(hold, 6000), 1800));
    const set = (id: string, value: number, rise: number, stay: number, fall: number) => this.lane(this.regions, id).set(value, now, rise, stay, fall);
    // The independent drawing overlays retain the same requested intensity.
    // Brief brow/gaze reactions use shorter lives than the emotional overlay.
    if (emotion === 'angry') {
      set('key1', intensity, 300, hold, 1000);
      for (const id of ['ParamBrowLY', 'ParamBrowRY']) set(id, -.22 * intensity, 260, 900, 800);
      set('LEyeSquint', .14 * intensity, 260, 900, 800); set('REyeSquint', .14 * intensity, 260, 900, 800);
    } else if (emotion === 'shy') {
      set('key7', intensity, 400, hold, 1300);
      set('ParamEyeBallX', .18 * intensity, 350, 900, 650); set('ParamEyeBallY', -.08 * intensity, 350, 900, 650);
      for (const id of ['ParamBrowLY', 'ParamBrowRY']) set(id, .12 * intensity, 300, 900, 750);
    } else if (emotion === 'happy') set('ParamMouthForm', .16 * intensity, 400, 1200, 700);
    else for (const lane of this.regions.values()) lane.release(now, 800);
    this.events.push({at: now, kind: 'emotion', name: emotion}); return true;
  }
  /** Research-only director targets are additive offsets, limited to owned inputs. */
  direct(targets: Pose, now: number, hold = 1000) {
    for (const [id, value] of Object.entries(targets)) if (!allowed.includes(id) || !Number.isFinite(value)) throw Error('Invalid director parameter');
    for (const [id, value] of Object.entries(targets)) {
      if (!this.director.has(id)) {
        this.director.set(id, {value: new Curve(value), weight: new Region()});
      } else this.director.get(id)!.value.move(value, now, 300);
      this.director.get(id)!.weight.set(1, now, 300, hold, 600);
    }
    this.events.push({at: now, kind: 'director'});
  }
  cancel(now: number) {
    this.epoch++; this.cancelled = true; this.seen.clear();
    for (const lane of this.regions.values()) lane.release(now, 500);
    for (const lane of this.director.values()) lane.weight.release(now, 500);
    this.yieldIdle(now); this.nextIdle = now + this.interval(); this.events.push({at: now, kind: 'cancel'});
  }
  resume() { this.cancelled = false; return this.epoch; }
  private yieldIdle(now: number) {
    if (!this.currentIdle || this.currentIdle.yielded) return;
    for (const lane of this.currentIdle.lanes.values()) lane.release(now, 300);
    this.currentIdle.yielded = true; this.currentIdle.end = now + 300;
    this.events.push({at: now, kind: 'idle_yield', name: this.currentIdle.name});
  }
  private startIdle(now: number) {
    const names: IdleName[] = ['glance', 'tilt', 'settle', 'slow_blink'];
    const candidates = names.filter(n => (this.cooldown.get(n) ?? -Infinity) <= now && !this.recent.includes(n));
    if (!candidates.length) { this.nextIdle = now + this.interval(); return; }
    const [v, a] = this.affect.map(l => l.sample(now).value);
    const weight = (n: IdleName) => n === 'slow_blink' ? 1 - a * .3 : n === 'tilt' ? 1 + v * .2 : 1;
    let choice = this.random() * candidates.reduce((s, n) => s + weight(n), 0), name = candidates.at(-1)!;
    for (const n of candidates) { choice -= weight(n); if (choice <= 0) { name = n; break; } }
    const direction = this.random() < .5 ? -1 : 1, lanes = new Map<string, Region>();
    const set = (id: string, target: number, rise = 500, hold = 600, fall = 800) => this.lane(lanes, id).set(target, now, rise, hold, fall);
    if (name === 'glance') { set('ParamEyeBallX', .2 * direction, 260, 700, 550); set('AngleX', 1.4 * direction); }
    else if (name === 'tilt') { set('AngleZ', 2.4 * direction); set('PositionX', -.55 * direction, 650, 500, 900); }
    else if (name === 'settle') { set('PositionX', .7 * direction, 650, 800, 1000); set('LeanInput', -.5, 700, 700, 1100); }
    else for (const id of ['ParamEyeLOpen', 'ParamEyeROpen']) set(id, -.82, 140, 70, 260);
    this.currentIdle = {name, direction, lanes, at: now, end: now + 2600, yielded: false};
    this.cooldown.set(name, now + 20000); this.recent.push(name); this.recent = this.recent.slice(-2);
    this.nextIdle = now + this.interval(); this.events.push({at: now, kind: 'idle_start', name, direction});
  }
  apply(now: number, base: Pose, activity: Activity, bodyOwned = false, manual: ReadonlySet<string> = new Set()) {
    if (!Number.isFinite(now) || now < this.last) throw Error('Research clock must be monotonic');
    this.last = now;
    const busy = activity === 'playing' || activity === 'buffering' || bodyOwned || this.cancelled;
    if (busy) { this.yieldIdle(now); this.nextIdle = Math.max(this.nextIdle, now + 2000); }
    if (this.currentIdle && now >= this.currentIdle.end) this.currentIdle = null;
    if (!busy && activity === 'idle' && !this.currentIdle && now >= this.nextIdle) this.startIdle(now);
    const offsets: Pose = {};
    for (const [id, lane] of this.regions) offsets[id] = lane.sample(now).value;
    if (this.currentIdle) for (const [id, lane] of this.currentIdle.lanes) offsets[id] = (offsets[id] ?? 0) + lane.sample(now).value;
    // Each explicit region yields its automatic lane separately; unrelated
    // expression/attention regions keep running. No whole-face reset.
    for (const [id, lane] of this.director) {
      const weight = clamp(lane.weight.sample(now).value), target = lane.value.sample(now).value;
      offsets[id] = (1 - weight) * (offsets[id] ?? 0) + weight * target;
    }
    const result = {...base};
    for (const [id, offset] of Object.entries(offsets)) {
      if (manual.has(id)) continue;
      const m = this.metadata.get(id)!; const raw = base[id] ?? m.default;
      result[id] = clamp(id.endsWith('Open') ? Math.min(raw, raw * (1 + offset)) : id === 'key1' || id === 'key7' ? Math.max(raw, offset) : raw + offset, m.min, m.max);
    }
    return result;
  }
  state(now = this.last) {
    return {clock_ms: now, epoch: this.epoch, affect: this.affect.map(l => l.sample(now).value),
      next_idle_ms: this.nextIdle, idle: this.currentIdle ? {name: this.currentIdle.name, direction: this.currentIdle.direction, at: this.currentIdle.at, yielded: this.currentIdle.yielded} : null,
      recent_idle: [...this.recent], event_count: this.events.length};
  }
}
