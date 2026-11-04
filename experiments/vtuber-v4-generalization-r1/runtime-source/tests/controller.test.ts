import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Controller, type Manifest, type Parameter } from '../src/controller';
import { decodeCurve, sampleCurve } from '../src/motion';

const root = join(import.meta.dirname, '..', 'live2d', 'DeepSeek', 'DeepSeek');
const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const display = read(join(root, '大肥鱼.cdi3.json'));
const manifest: Manifest = {
  name: '大肥鱼', assetHash: 'test', baseUrl: '', modelUrl: '', display,
  physics: read(join(root, '大肥鱼.physics3.json')),
  expressions: readdirSync(join(root, 'Exp3')).map(file => ({ file, name: file.slice(0, -10), data: read(join(root, 'Exp3', file)) })),
  motions: readdirSync(join(root, 'Animation')).map(file => ({ file, name: file.slice(0, -13), data: read(join(root, 'Animation', file)), hold: /切出来|切换出来|默认手切举手/.test(file) })),
};
const parameters: Parameter[] = display.Parameters.map((p: any) => ({ id: p.Id, label: p.Name, group: p.GroupId, min: -30, max: 30, default: p.Id === 'Clothes1' ? 1 : 0, type: 0, physicsInput: false, physicsOutput: false }));
const make = () => new Controller(parameters, manifest);

test('resident blink survives a predicted open-eye override and background phase survives a pose reset', () => {
  const native = JSON.parse(readFileSync(join(import.meta.dirname, 'capabilities.json'), 'utf8'));
  const c = new Controller(native.parameters, manifest);
  c.execute('parameters.set', { values: { ParamEyeLOpen: 1, ParamEyeROpen: 1 } });
  for (let i=0;i<264;i++) c.evaluate(1/60);
  assert.ok(c.lastPre[c.indices.get('ParamEyeLOpen')!] < .02);
  assert.equal(c.lastActionPre[c.indices.get('ParamEyeLOpen')!], 1);
  c.execute('parameters.set', {values:{ParamEyeLOpen:1},duration_ms:100});
  c.evaluate(1/60);
  assert.equal(c.lastActionPre[c.indices.get('ParamEyeLOpen')!],1);
  const phase=c.backgroundTime;
  c.reset(false,true);
  assert.equal(c.backgroundTime,phase);
  assert.deepEqual(c.state().behavior,{idle:true,breath:true,blink:true,physicsEnabled:true});
  c.reset();assert.equal(c.backgroundTime,0);
});

test('model plans validate atomically and record their provenance while retaining native parameter events', () => {
  const c = make(); c.recording = { commands: [], provenance: [] };
  assert.throws(() => c.execute('trajectory.play', { provenance: { source: 'latent_policy' }, duration_ms: 2000, events: [{ at_ms: 0, method: 'parameters.set', params: { values: { Missing: 1 } } }] }));
  assert.equal(c.timeline, null); assert.equal(c.recording.provenance.length, 0);
  c.execute('trajectory.play', { provenance: { source: 'latent_policy', model_id: 'test' }, duration_ms: 2000, events: [{ at_ms: 0, method: 'parameters.set', params: { values: { AngleY: -7.25 } } }] });
  assert.equal(c.evaluate(0).pre[c.indices.get('AngleY')!], -7.25);
  assert.equal(c.recording.provenance[0].source, 'latent_policy'); assert.equal(c.recording.commands[0].method, 'parameters.set');
});

