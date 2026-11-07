import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EMOTION_PROFILES, FACE_CHANNELS, OVERLAY_NAMES, EYE_TYPES,
  type EmotionProfile, type OverlayName,
} from '../src/emotion-profiles';
import emotionConfig from '../contracts/emotion-config.json';
import {EMOTION_LABELS} from '../src/emotion-config';
const FAMILIES = ['happy', 'angry', 'shy', 'sad', 'surprised', 'confused'] as const;
const nonNeutralLabels = EMOTION_LABELS.filter(label => label !== 'neutral');

function profile(label: string): EmotionProfile {
  const value = EMOTION_PROFILES[label];
  assert.ok(value, `缺少 ${label} profile`);
  return value!;
}

test('28 个 profile 与契约标签一一对应，VAD 只存在于契约', () => {
  assert.equal(EMOTION_LABELS.length, 28);
  assert.deepEqual(Object.keys(EMOTION_PROFILES), [...EMOTION_LABELS]);
  const presets = (emotionConfig as any).vad_presets as Record<string, number[]>;
  for (const label of EMOTION_LABELS) {
    const entry = profile(label);
    assert.equal(entry.label, label);
    assert.ok(Object.hasOwn(presets, label), `缺少 ${label} 的 vad_preset`);
    assert.equal(Object.hasOwn(entry as any, 'vad'), false, `${label} 不应在 profile 里重复携带 VAD`);
  }
});

test('family 覆盖六类且取值全部合法', () => {
  const used = new Set(Object.values(EMOTION_PROFILES).map(entry => entry.family));
  assert.deepEqual([...used].sort(), [...FAMILIES].sort());
  for (const entry of Object.values(EMOTION_PROFILES)) assert.ok((FAMILIES as readonly string[]).includes(entry.family), entry.label);
});

test('face 通道合法、数值有限且落在 ±0.7 内', () => {
  const channels = new Set<string>(FACE_CHANNELS);
  for (const entry of Object.values(EMOTION_PROFILES)) {
    assert.ok(Object.keys(entry.face).length > 0, `${entry.label} 缺少放松表情基线`);
    for (const [channel, value] of Object.entries(entry.face)) {
      assert.ok(channels.has(channel), `${entry.label} 非法 face 通道 ${channel}`);
      assert.ok(Number.isFinite(value) && Math.abs(value) <= .7, `${entry.label}.${channel}=${value} 超出 ±0.7`);
    }
  }
});

test('overlay 取值合法，特殊眼型保持为独立导演选项', () => {
  const overlays = new Set<string>(OVERLAY_NAMES);
  for (const entry of Object.values(EMOTION_PROFILES)) {
    for (const [name, value] of Object.entries(entry.overlay)) {
      assert.ok(overlays.has(name), `${entry.label} 非法 overlay ${name}`);
      assert.ok(Number.isFinite(value) && value >= 0 && value <= 1, `${entry.label}.${name}=${value} 超出 0..1`);
    }

  }
  const overlayOf = (label: string, name: OverlayName) => profile(label).overlay[name] ?? 0;
  for (const label of ['anger', 'annoyance', 'disapproval', 'disgust']) assert.ok(overlayOf(label, '黑脸') > 0, `${label} 应有黑脸`);
  for (const label of ['sadness', 'grief']) assert.ok(overlayOf(label, '流泪') > 0, `${label} 应有流泪`);
  assert.ok(overlayOf('embarrassment', '脸红') > 0);
  for (const label of ['fear', 'nervousness']) assert.ok(overlayOf(label, '流冷汗') > 0, `${label} 应有流冷汗`);
  assert.deepEqual(EYE_TYPES, ['＞＜', '圈圈眼', '爱心眼', '屑屑眼']);
  assert.ok(!FACE_CHANNELS.includes('ParamMouthOpenY' as any), 'audio owns lip opening');
});

test('intensity 合法；neutral 为 [0,0] 且表情接近零', () => {
  for (const entry of Object.values(EMOTION_PROFILES)) {
    const [lo, hi] = entry.intensity;
    assert.equal(entry.intensity.length, 2, entry.label);
    assert.ok(Number.isFinite(lo) && Number.isFinite(hi), entry.label);
    assert.ok(lo >= 0 && lo <= hi && hi <= 1, `${entry.label} intensity=[${lo},${hi}] 不合法`);
  }
  assert.deepEqual(profile('neutral').intensity, [0, 0]);
  const neutral = profile('neutral');
  for (const [channel, value] of Object.entries(neutral.face)) assert.ok(Math.abs(value) <= .05, `neutral.${channel}=${value} 应接近 0`);
  assert.deepEqual(neutral.overlay, {});
  for (const label of nonNeutralLabels) {
    const entry = profile(label);
    assert.ok(entry.intensity[1] > 0, `${label} 非中性 profile 的 intensity 上限不应为 0`);
  }
});

test('VAD presets 覆盖全部 28 标签且三分量合法', () => {
  const presets = (emotionConfig as any).vad_presets as Record<string, number[]>;
  assert.deepEqual(Object.keys(presets).sort(), [...EMOTION_LABELS].sort());
  for (const [label, vector] of Object.entries(presets)) {
    assert.ok(Array.isArray(vector) && vector.length === 3, `${label} VAD 维度错误`);
    for (const value of vector) assert.ok(Number.isFinite(value) && value >= -1 && value <= 1, `${label} VAD 分量越界：${value}`);
  }
});
