"""Freeze a mechanism study and synthesize matched, genuine local-TTS audio.

No old evaluation examples, human ratings, or final-test labels are used.
"""
import argparse
import hashlib
import json
import time
import urllib.request
import wave
from datetime import datetime, timezone
from pathlib import Path
import sys

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from speech.features import SpeechFeatures

STUDY = ROOT / 'research/vtuber-v4-prosody-study'
DATA = ROOT / 'datasets/vtuber-v4-prosody-r1'


def read(p):
    return json.loads(p.read_text(encoding='utf-8-sig'))


def write(p, value):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n', encoding='utf-8')


def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def request(url, data=None):
    req = urllib.request.Request(url, None if data is None else json.dumps(data, ensure_ascii=False).encode(),
                                 headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=180) as response:
        return json.load(response)


CASES = [
    dict(id='welcome', title='招呼与接话', gap_ms=400, turns=[
        dict(text='晚上好呀，你终于来啦，快过来坐。', arm='wave', body='tilt', variant=0, strength=.45),
        dict(text='今天想先聊点什么呢？我在认真听哦。', arm='none', body='lean', variant=0, strength=.4)]),
    dict(id='explain', title='强调与继续说明', gap_ms=450, turns=[
        dict(text='先看这里，真正需要注意的是中间这一步。', arm='point', body='nod', variant=0, strength=.45),
        dict(text='对，就是这个位置，其他地方先不用着急。', arm='point', body='nod', variant=1, strength=.4)]),
    dict(id='thanks', title='感谢与情绪延续', gap_ms=450, turns=[
        dict(text='真的谢谢你，还记得帮我把这些都准备好。', arm='chest', body='lean', variant=0, strength=.45),
        dict(text='有你陪着，我就安心多啦。', arm='thanks', body='tilt', variant=0, strength=.4)]),
    dict(id='cajole', title='撒娇与长停顿', gap_ms=1100, turns=[
        dict(text='再陪我待一小会儿，好不好嘛？', arm='none', body='cajole', variant=0, strength=.5),
        dict(text='就一小会儿，等这首歌放完，我们再走。', arm='none', body='lean', variant=0, strength=.35)]),
    dict(id='shy', title='轻害羞与回应', gap_ms=500, face=dict(blush=.38), turns=[
        dict(text='你这样认真地夸我，我会有一点不好意思的。', arm='chest', body='tilt', variant=1, strength=.38),
        dict(text='不过，我很开心，你能看出来就太好了。', arm='none', body='nod', variant=0, strength=.32)]),
    dict(id='firm', title='认真拒绝与情绪保持', gap_ms=700, face=dict(blackface=.5), turns=[
        dict(text='这件事我已经认真说过了，请不要再这样做。', arm='refuse', body='nod', variant=0, strength=.42),
        dict(text='我们可以慢慢讨论，但是这个约定要遵守。', arm='none', body='none', variant=0, strength=0)]),
    dict(id='neutral', title='中性说明与安静保持', gap_ms=900, turns=[
        dict(text='文件已经整理好了，稍后我会继续核对。', arm='none', body='none', variant=0, strength=0),
        dict(text='目前没有新的变化，我们按照原来的安排进行。', arm='none', body='none', variant=0, strength=0)]),
    dict(id='quoted', title='引用动作词但保持中性', gap_ms=650, turns=[
        dict(text='记录里写着，他挥手说，快看这边。', arm='none', body='none', variant=0, strength=0),
        dict(text='我这里只是在转述那句话，现在不用做动作。', arm='none', body='none', variant=0, strength=0)]),
]


def freeze():
    STUDY.mkdir(parents=True, exist_ok=True)
    frozen = STUDY / 'runtime-before.json'
    paths = ['latent/stream-run.json', 'latent/default-run.json', '.runtime/performance/ratings.json',
             'src/gesture-library.ts', 'src/gesture-choreography.ts', 'src/body-motion.ts', 'src/performance.ts',
             'src/engine.ts', 'speech/features.py', 'main.py', 'server/performance-service.ts',
             'experiments/vtuber-v4-default-r1/run.json', 'experiments/vtuber-v4-default-r1/selection.json',
             'experiments/vtuber-v4-default-r1/performance-planner.pt', 'experiments/vtuber-v4-default-r1/body-planner.pt']
    files = {p: sha(ROOT / p) for p in paths}
    if frozen.exists():
        assert read(frozen)['files'] == files, 'Frozen runtime changed; use a new study revision'
    else:
        write(frozen, dict(created_utc=datetime.now(timezone.utc).isoformat(), files=files))
    protocol = dict(schema='prosody-mechanism-study.v1', promoted=False, trained=False, semantic_model_used=False,
        stage='engineering-development', final_test_loaded=False, human_gold=False, naturalness_accepted=False,
        controls='Same authored intent, variants, genuine PCM, mouth and face per scene across all three conditions. No semantic selection claim.',
        conditions=['fixed', 'rhythm', 'rhythm_posture'],
        hypotheses=[
            'Causal audio accents can change timing without changing the native shoulder/elbow pose path.',
            'A bounded persistent torso target can bridge short speech gaps without accumulating drift.',
            'These mechanisms may improve perceived liveliness; automated beat/velocity diagnostics cannot establish that.'
        ],
        causal_contract='Only current/past 60 Hz audio features and begin/end events already reached by the playback clock enter the controller. No word alignment or future accent access.',
        limitations=['Audio was fully synthesized before offline rendering, so this is not a live latency benchmark.',
                     'Authored semantic intents are controlled experimental inputs, not training labels or model predictions.',
                     'RMS-onset accents are acoustic proxies, not verified word-level semantic emphasis.',
                     'Posture continuation is restricted to small torso/head offsets; native arm handoffs remain unchanged.',
                     'No human motion ground truth; movement magnitude and lower jerk alone do not prove naturalness.'],
        sampling=dict(parameter_hz=60, physics_hz=60, video_hz=20),
        constraints=dict(arm_time_rate=[.85, 1.12], one_primary_arm=True, wardrobe_outputs=False,
                         special_eye_drawings_unchanged=True, native_arm_path_unchanged=True, no_periodic_idle_noise=True),
        human_evaluation=dict(blinded_versions=True, outcomes=['naturalness','timing','emotional_readability','repetition'],
                              includes_tie_and_neither=True, automatic_winner=False),
        literature=[
            dict(url='https://arxiv.org/html/2604.10927v1', title='LiveGesture', use='Past-only audio/history and cross-region coordination, section 3.2. No imported weights.'),
            dict(url='https://arxiv.org/html/2401.00374v5', title='EMAGE', use='Separate speech content and acoustic rhythm, section 4.2. No imported weights.'),
            dict(url='https://arxiv.org/html/2401.04747v2', title='DiffSHEG', use='Evaluate agility together with smoothness and human preference, appendix D. No imported weights.')])
    for name, value in [('protocol.json', protocol), ('cases.json', CASES)]:
        p = STUDY / name
        if p.exists():
            assert read(p) == value, f'{name} changed: start another revision instead'
        else:
            write(p, value)