test('invalid parameter batch is atomic; clamping and zero-duration writes are explicit', () => {
  const c = make();
  assert.throws(() => c.execute('parameters.set', { values: { AngleX: 5, MissingId: 1 } }));
  assert.equal(c.overrides.size, 0);
  assert.throws(() => c.execute('parameters.set', { values: { AngleX: NaN } }));
  const result = c.execute('parameters.set', { values: { AngleX: 999 } });
  assert.deepEqual(result.clamped, ['AngleX']);
  assert.equal(c.evaluate(0).pre[c.indices.get('AngleX')!], 30);
});
test('expression Add uses the native default every frame and never accumulates', () => {
  const c = make(); c.execute('expressions.set', { name: '裙子切换', enabled: true, fade_ms: 0 });
  for (let i = 0; i < 120; i++) assert.equal(c.evaluate(1 / 60).pre[c.indices.get('Clothes1')!], 0);
  c.execute('expressions.set', { name: '裙子切换', enabled: false, fade_ms: 0 });
  assert.equal(c.evaluate(0).pre[c.indices.get('Clothes1')!], 1);
});
test('eye styles are exclusive and repeated enable requests are idempotent', () => {
  const c = make();
  c.execute('expressions.set', { name: '圈圈眼', enabled: true, fade_ms: 0 });
  c.execute('expressions.set', { name: '爱心眼', enabled: true, fade_ms: 0 });
  c.execute('expressions.set', { name: '爱心眼', enabled: true, fade_ms: 0 });
  const values = c.evaluate(0).pre;
  assert.equal(values[c.indices.get('key3')!], 0); assert.equal(values[c.indices.get('key4')!], 1);
});
test('replacement eyes are full on/off even with weak expression strength, fades or conflicting raw stages', () => {
  const c = make();
  c.execute('expressions.set', {name:'＞＜',enabled:true,strength:.12,fade_ms:800});
  assert.equal(c.evaluate(0).pre[c.indices.get('key5')!],1);
  c.execute('expressions.set', {name:'屑屑眼',enabled:true,strength:.59,exclusive:false});
  let values=c.evaluate(0).pre;assert.equal(values[c.indices.get('key5')!],0);assert.equal(values[c.indices.get('key6')!],1);
  c.execute('expressions.set', {name:'屑屑眼',enabled:false,fade_ms:800});
  assert.equal(c.evaluate(0).pre[c.indices.get('key6')!],0);
  c.execute('parameters.set',{values:{key3:.8,key4:.2}});
  c.execute('parameters.set',{values:{key5:.95},stage:'post'});
  let frame=c.evaluate(0);assert.equal(frame.post.key5,1);assert.equal(frame.pre[c.indices.get('key3')!],0);
  c.execute('parameters.release',{});c.execute('parameters.set',{values:{key3:.3,key4:.4,key5:.1,key6:.49}});
  values=c.evaluate(0).pre;for(const id of ['key3','key4','key5','key6'])assert.equal(values[c.indices.get(id)!],0);
});
test('hand motion masks leave decorative channels to idle and support both arms', () => {
  const c = make();
  c.execute('gesture.set', { side: 'right', pose: 'point_index' });
  c.execute('gesture.set', { side: 'left', pose: 'chest' });
  assert.equal(c.playbacks.size, 2);
  for (const track of c.playbacks.values()) assert.ok(track.curves.every(curve => !['Param56', 'Param57'].includes(curve.id)));
  for (let i = 0; i < 100; i++) c.evaluate(1 / 60);
  assert.ok(c.lastPre[c.indices.get('Movement2')!] > 0.99);
  assert.ok(c.lastPre[c.indices.get('Movement3')!] > 0.99);
});
test('semantic hand close releases a raw expression even when logical hand state was default', () => {
  const c = make(); c.execute('expressions.set', { name: '竖食指开', enabled: true, fade_ms: 0 });
  c.evaluate(0); assert.equal(c.lastPre[c.indices.get('Movement3')!], 1);
  c.execute('gesture.set', { side: 'right', pose: 'default' });
  for (let i = 0; i < 100; i++) c.evaluate(1 / 60);
  assert.equal(c.lastPre[c.indices.get('Movement3')!], 0);
});
test('unrestricted Bezier evaluation inverts nonlinear time and handles stepped curves', () => {
  const curve = decodeCurve({ Id: 'p', Target: 'Parameter', Segments: [0, 0, 1, 0, 1 / 3, 0, 2 / 3, 1, 1] });
  assert.ok(Math.abs(sampleCurve(curve, 0.125) - 0.5) < 1e-5);
  const step = decodeCurve({ Id: 'p', Target: 'Parameter', Segments: [0, 2, 2, 1, 8] });
  assert.equal(sampleCurve(step, 0.5), 2); assert.equal(sampleCurve(step, 1), 8);
});
test('timeline validates before replacing current plan and preserves fractional frame times', () => {
  const c = make(); c.execute('timeline.play', { events: [{ at_ms: 0, method: 'parameters.set', params: { values: { AngleX: 10 } } }] });
  const old = c.timeline;
  assert.throws(() => c.execute('timeline.play', { events: [{ at_ms: 0, method: 'parameters.set', params: { values: { Bad: 1 } } }] }));
  assert.equal(c.timeline, old);
  assert.equal(c.evaluate(1 / 60).pre[c.indices.get('AngleX')!], 10);
});
