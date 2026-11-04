/** Reproduce captured candidate inputs using the final policy source. */
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {LivelinessPolicy, type Pose} from '../../research/vtuber-v4-liveliness-r1/policy';
const root = join(import.meta.dirname, '../..'), study = join(root, 'research/vtuber-v4-liveliness-r1'), out = join(root, 'test-results/v4-liveliness-r1');
const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const unpack = (p: string) => JSON.parse(gunzipSync(readFileSync(p)).toString());
const meta = read(join(study, 'parameters.json')), defaults: Pose = Object.fromEntries(meta.map((p: any) => [p.id, p.default]));
let frames = 0;
for (const scene of read(join(study, 'protocol.json')).scenes) {
  const current = unpack(join(out, scene.id + '-current/input.json.gz')).params;
  const recorded = unpack(join(out, scene.id + '-state_idle/input.json.gz')).params;
  const archived = scene.cached_scene ? read(join(root, scene.cached_scene, 'scene.json')) : null;
  const p = new LivelinessPolicy(meta); let event = 0;
  for (let f = 0; f < current.values.length; f++) {
    const now = f / 60 * 1000;
    while (event < scene.events.length && scene.events[event].at_ms <= now + 1e-6) {
      const e = scene.events[event]; p.emotion(e.emotion, e.intensity, e.hold_ms, now, 'event-' + event); event++;
    }
    const base = {...defaults, ...Object.fromEntries(current.channels.map((k: string, j: number) => [k, current.values[f][j]])), key1: 0, key7: 0};
    const playing = !!archived?.cues.some((c: any) => now >= c.at_ms && now < c.end_ms);
    const row = p.apply(now, base, playing ? 'playing' : 'idle');
    assert.deepEqual(recorded.values[f], recorded.channels.map((k: string) => row[k] ?? defaults[k]), scene.id + ':' + f);
    frames++;
  }
}
const report = {ok: true, reproduced_candidate_frames: frames,
  policy_sha256: createHash('sha256').update(readFileSync(join(study, 'policy.ts'))).digest('hex')};
writeFileSync(join(out, 'policy-reproduction.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
