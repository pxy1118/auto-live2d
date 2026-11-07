import {EMOTION_LABELS} from './emotion-config';

/** Facial deformation inputs. Lip opening remains owned by audio; the resident
 * blink can still close either eyelid after this layer has shaped the face. */
export const FACE_CHANNELS = ['EyeSmile', 'ParamMouthForm', 'ParamBrowLY', 'ParamBrowRY', 'BrowInnerUp', 'LEyeSquint', 'REyeSquint', 'ParamEyeBallX', 'ParamEyeBallY', 'ParamEyeLOpen', 'ParamEyeROpen', 'MouthX', 'Mouthpucker', 'CheeckPuff'] as const;
export type FaceChannel = typeof FACE_CHANNELS[number];

/** The four authored overlay drawings. Zero means "not drawn". */
export const OVERLAY_NAMES = ['黑脸', '流泪', '脸红', '流冷汗'] as const;
export type OverlayName = typeof OVERLAY_NAMES[number];

/** Replacement eye drawings are emotion expressions, so they live here rather
 * than in the action planner. `normal` is the absence of any entry. */
export const EYE_TYPES = ['＞＜', '圈圈眼', '爱心眼', '屑屑眼'] as const;
export type EyeType = typeof EYE_TYPES[number];

/**
 * One of the 28 native classifier labels mapped onto an ordinary expression.
 * `face` values are additive offsets on the face parameters; `overlay`
 * contains 0..1 drawing affinities. `intensity` is the plausible [lo, hi] range
 * used to gate expressions and to clamp scheduled action strength. VAD is not
 * repeated here: it lives in contracts/emotion-config.json (`vad_presets`).
 */
export type EmotionProfile = {
  label: string;
  family: 'happy' | 'angry' | 'shy' | 'sad' | 'surprised' | 'confused';
  face: Partial<Record<FaceChannel, number>>;
  overlay: Partial<Record<OverlayName, number>>;
  intensity: [number, number];
};

/**
 * 28 authored deformation profiles. Family is descriptive metadata only; all
 * 28 native dimensions contribute directly. Replacement eye drawings remain
 * available as explicit director expressions, so they cannot mask eyelid acting.
 * Facial offsets stay within ±0.7, overlays within 0..1.
 */
