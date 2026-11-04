import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {Curve, Region, StudyClock, LivelinessPolicy, allowed, type Pose} from '../research/vtuber-v4-liveliness-r1/policy';
const root = join(import.meta.dirname, '..');
const parameters = JSON.parse(readFileSync(join(root, 'research/vtuber-v4-mapping-r1/parameters.json'), 'utf8'));
const base: Pose = Object.fromEntries(parameters.map((p: any) => [p.id, p.default]));
const close = (x: number, y: number, e = 1e-7) => assert.ok(Math.abs(x - y) < e, `${x} != ${y}`);

test('replacement matches current position and velocity; envelopes release at their own deadlines', () => {
  const c = new Curve(6); c.move(-2, 0, 900); const a = c.sample(413); c.move(3, 413, 600);
  close(c.sample(413).value, a.value); close(c.sample(413).velocity, a.velocity);
  close(c.sample(1013).value, 3); close(c.sample(1013).velocity, 0);
  const brow = new Region(), overlay = new Region(); brow.set(.3, 0, 200, 800, 500); overlay.set(.7, 0, 300, 4000, 1000);
  close(brow.sample(1800).value, 0); close(overlay.sample(1800).value, .7); close(overlay.sample(5400).value, 0);
});
test('audio clock ignores render duplication, pause, rebuffer and backwards media time', () => {
  const c = new StudyClock(); close(c.step(17, 'playing', 'a', 100), 100); close(c.step(17, 'playing', 'a', 100), 100);
  close(c.step(1000, 'paused', 'a', 100), 100); close(c.step(900, 'buffering', 'a', 100), 100);
  close(c.step(17, 'playing', 'a', 90), 100); close(c.step(17, 'playing', 'a', 120), 120);
  close(c.step(17, 'playing', 'b', 20), 140); close(c.step(100, 'idle', null, 0), 240);
});
test('non-default initial pose is retained and only safe parameter owners are accepted', () => {
  const p = new LivelinessPolicy(parameters), pose = {...base, AngleX: 12, AngleZ: -5, LeanInput: -3, Param36: .28, Movement3: 1};
  assert.deepEqual(p.apply(0, pose, 'idle'), pose);
  assert.deepEqual(p.apply(9000, pose, 'idle'), pose);
  assert.throws(() => p.direct({Param36: 1}, 0)); assert.throws(() => p.direct({ParamAngleX: 12}, 0));
  assert.throws(() => new LivelinessPolicy(parameters.map((m: any) => m.id === 'AngleX' ? {...m, physicsOutput: true} : m)));
});
test('emotion persists across silence and clauses; intensity does not depend on confidence', () => {
  const p = new LivelinessPolicy(parameters); assert.ok(p.emotion('shy', .38, 5000, 500, 'clause0'));
  p.apply(2000, base, 'playing'); const a = p.state(2000).affect;
  p.apply(4000, base, 'buffering'); const b = p.state(4000).affect;
  assert.ok(a[2] < -.2 && b[2] < -.2);
  assert.equal(p.apply(4000, base, 'playing').key7, .38);
  assert.equal(p.emotion('shy', .9, 5000, 4000, 'clause0'), false, 'duplicate must not intensify');
  assert.ok(p.emotion('happy', .3, 4000, 4440, 'clause1'));
  close(p.state(4440).affect[2], b[2]); assert.ok(p.state(5700).affect[2] > 0);
});
test('director face takeover is continuous and does not reset unrelated regions', () => {
  const p = new LivelinessPolicy(parameters); p.emotion('shy', .6, 4000, 0, 'shy');
  const before = p.apply(600, base, 'playing'); p.direct({ParamEyeBallX: -.2}, 600, 1000);
  const after = p.apply(600, base, 'playing'); close(before.ParamEyeBallX, after.ParamEyeBallX);
  close(before.key7, after.key7); assert.ok(p.apply(1000, base, 'playing').ParamEyeBallX < -.19);
  assert.ok(p.apply(3000, base, 'playing').ParamEyeBallX >= base.ParamEyeBallX);
});
test('director expiration restores the current automatic pose instead of replaying the masked reaction', () => {
  const a = new LivelinessPolicy(parameters), b = new LivelinessPolicy(parameters);
  for (const p of [a, b]) {p.emotion('shy', .6, 4000, 0, 'first'); p.apply(600, base, 'playing');}
  a.direct({ParamEyeBallX: -.2}, 600, 300);
  for (const p of [a, b]) p.emotion('shy', .4, 4000, 900, 'new');
  const current = a.apply(1800, base, 'playing'), expected = b.apply(1800, base, 'playing');
  close(current.ParamEyeBallX, expected.ParamEyeBallX); close(current.key7, expected.key7);
});
test('idle has bounded frequency, action cooldown and no repeated recent action', () => {
  const p = new LivelinessPolicy(parameters);
  for (let t = 0; t <= 600000; t += 1000 / 60) p.apply(t, base, 'idle');
  const e = p.events.filter(e => e.kind === 'idle_start'); assert.ok(e.length >= 25 && e.length <= 61);
  for (let i = 0; i < e.length; i++) {
    if (i) assert.ok(e[i].at - e[i - 1].at >= 9999);
    assert.ok(!e.slice(Math.max(0, i - 2), i).some(x => x.name === e[i].name));
    const prior = e.slice(0, i).reverse().find(x => x.name === e[i].name); if (prior) assert.ok(e[i].at - prior.at >= 20000);
  }
});
test('speaking yields idle without a position jump, and a stalled clock starts no burst', () => {
  const p = new LivelinessPolicy(parameters); let t = 0;
  while (!p.state().idle) { p.apply(t, base, 'idle'); t += 1000 / 60; }
  t += 600; const before = p.apply(t, base, 'idle'), yielded = p.apply(t, base, 'playing');
  assert.deepEqual(yielded, before);
  const after = p.apply(t + 350, base, 'playing'); for (const id of allowed) close(after[id], base[id]);
  for (let i = 0; i < 50; i++) p.apply(t + 350, base, 'buffering');
  assert.equal(p.events.filter(e => e.kind === 'idle_start').length, 1);
  p.apply(t + 100000, base, 'idle'); assert.equal(p.events.filter(e => e.kind === 'idle_start').length, 2);
});
test('pause preserves an in-flight idle action without scheduling or cancelling it', () => {
  const p = new LivelinessPolicy(parameters); let t = 0;
  while (!p.state().idle) { p.apply(t, base, 'idle'); t += 17; }
  const before = p.apply(t + 500, base, 'idle'), state = p.state();
  for (let i = 0; i < 20; i++) assert.deepEqual(p.apply(t + 500, base, 'paused'), before);
  assert.deepEqual(p.state(), state); assert.ok(!p.state().idle?.yielded);
});
test('cancel rejects late results; resume preserves affect and does not replay old reactions', () => {
  const p = new LivelinessPolicy(parameters); const epoch = p.epoch;
  p.emotion('angry', .7, 4000, 0, 'a', epoch); p.apply(1400, base, 'playing');
  const affect = p.state().affect; p.cancel(1400); assert.equal(p.emotion('shy', 1, 6000, 1500, 'late', epoch), false);
  p.apply(2000, base, 'idle'); assert.ok(p.state().affect[0] <= affect[0]); close(p.apply(2000, base, 'idle').key1, 0);
  const next = p.resume(); assert.equal(next, epoch + 1); assert.equal(p.emotion('shy', 1, 6000, 2100, 'late', epoch), false);
});
test('special eye drawings, arms, wardrobe and physics outputs retain their owners', () => {
  const p = new LivelinessPolicy(parameters); p.emotion('shy', .5, 5000, 0, 'shy');
  const pose: Pose = {...base, key3: 1, key5: 0, key11: 1, Clothes1: 0, Param36: .3, Movement3: 1, ParamAngleX: 9};
  for (let t = 0; t < 10000; t += 17) {
    const v = p.apply(t, pose, 'playing');
    for (const id of Object.keys(pose)) if (!allowed.includes(id)) assert.equal(v[id], pose[id], id);
    for (const value of Object.values(v)) assert.ok(Number.isFinite(value));
  }
});
test('analytic region output agrees across 30, 60 and 120 Hz sample paths', () => {
  const at = (hz: number) => { const p = new LivelinessPolicy(parameters); p.emotion('angry', .7, 4000, 0, 'a'); for (let i = 0; i < hz * 2; i++) p.apply(i / hz * 1000, base, 'playing'); return p.apply(2000, base, 'playing'); };
  const a = at(30), b = at(60), c = at(120); for (const id of allowed) { close(a[id], b[id]); close(b[id], c[id]); }
});
