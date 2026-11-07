"""Native-28 affect, playback-time action planning, and a frozen background head."""
import hashlib
import json
import time
from collections import OrderedDict
from functools import lru_cache
from uuid import uuid4

import numpy as np
import torch

from catalog_contract import ACTION_BY_ID, MODEL_ACTION_IDS, catalog_sha256
from common import ROOT
from emotion import EmotionClassifier, build_timeline, emotion_inputs, emotion_spans
from emotion_config import LABELS, emotion_config_sha256, validate_affect_vector
from emotion_event import decode, load_event
from emotion_expert import BACKGROUND_CHANNELS, load_continuous
from motion_history import STATE_DIM, state_vector

DEFAULT_EXPERIMENT = ROOT / 'experiments/vtuber-v6-native28-motion-r2'
RUNTIME_VERSION = 'v6.3.2-feedback-acting'
SCHEMA = 'vtuber.v6.native28_motion'


class EmotionCatalogPolicy:
    def __init__(self, encoder, experiment=None, emotion_device=None):
        self.encoder = encoder
        self.explicit_experiment = experiment
        self.device = encoder.device
        self.emotion_device = str(encoder.device if emotion_device is None else emotion_device)
        self.profile = json.loads((ROOT / 'latent/runtime-profile.json').read_text(encoding='utf-8'))
        self.channel_ids = [c['id'] for c in self.profile['channels']]
        self.background_indices = [self.channel_ids.index(c) for c in BACKGROUND_CHANNELS]
        self.lo = np.array([c['min'] for c in self.profile['channels']], np.float32)
        self.hi = np.array([c['max'] for c in self.profile['channels']], np.float32)
        self.neutral = np.array([c.get('default', 0.) for c in self.profile['channels']], np.float32)
        self.loaded = None
        self.features = OrderedDict()
        self.plan_calls = self.motion_updates = 0

    def folder(self):
        if self.explicit_experiment:
            folder = (ROOT / self.explicit_experiment).resolve()
        else:
            pointer = ROOT / 'latent/stream-run.json'
            folder = (ROOT / json.loads(pointer.read_text(encoding='utf-8'))['path']).resolve() if pointer.exists() else DEFAULT_EXPERIMENT
        if not folder.is_relative_to(ROOT / 'experiments'):
            raise ValueError('检查点必须位于 experiments 内')
        return folder

    def load(self):
        folder = self.folder()
        path = folder / 'run.json'
        fingerprint = (str(folder), path.stat().st_mtime_ns)
        if self.loaded == fingerprint:
            return
        run = json.loads(path.read_text(encoding='utf-8'))
        if run.get('schema') != SCHEMA:
            raise ValueError('需要 native28-motion 检查点')
        sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
        if run['catalog_sha256'] != catalog_sha256() or run['history_sha256'] != sha(ROOT / 'contracts/motion-history.json'):
            raise ValueError('事件分支动作或历史契约不匹配')
        if run['emotion_config_sha256'] != emotion_config_sha256() or run['profile_sha256'] != self.profile['sha256']:
            raise ValueError('情绪或连续通道契约不匹配')
        if run['models']['event']['action_ids'] != list(MODEL_ACTION_IDS):
            raise ValueError('模型动作列表不匹配')
        for name, config in run['models'].items():
            if sha(folder / config['checkpoint']) != config['sha256']:
                raise ValueError(name + ' 检查点指纹不匹配')
        # The reused background checkpoint is independent of the action catalog.
        continuous, _ = load_continuous(folder / run['models']['continuous']['checkpoint'], self.device)
        event, _ = load_event(folder / run['models']['event']['checkpoint'], self.device)
        self.models = {'event': event, 'continuous': continuous}
        self.emotion_classifier = EmotionClassifier(ROOT / 'latent/emotion-source.json', self.emotion_device)
        self.run, self.folder_path, self.loaded = run, folder, fingerprint
        self.features.clear()
        self.semantic.cache_clear()

    @lru_cache(maxsize=96)
    def semantic(self, text, context):
        original = len(context)
        while True:
            try:
                feature, mask, info = self.encoder.encode(text, context, 'natural')
                return feature, mask, {**info, 'context_truncated': len(context) != original}
            except ValueError as error:
                if '512 token' not in str(error) or not context:
                    raise
                context = context[min(64, len(context)):]

    @torch.inference_mode()
    def prefill(self, data):
        begin = time.perf_counter()
        self.load()
        text, context = data.get('text'), data.get('context', '')
        prior, session = data.get('emotion_context', ''), data.get('session_id', '')
        if not isinstance(text, str) or not 0 < len(text) <= 400 or not text.strip():
            raise ValueError('台词需要 1～400 字')
        if not isinstance(context, str) or len(context) > 1200 or not isinstance(prior, str) or len(prior) > 400 or not isinstance(session, str):
            raise ValueError('语境或会话不合法')
        clauses = data.get('clauses') or [{'clause': 0, 'text': text, 'start': 0, 'end': len(text)}]
        previous, ids, rows = -1, set(), []
        encoder_ms = 0.
        for i, span in enumerate(clauses):
            start, end, clause = span.get('start'), span.get('end'), span.get('clause')
            if any(isinstance(v, bool) or not isinstance(v, int) for v in (start, end, clause)):
                raise ValueError('语义分段类型不合法')
            if not 0 <= start < end <= len(text) or start <= previous or clause < 0 or clause in ids or end - start > 240 or text[start:end].strip() != span.get('text'):
                raise ValueError('语义分段与原文不匹配或超过 240 字')
            previous = start
            ids.add(clause)
            scoped = '\n'.join([context, *[c['text'] for c in clauses[max(0, i - 2):i]]]).strip()[-1200:]
            feature, mask, info = self.semantic(span['text'], scoped)
            weights = (~mask).float()
            pooled = (feature * weights[:, None]).sum(0) / weights.sum().clamp_min(1)
            key = uuid4().hex
            self.features[key] = {'session_id': session, 'feature': feature, 'mask': mask, 'pooled': pooled, 'clause': clause, 'info': info}
            while len(self.features) > 256:
                self.features.popitem(last=False)
            encoder_ms += info.get('encoder_ms', 0.)
            rows.append({**span, 'start_fraction': start / len(text), 'feature_id': key})
        spans = emotion_spans(text)
        windows = emotion_inputs(text, spans, prior)
        classified = self.emotion_classifier.classify_many(windows)
        timeline = build_timeline(text, spans, windows, classified, self.emotion_classifier.thresholds)
        elapsed = (time.perf_counter() - begin) * 1000
        return {'ready': True, 'semantic_ms': elapsed, 'clauses': rows, 'affect_timeline': timeline,
                'planner_timing': {'emotion': dict(self.emotion_classifier.last_timing), 'action_encoder': {'encoder_ms': encoder_ms}, 'total_ms': elapsed}}

    def feature(self, data):
        self.load()
        key = data.get('feature_id')
        saved = self.features.get(key) if isinstance(key, str) else None
        if saved is None or saved['session_id'] != data.get('session_id', '') or saved['clause'] != data.get('clause'):
            raise ValueError('语义特征已过期或不属于当前会话/分句')
        self.features.move_to_end(key)
        return saved

    @torch.inference_mode()
    def plan(self, data):
        begin = time.perf_counter()
        saved = self.feature(data)
        affect = validate_affect_vector(data.get('affect'))
        history = state_vector(data.get('planner_state'))
        tensor = lambda value: torch.as_tensor(value, dtype=torch.float32, device=self.device)
        output = self.models['event'](saved['pooled'][None], tensor([affect]), tensor([history]))
        decoded = decode({k: v[0] for k, v in output.items()}, list(MODEL_ACTION_IDS), ACTION_BY_ID, self.run['models']['event']['threshold'])
        self.plan_calls += 1
        return {'plan': {'schema': 'performance.plan.v3', 'clause': data['clause'], **decoded},
                'timing': {'total_compute_ms': (time.perf_counter() - begin) * 1000},
                'input': {'history_dim': STATE_DIM, 'affect_dim': len(affect), 'feature_id': data['feature_id']}}

    @torch.inference_mode()
    def predict(self, data):
        begin = time.perf_counter()
        saved = self.feature(data)
        def array(key, shape, default):
            value = np.asarray(data.get(key, default), np.float32)
            if value.shape != shape or not np.isfinite(value).all():
                raise ValueError(key + ' 形状或数值不合法')
            return value
        state = array('state', (len(self.channel_ids),), self.neutral)
        history = np.asarray(data.get('history', []), np.float32)
        if history.size == 0:
            history = np.tile(state, (20, 1))
        if history.ndim != 2 or history.shape[1] != len(self.channel_ids) or not 1 <= len(history) <= 20 or not np.isfinite(history).all():
            raise ValueError('history 不合法')
        history = np.r_[np.tile(history[0], (20 - len(history), 1)), history]
        audio = array('audio', (24, 12), np.zeros((24, 12)))
        mask = array('audio_mask', (24,), np.zeros(24))
        phase = array('motion_phase', (4,), np.array([0., 3., 0., 0.]))
        affect = validate_affect_vector(data.get('affect'))
        normalize = lambda value: np.clip(2 * (value - self.lo) / (self.hi - self.lo) - 1, -1, 1)
        tensor = lambda value: torch.as_tensor(value, dtype=torch.float32, device=self.device)
        prediction = self.models['continuous'](saved['feature'][None], saved['mask'][None], tensor([affect]), tensor(normalize(state))[None], tensor(normalize(history))[None], tensor(audio)[None], tensor(mask)[None], tensor(phase)[None])
        raw = prediction[0].cpu().numpy()
        if not np.isfinite(raw).all():
            raise ValueError('连续分支出现非有限预测')
        ix = self.background_indices
        values = (np.clip(raw, -1, 1) + 1) / 2 * (self.hi[ix] - self.lo[ix]) + self.lo[ix]
        self.motion_updates += 1
        return {'channels': list(BACKGROUND_CHANNELS), 'values': np.round(values, 6).tolist(),
                'timing': {'total_compute_ms': (time.perf_counter() - begin) * 1000, 'context_truncated': saved['info'].get('context_truncated', False)},
                'raw_out_of_range_fraction': float((np.abs(raw) > 1).mean())}

    def info(self):
        try:
            self.load()
        except Exception as error:
            return {'ready': False, 'runtime_version': RUNTIME_VERSION, 'reason': str(error)}
        return {'ready': True, 'driver': 'native28_motion', 'runtime_version': RUNTIME_VERSION,
                'promoted': bool(self.run.get('promoted')), 'experimental': not bool(self.run.get('promoted')),
                'profile_sha256': self.profile['sha256'], 'models': ['multilingual-emotions-base', 'qwen3.5-0.8b'],
                'emotion_classifier': self.emotion_classifier.info(),
                'execution': {'emotion_device': self.emotion_device, 'event_device': str(self.device), 'continuous_device': str(self.device), 'action_encoder': 'Qwen3.5-0.8B'},
                'motion': {'clock': 'audio', 'update_ms': 400, 'horizon': 24},
                'action_catalog': {'actions': list(MODEL_ACTION_IDS), 'history_dim': STATE_DIM},
                'run': {'path': str(self.folder_path.relative_to(ROOT)), 'schema': SCHEMA, 'gate_passed': self.run.get('gate', {}).get('passed'), 'models': self.run['models']},
                'runtime_counts': {'plan_calls': self.plan_calls, 'motion_updates': self.motion_updates, 'feature_cache': len(self.features)}}