export const EMOTION_PROFILES: Record<string, EmotionProfile> = {
  admiration: {
    label: 'admiration', family: 'happy',
    face: {EyeSmile: .18, ParamMouthForm: .16, ParamBrowLY: .10, ParamBrowRY: .10, BrowInnerUp: .16, ParamEyeLOpen: 0.12, ParamEyeROpen: 0.12, ParamEyeBallY: 0.1},
    overlay: {}, intensity: [.3, .75],
  },
  amusement: {
    label: 'amusement', family: 'happy',
    face: {EyeSmile: .40, ParamMouthForm: .34, BrowInnerUp: .04, ParamEyeBallY: .03, ParamEyeLOpen: -0.58, ParamEyeROpen: -0.48, LEyeSquint: 0.25, REyeSquint: 0.2, MouthX: 0.12},
    overlay: {}, intensity: [.35, .85],
  },
  anger: {
    label: 'anger', family: 'angry',
    face: {ParamMouthForm: -.42, ParamBrowLY: -.55, ParamBrowRY: -.55, BrowInnerUp: -.06, LEyeSquint: .24, REyeSquint: .24, ParamEyeBallY: .04, ParamEyeLOpen: -0.3, ParamEyeROpen: -0.3, Mouthpucker: 0.18, CheeckPuff: 0.14},
    overlay: {'黑脸': .75}, intensity: [.5, 1],
  },
  annoyance: {
    label: 'annoyance', family: 'angry',
    face: {ParamMouthForm: -.16, ParamBrowLY: -.18, ParamBrowRY: -.22, LEyeSquint: .12, ParamEyeBallY: -.08, ParamEyeLOpen: -0.38, ParamEyeROpen: -0.22, MouthX: -0.2, Mouthpucker: 0.3, CheeckPuff: 0.38},
    overlay: {'黑脸': .45}, intensity: [.25, .7],
  },
  approval: {
    label: 'approval', family: 'happy',
    face: {EyeSmile: .20, ParamMouthForm: .22, BrowInnerUp: .06, ParamBrowLY: .04, ParamBrowRY: .04, ParamEyeLOpen: -0.2, ParamEyeROpen: -0.2, LEyeSquint: 0.1, REyeSquint: 0.1},
    overlay: {}, intensity: [.2, .65],
  },
  caring: {
    label: 'caring', family: 'happy',
    face: {EyeSmile: .14, ParamMouthForm: .12, BrowInnerUp: .24, ParamBrowLY: .06, ParamBrowRY: .06, ParamEyeLOpen: -0.2, ParamEyeROpen: -0.2, ParamEyeBallY: -0.04},
    overlay: {}, intensity: [.25, .7],
  },
  confusion: {
    label: 'confusion', family: 'confused',
    face: {ParamBrowLY: .18, ParamBrowRY: -.12, BrowInnerUp: .14, ParamMouthForm: -.06, ParamEyeBallY: -.04, ParamEyeLOpen: -0.22, ParamEyeROpen: 0.12, MouthX: -0.14, ParamEyeBallX: 0.08},
    overlay: {}, intensity: [.25, .7],
  },
  curiosity: {
    label: 'curiosity', family: 'confused',
    face: {ParamBrowLY: .20, ParamBrowRY: .16, BrowInnerUp: .24, EyeSmile: .05, ParamEyeBallY: 0, ParamEyeLOpen: 0.5, ParamEyeROpen: 0.5, ParamEyeBallX: 0},
    overlay: {}, intensity: [.2, .6],
  },
  desire: {
    label: 'desire', family: 'happy',
    face: {EyeSmile: .28, ParamMouthForm: .18, BrowInnerUp: .08, ParamEyeBallY: .04, ParamEyeLOpen: -0.6, ParamEyeROpen: -0.56, LEyeSquint: .15, REyeSquint: .15, Mouthpucker: 0.4, MouthX: 0.1},
    overlay: {}, intensity: [.4, .9],
  },
  disappointment: {
    label: 'disappointment', family: 'sad',
    face: {EyeSmile: -.12, ParamMouthForm: -.38, ParamBrowLY: .20, ParamBrowRY: .20, BrowInnerUp: .44, ParamEyeBallX: -.18, ParamEyeBallY: -.7, ParamEyeLOpen: -0.55, ParamEyeROpen: -0.55, Mouthpucker: 0.14},
    overlay: {'黑脸': .45}, intensity: [.3, .75],
  },
  disapproval: {
    label: 'disapproval', family: 'angry',
    face: {ParamMouthForm: -.10, ParamBrowLY: .14, ParamBrowRY: -.20, BrowInnerUp: -.02, LEyeSquint: .08, ParamEyeBallY: -.04, ParamEyeLOpen: -0.32, ParamEyeROpen: -0.12, MouthX: -0.18, Mouthpucker: 0.16},
    overlay: {'黑脸': .35}, intensity: [.3, .75],
  },
  disgust: {
    label: 'disgust', family: 'angry',
    face: {ParamMouthForm: -.42, ParamBrowLY: -.3, ParamBrowRY: -.38, BrowInnerUp: -.04, LEyeSquint: .24, REyeSquint: .24, ParamEyeBallX: .65, ParamEyeBallY: -.2, ParamEyeLOpen: -0.6, ParamEyeROpen: -0.48, MouthX: -0.3, Mouthpucker: 0.24},
    overlay: {'黑脸': .55}, intensity: [.35, .8],
  },
  embarrassment: {
    label: 'embarrassment', family: 'shy',
    face: {EyeSmile: .2, ParamMouthForm: .14, BrowInnerUp: .2, ParamBrowLY: .08, ParamBrowRY: .08, ParamEyeBallY: -.38, LEyeSquint: .1, REyeSquint: .1, ParamEyeLOpen: -0.45, ParamEyeROpen: -0.45, ParamEyeBallX: -.65, Mouthpucker: 0.18},
    overlay: {'脸红': 1}, intensity: [.3, .8],
  },
  excitement: {
    label: 'excitement', family: 'happy',
    face: {EyeSmile: .48, ParamMouthForm: .40, BrowInnerUp: .12, ParamBrowLY: .08, ParamBrowRY: .08, ParamEyeLOpen: -0.3, ParamEyeROpen: -0.3, LEyeSquint: 0.22, REyeSquint: 0.22},
    overlay: {}, intensity: [.55, 1],
  },
  fear: {
    label: 'fear', family: 'surprised',
    face: {ParamMouthForm: -.14, ParamBrowLY: .12, ParamBrowRY: .12, BrowInnerUp: .38, LEyeSquint: .10, REyeSquint: .10, ParamEyeBallY: -.06, ParamEyeLOpen: 0.25, ParamEyeROpen: 0.25, Mouthpucker: 0.24},
    overlay: {'流冷汗': .65}, intensity: [.5, 1],
  },
  gratitude: {
    label: 'gratitude', family: 'happy',
    face: {EyeSmile: .18, ParamMouthForm: .20, BrowInnerUp: .14, ParamBrowLY: .08, ParamBrowRY: .08, ParamEyeBallY: -.08, ParamEyeLOpen: -0.32, ParamEyeROpen: -0.32, LEyeSquint: 0.12, REyeSquint: 0.12},
    overlay: {}, intensity: [.25, .7],
  },
  grief: {
    label: 'grief', family: 'sad',
    face: {EyeSmile: -.2, ParamMouthForm: -.55, ParamBrowLY: .28, ParamBrowRY: .28, BrowInnerUp: .6, ParamEyeBallX: -.32, ParamEyeBallY: -.7, ParamEyeLOpen: -0.65, ParamEyeROpen: -0.65, Mouthpucker: 0.18},
    overlay: {'流泪': 1}, intensity: [.55, 1],
  },
  joy: {
    label: 'joy', family: 'happy',
    face: {EyeSmile: .44, ParamMouthForm: .38, BrowInnerUp: .10, ParamEyeBallY: .04, ParamEyeLOpen: -0.48, ParamEyeROpen: -0.48, LEyeSquint: 0.2, REyeSquint: 0.2},
    overlay: {}, intensity: [.45, .95],
  },
  love: {
    label: 'love', family: 'happy',
    face: {EyeSmile: .34, ParamMouthForm: .28, BrowInnerUp: .12, ParamEyeBallY: .03, ParamEyeLOpen: -0.52, ParamEyeROpen: -0.52, LEyeSquint: 0.2, REyeSquint: 0.2, Mouthpucker: 0.18},
    overlay: {'脸红': .45}, intensity: [.4, .9],
  },
  nervousness: {
    label: 'nervousness', family: 'surprised',
    face: {ParamMouthForm: -.12, ParamBrowLY: .14, ParamBrowRY: .08, BrowInnerUp: .36, LEyeSquint: .06, REyeSquint: .06, ParamEyeBallX: .32, ParamEyeBallY: -.22, ParamEyeLOpen: 0.08, ParamEyeROpen: -0.12, MouthX: -0.1, Mouthpucker: 0.2},
    overlay: {'流冷汗': .8}, intensity: [.3, .75],
  },
  optimism: {
    label: 'optimism', family: 'happy',
    face: {EyeSmile: .24, ParamMouthForm: .26, BrowInnerUp: .10, ParamBrowLY: .08, ParamBrowRY: .08, ParamEyeBallY: .12, ParamEyeLOpen: -0.12, ParamEyeROpen: -0.12, MouthX: 0.05},
    overlay: {}, intensity: [.3, .75],
  },
  pride: {
    label: 'pride', family: 'happy',
    face: {EyeSmile: .28, ParamMouthForm: .24, BrowInnerUp: .14, ParamBrowLY: .16, ParamBrowRY: .16, ParamEyeBallY: .04, ParamEyeLOpen: -0.34, ParamEyeROpen: -0.2, MouthX: 0.22, ParamEyeBallX: -0.06},
    overlay: {}, intensity: [.4, .85],
  },
  realization: {
    label: 'realization', family: 'surprised',
    face: {EyeSmile: .12, ParamMouthForm: .06, ParamBrowLY: .14, ParamBrowRY: .14, BrowInnerUp: .32, ParamEyeBallY: .06, ParamEyeLOpen: 0.22, ParamEyeROpen: 0.22, Mouthpucker: 0.2},
    overlay: {}, intensity: [.35, .85],
  },
  relief: {
    label: 'relief', family: 'happy',
    face: {EyeSmile: .22, ParamMouthForm: .18, BrowInnerUp: .04, ParamBrowLY: -.02, ParamBrowRY: -.02, ParamEyeLOpen: -0.42, ParamEyeROpen: -0.42, LEyeSquint: 0.08, REyeSquint: 0.08},
    overlay: {}, intensity: [.2, .6],
  },
  remorse: {
    label: 'remorse', family: 'sad',
    face: {ParamMouthForm: -.4, ParamBrowLY: .20, ParamBrowRY: .20, BrowInnerUp: .5, ParamEyeBallX: -.55, ParamEyeBallY: -.6, LEyeSquint: .04, REyeSquint: .04, ParamEyeLOpen: -0.5, ParamEyeROpen: -0.5, Mouthpucker: 0.14},
    overlay: {}, intensity: [.3, .75],
  },
  sadness: {
    label: 'sadness', family: 'sad',
    face: {EyeSmile: -.16, ParamMouthForm: -.44, ParamBrowLY: .24, ParamBrowRY: .24, BrowInnerUp: .52, ParamEyeBallX: -.16, ParamEyeBallY: -.7, ParamEyeLOpen: -0.58, ParamEyeROpen: -0.58, Mouthpucker: 0.16},
    overlay: {'流泪': .95}, intensity: [.4, .9],
  },
  surprise: {
    label: 'surprise', family: 'surprised',
    face: {EyeSmile: .04, ParamMouthForm: .10, ParamBrowLY: .22, ParamBrowRY: .22, BrowInnerUp: .42, ParamEyeBallY: .04, ParamEyeLOpen: 0.32, ParamEyeROpen: 0.32, Mouthpucker: 0.38},
    overlay: {}, intensity: [.5, 1],
  },
  // Relaxed resting baseline: keep the face close to zero; the neutral label
  // never schedules an emotion segment on its own.
  neutral: {
    label: 'neutral', family: 'happy',
    face: {EyeSmile: .02, ParamMouthForm: .03, ParamBrowLY: 0, ParamBrowRY: 0, BrowInnerUp: .01, LEyeSquint: 0, REyeSquint: 0, ParamEyeBallY: 0},
    overlay: {}, intensity: [0, 0],
  },
};

