"""Encode actual frame captures; publish three paired clips without voting."""
import gzip
import hashlib
import json
import shutil
import subprocess
import wave
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
STUDY = ROOT / 'research/vtuber-v4-liveliness-r1'
OUT = ROOT / 'test-results/v4-liveliness-r1'
PUBLIC = ROOT / 'datasets/vtuber-v4/review'
MEDIA = PUBLIC / 'liveliness-r1'


def read(p): return json.loads(p.read_text('utf-8'))
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def write(p, x): p.write_text(json.dumps(x, ensure_ascii=False, indent=2, allow_nan=False) + '\n', 'utf-8')
def run(args): return subprocess.run(args, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout


def main():
    capture = read(OUT / 'capture.json')
    assert capture['ok'] and len(capture['clips']) == 6 and capture['batching_matches_frozen_capture']
    MEDIA.mkdir(parents=True, exist_ok=True)
    descriptions = {
        'quiet': '从非默认姿态安静等待，候选在约 16 秒时短暂侧看，随后回到原姿态。手臂保持。',
        'shy': '两句间保留情绪：短暂移开视线，眉部先放松，脸红稍后退出。语音、手臂和躯干轨迹相同。',
        'anger': '同样的生气强度与保持指令。观察眉眼的短反应与黑脸的长保持；这是无声执行探针。'}
    scenes = []
    for scene in read(STUDY / 'protocol.json')['scenes']:
        audio = ROOT / scene['cached_scene'] / 'audio.wav' if scene.get('cached_scene') else OUT / (scene['id'] + '-silence.wav')
        if not scene.get('cached_scene'):
            with wave.open(str(audio), 'wb') as wav:
                wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(24000)
                wav.writeframes(b'\0\0' * round(scene['duration_ms'] * 24))
        variants, audio_hashes = [], []
        for mode, label in [('current', '当前执行 · 固定信号'), ('state_idle', '持续状态与稀疏调度候选')]:
            id = scene['id'] + '-' + mode
            clip = next(c for c in capture['clips'] if c['id'] == id)
            folder = OUT / id; video = MEDIA / (id + '.mp4'); poster = MEDIA / (id + '.webp'); timeline = MEDIA / (id + '-trace.json')
            run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0xedf2ef:s=480x720:r=60',
                 '-framerate', '60', '-i', str(folder / '%04d.png'), '-i', str(audio),
                 '-filter_complex', '[0:v][1:v]overlay=shortest=1:format=auto,format=yuv420p[v]', '-map', '[v]', '-map', '2:a:0',
                 '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-g', '60', '-c:a', 'aac', '-b:a', '128k',
                 '-frames:v', str(clip['frames']), '-movflags', '+faststart', str(video)])
            info = json.loads(run(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(video)]))
            v = next(s for s in info['streams'] if s['codec_type'] == 'video')
            assert v['r_frame_rate'] == '60/1' and int(v['nb_frames']) == clip['frames']
            assert abs(float(info['format']['duration']) * 1000 - scene['duration_ms']) < 80
            audio_hashes.append(hashlib.sha256(run(['ffmpeg', '-v', 'error', '-i', str(video), '-map', '0:a:0', '-f', 's16le', '-'])).hexdigest())
            highlight = 16800 if scene['id'] == 'quiet' else 1500
            with Image.open(folder / f'{round(highlight / 1000 * 60):04d}.png') as raw:
                bg = Image.new('RGBA', raw.size, '#edf2ef'); bg.alpha_composite(raw.convert('RGBA')); bg.convert('RGB').save(poster)
            actual = json.loads(gzip.decompress((folder / 'actual.json.gz').read_bytes()))
            cols = [actual['parameter_ids'].index(k) for k in ['key1' if scene['id'] == 'anger' else 'key7', 'ParamBrowLY', 'ParamEyeBallX']]
            trace = [[f / 60 * 1000, *[abs(actual['actual'][f][j]) for j in cols]] for f in range(0, clip['frames'], 6)]
            write(timeline, trace)
            variants.append({'id': mode, 'label': label, 'video': 'liveliness-r1/' + video.name,
                             'poster': 'liveliness-r1/' + poster.name, 'trace': 'liveliness-r1/' + timeline.name,
                             'video_sha256': sha(video), 'frames': clip['frames'], 'fps': 60})
            print(json.dumps({'encoded': id, 'frames': clip['frames'], 'fps': 60}), flush=True)
        assert len(set(audio_hashes)) == 1
        texts = read(ROOT / scene['cached_scene'] / 'scene.json')['texts'] if scene.get('cached_scene') else []
        scenes.append({'id': scene['id'], 'title': '安静等待 · 一次低频侧看' if scene['id'] == 'quiet' else scene['title'],
                       'description': descriptions[scene['id']], 'texts': texts, 'duration_ms': scene['duration_ms'],
                       'highlight_ms': 16233 if scene['id'] == 'quiet' else 800,
                       'paired_audio_identical': True, 'arm_inputs_identical': True, 'variants': variants})
    write(PUBLIC / 'liveliness-study-scenes.json', scenes)
    shutil.copyfile(STUDY / 'review.html', PUBLIC / 'liveliness-study.html')
    write(STUDY / 'media.json', {'scenes': scenes, 'clips': 6, 'true_capture_fps': 60, 'paired_audio_identical': True})


if __name__ == '__main__': main()