def synthesize():
    health = request('http://127.0.0.1:8769/health')
    assert health['ready'] and health['speaker'] == 'da_fei_yu'
    write(STUDY / 'tts-runtime.json', health)
    manifest = request('http://127.0.0.1:8775/api/manifest')
    write(STUDY / 'asset-manifest.json', manifest)
    DATA.mkdir(parents=True, exist_ok=True)
    index = []
    for scene in CASES:
        folder = DATA / scene['id']; folder.mkdir(exist_ok=True)
        parts, cues, rate, at = [], [], None, 500
        for i, turn in enumerate(scene['turns']):
            meta_path, wav_path = folder / f'turn-{i}.json', folder / f'turn-{i}.wav'
            seed = 5301 + i
            if meta_path.exists() and wav_path.exists():
                meta = read(meta_path)
                assert meta['text'] == turn['text'] and meta['seed'] == seed and sha(wav_path) == meta['copied_sha256']
            else:
                started = time.perf_counter()
                meta = request('http://127.0.0.1:8769/synthesize', dict(text=turn['text'], language='Chinese', seed=seed))
                key = meta['speech_id']
                source = ROOT / '.runtime/speech/audio' / (key + '.wav')
                wav_path.write_bytes(source.read_bytes())
                meta.update(seed=seed, copied_sha256=sha(wav_path), request_wall_ms=(time.perf_counter()-started)*1000)
                write(meta_path, meta)
            with wave.open(str(wav_path), 'rb') as wav:
                assert wav.getnchannels() == 1 and wav.getsampwidth() == 2
                sr = wav.getframerate(); pcm = np.frombuffer(wav.readframes(wav.getnframes()), '<i2').copy()
            assert rate is None or sr == rate
            rate = sr
            if i == 0:
                parts.append(np.zeros(round(rate*.5), dtype='<i2'))
            duration = len(pcm)/rate*1000
            cues.append(dict(**turn, at_ms=at, end_ms=at+duration, index=i))
            parts.append(pcm); at += duration
            gap = scene['gap_ms'] if i < len(scene['turns'])-1 else 4000
            parts.append(np.zeros(round(rate*gap/1000), dtype='<i2')); at += gap
            print(json.dumps(dict(scene=scene['id'], turn=i, audio_ms=round(duration), real_tts=True)), flush=True)
        pcm = np.concatenate(parts)
        track = folder / 'audio.wav'
        with wave.open(str(track), 'wb') as wav:
            wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(rate); wav.writeframes(pcm.tobytes())
        # SpeechFeatures is a left-to-right causal pass; no centered filters or future peak search.
        features = SpeechFeatures().push(pcm.astype(np.float32)/32768, rate)
        result = dict(**scene, cues=cues, sample_rate=rate, samples=len(pcm), duration_ms=len(pcm)/rate*1000,
                      audio='audio.wav', audio_sha256=sha(track), features=features,
                      protocol_sha256=sha(STUDY/'protocol.json'), semantic_intents='assistant-authored experimental controls')
        write(folder/'scene.json', result)
        index.append(dict(id=scene['id'], path=f'{scene["id"]}/scene.json', audio_sha256=result['audio_sha256'],
                          duration_ms=result['duration_ms']))
    write(DATA/'manifest.json', dict(schema='prosody-inputs.v1', scenes=index, real_tts=True, final_test_loaded=False,
        protocol_sha256=sha(STUDY/'protocol.json'), tts_checkpoint_sha256=health['checkpoint_sha256']))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--audio', action='store_true'); args = parser.parse_args()
    freeze()
    if args.audio:
        synthesize()
    print(json.dumps(dict(frozen=True, cases=len(CASES), audio=args.audio)), flush=True)