// Fail fast: profile coverage must match the classifier contract exactly.
const FAMILIES: EmotionProfile['family'][] = ['happy', 'angry', 'shy', 'sad', 'surprised', 'confused'];
const FACE_SET = new Set<string>(FACE_CHANNELS);
const OVERLAY_SET = new Set<string>(OVERLAY_NAMES);
const finiteWithin = (value: number, lo: number, hi: number) => typeof value === 'number' && Number.isFinite(value) && value >= lo && value <= hi;

for (const label of EMOTION_LABELS) {
  const profile = EMOTION_PROFILES[label];
  if (!profile) throw new Error(`emotion-profiles: 缺少 ${label} 的 profile`);
  if (profile.label !== label) throw new Error(`emotion-profiles: ${label} label 不一致`);
  if (!FAMILIES.includes(profile.family)) throw new Error(`emotion-profiles: ${label} family 不合法`);
  const faceKeys = Object.keys(profile.face);
  if (!faceKeys.length) throw new Error(`emotion-profiles: ${label} 缺少 face 基线`);
  for (const [channel, value] of Object.entries(profile.face)) {
    if (!FACE_SET.has(channel)) throw new Error(`emotion-profiles: ${label} face 通道不合法 ${channel}`);
    if (!finiteWithin(value, -.7, .7)) throw new Error(`emotion-profiles: ${label}.${channel} 超出 ±0.7`);
  }
  for (const [name, value] of Object.entries(profile.overlay)) {
    if (!OVERLAY_SET.has(name)) throw new Error(`emotion-profiles: ${label} overlay 不合法 ${name}`);
    if (!finiteWithin(value, 0, 1)) throw new Error(`emotion-profiles: ${label}.${name} 超出 0..1`);
  }
  const [lo, hi] = profile.intensity;
  if (!finiteWithin(lo, 0, 1) || !finiteWithin(hi, 0, 1) || lo > hi) throw new Error(`emotion-profiles: ${label} intensity 不合法`);
  if (label === 'neutral' && (lo !== 0 || hi !== 0)) throw new Error('emotion-profiles: neutral intensity 必须为 [0,0]');
}
const extraLabels = Object.keys(EMOTION_PROFILES).filter(label => !EMOTION_LABELS.includes(label));
if (extraLabels.length) throw new Error(`emotion-profiles: 存在契约外的 profile：${extraLabels.join(',')}`);
