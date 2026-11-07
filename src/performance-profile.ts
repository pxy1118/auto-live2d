import type { Parameter } from './controller';
import { DEFAULT_MOTION_STYLE, motionStyles } from './motor';
import { EMOTION_LABELS } from './emotion-config';
import { AFFECT_DIM, emotionCurvePolicy } from './emotion-config';
import { catalogCapabilities,EMOTION_BINDINGS } from './action-catalog';
import {DEFORMATION_EXPRESSIONS} from './emotion-expression';
import {FACE_CHANNELS} from './emotion-profiles';

export const STREAM_HZ = 20;
export const PERFORMANCE_RUNTIME_VERSION = 'v6.4.0-acting-feedback';
export const STREAM_FRAMES = 24;
export const STREAM_STEP_MS = 400;
export const eyeNames = ['normal', '＞＜', '圈圈眼', '爱心眼', '屑屑眼'];
export const faceKeys: Record<string, string> = {
  '黑脸': 'key1', '流泪': 'key2', '圈圈眼': 'key3', '爱心眼': 'key4', '＞＜': 'key5',
  '屑屑眼': 'key6', '脸红': 'key7', '加载': 'key8', '兔牙': 'key9', '流冷汗': 'key13',
};
export const emotions = EMOTION_LABELS;
// These are independent animation inputs, not the arm/sleeve physics outputs.
export const streamChannels = [
  'AngleX', 'AngleY', 'AngleZ', 'PositionX', 'PositionY', 'PositionZ', 'LeanInput',
  'ShoulderX', 'ShoulderYy', 'ParamEyeBallX', 'ParamEyeBallY', 'EyeSmile',
  'ParamBrowLY', 'ParamBrowRY', 'ParamBrowLAngle', 'ParamBrowRAngle', 'BrowInnerUp',
  'LEyeSquint', 'REyeSquint', 'ParamEyeLOpen', 'ParamEyeROpen', 'ParamMouthForm',
  'MouthX', 'Mouthpucker', 'CheeckPuff',
  'Param36', 'Param39', 'Param41', 'Param42', 'Param43', 'Param62', 'Param59', 'Param60', 'Param61',
  'Movement1', 'Movement2', 'Movement3', 'Param40',
];
/** Channels owned by the continuous branch (head, torso, shoulders, gaze background). */
export const backgroundChannels = [
  'AngleX', 'AngleY', 'AngleZ', 'PositionX', 'PositionY', 'PositionZ', 'LeanInput',
  'ParamEyeBallX', 'ParamEyeBallY',
] as const;
export const appearanceFields = {
  glasses: ['none', 'black', 'monocle'], skirt: ['long', 'short'], body: ['default', 'preset1', 'preset2'],
  shoes: [true, false], tail: [true, false], chest: ['default', 'alternate'], bowl: [false, true],
};
export const defaultAppearance = { glasses: 'none', skirt: 'short', body: 'default', shoes: true, tail: true, chest: 'default', bowl: false };
export function appearanceValues(a: typeof defaultAppearance): Record<string, number> {
  return {
    key11: a.glasses === 'black' ? 1 : 0, key12: a.glasses === 'monocle' ? 1 : 0, key10: a.bowl ? 1 : 0,
    Clothes1: a.skirt === 'short' ? 1 : 0, Clothes2: ({ default: 0, preset1: .4, preset2: 1 })[a.body],
    Clothes3: a.chest === 'alternate' ? 1 : 0, Clothes4: a.shoes ? 0 : 1, Clothes5: a.tail ? 1 : 0,
  };
}
export function performanceCapabilities(parameters: Parameter[]) {
  const expressions = new Set(Object.values(faceKeys));
  const appearance = new Set(Object.keys(appearanceValues(defaultAppearance)));
  const style = motionStyles[DEFAULT_MOTION_STYLE];
  return {
    version: 'performance.v6', runtime_version: PERFORMANCE_RUNTIME_VERSION, experimental: true,
    sampling_hz: STREAM_HZ, horizon_ms: 1200, update_ms: STREAM_STEP_MS,
    motion_driver: 'native28_motion', plan_schema: 'performance.plan.v4',
    motion_styles: ['restrained', 'natural', 'lively'], default_motion_style: DEFAULT_MOTION_STYLE,
    gesture_policy: { one_per_clause: true, minimum_gap_ms: style.gap, maximum_gesture_ms: style.duration, amplitude_independent_of_frequency: true, complete_after_short_clause: true },
    channels: parameters.filter(p => streamChannels.includes(p.id)),
    emotions: EMOTION_LABELS, emotion_labels: EMOTION_LABELS,
    affect: { dim: AFFECT_DIM, curve: emotionCurvePolicy },
    action_catalog: catalogCapabilities(),
    emotion_bindings: Object.fromEntries(EMOTION_LABELS.map(label=>[label,EMOTION_BINDINGS.get(label)])),
    eye_types: eyeNames, eye_policy: { exclusive: true, values: [0, 1], fading: false, automatic: 'deformation' }, expressions: [...Object.keys(faceKeys),...DEFORMATION_EXPRESSIONS],
    expression_channels:FACE_CHANNELS,acting_policy:{body:'trained_action_owns_selection',hand_gestures:'native_contact_pose',greeting:'body_until_palm_rigged',timing:'text_fraction_on_audio_with_preparation',black_face:{values:[0,1],on:.2,off:.09,on_dwell_ms:120,off_dwell_ms:300},eye_accents:{owner:'admitted_action_variant_or_explicit_director',double_blink_ms:500,wink_ms:620,once_per_action:true}},
    appearance, limits: { intensity: [0, 1], hold_ms: [0, 600000], clause_chars: 240 },
    methods: ['performance.start', 'performance.append', 'performance.finish', 'performance.cancel', 'performance.direct', 'performance.release', 'performance.state', 'performance.status', 'appearance.update', 'appearance.get', 'capabilities.get'],
    parameters: parameters.map(p => ({
      ...p, owner: appearance.has(p.id) ? 'appearance' : expressions.has(p.id) ? 'expression'
        : streamChannels.includes(p.id) ? 'action' : p.physicsOutput ? 'physics'
        : p.id.startsWith('Divider') || /----|■■|水印/.test(p.label) ? 'auxiliary' : 'raw',
      stage: p.physicsOutput ? 'post' : 'pre', render_verified: false,
    })),
  };
}
