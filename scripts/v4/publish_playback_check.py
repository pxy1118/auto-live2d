"""Publish a presentation repair, retaining the rejected experiment and its evidence."""
import json
import hashlib
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
STUDY=ROOT/'research/vtuber-v4-playback-diagnosis-r1'
OUT=ROOT/'test-results/v4-playback-diagnosis-r1'
PUBLIC=ROOT/'datasets/vtuber-v4/review'
MEDIA=PUBLIC/'playback-check-r1'


def read(p):return json.loads(p.read_text(encoding='utf-8'))
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(p,v):p.write_text(json.dumps(v,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf-8')
def run(args):return subprocess.run(args,check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE).stdout


def feedback():
    STUDY.mkdir(parents=True,exist_ok=True)
    target=STUDY/'user-feedback.json'
    if not target.exists():
        write(target,dict(created_utc=datetime.now(timezone.utc).isoformat(),source='user',
            quote='我觉得这个方案不行，动作都很卡顿',study='vtuber-v4-prosody-r1',
            decision='rejected',scope='Overall user rejection; not fabricated per-clip votes.',
            promoted=False,default_changed=False))


def main():
    feedback();capture=read(OUT/'capture.json');assert capture['ok']
    MEDIA.mkdir(parents=True,exist_ok=True)
    old=read(ROOT/'research/vtuber-v4-prosody-study/results.json')
    titles={'welcome-fixed':'挥手 · 原动作库','cajole-fixed':'撒娇 · 原动作库','welcome-rhythm_posture':'挥手 · 已否决的节奏与姿态原型'}
    scenes=[]
    for clip in capture['clips']:
        id=clip['id'];scene_id=next(c['scene'] for c in old['clip_diagnostics'] if c['id']==id)
        source=ROOT/'datasets/vtuber-v4-prosody-r1'/scene_id/'audio.wav'
        video=MEDIA/(id+'-60.mp4')
        if not video.exists():
            run(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','lavfi','-i','color=c=0xedf2ef:s=480x720:r=60',
                 '-framerate','60','-i',str(OUT/id/'%04d.png'),'-i',str(source),
                 '-filter_complex','[0:v][1:v]overlay=shortest=1:format=auto,format=yuv420p[v]',
                 '-map','[v]','-map','2:a:0','-c:v','libx264','-preset','fast','-crf','20','-g','60',
                 '-c:a','aac','-b:a','128k','-frames:v',str(clip['frames']),'-movflags','+faststart',str(video)])
        info=json.loads(run(['ffprobe','-v','error','-show_streams','-of','json',str(video)]))
        v=next(s for s in info['streams'] if s['codec_type']=='video')
        assert v['r_frame_rate']=='60/1' and int(v['nb_frames'])==clip['frames']
        old_clip=next(c for c in old['clip_diagnostics'] if c['id']==id)
        old_video=PUBLIC/old_clip['video']
        assert sha(old_video)==old_clip['video_sha256']
        pcm20=run(['ffmpeg','-v','error','-i',str(old_video),'-map','0:a:0','-f','s16le','-'])
        pcm60=run(['ffmpeg','-v','error','-i',str(video),'-map','0:a:0','-f','s16le','-'])
        assert pcm20==pcm60,'Audio changed between 20/60 fps controls'
        scene=read(ROOT/'datasets/vtuber-v4-prosody-r1'/scene_id/'scene.json')
        scenes.append(dict(id=id,title=titles[id],texts=[c['text'] for c in scene['cues']],
            videos={'20':old_clip['video'],'60':'playback-check-r1/'+video.name},
            video_sha256={'20':sha(old_video),'60':sha(video)},same_audio_pcm=True,same_60hz_parameter_readback=True,
            maximum_parameter_difference=clip['maximum_parameter_difference']))
        print(json.dumps(dict(id=id,frames=clip['frames'],real_fps=60,same_audio=True)),flush=True)
    write(PUBLIC/'playback-check-scenes.json',scenes)
    shutil.copyfile(STUDY/'review.html',PUBLIC/'playback-check.html')
    # Retain the original entry URL, but give it the repaired one-decoder viewer.
    # Its exact earlier contents are preserved as prosody-playback-before.html.
    shutil.copyfile(STUDY/'review.html',PUBLIC/'prosody-study.html')
    report=dict(schema='playback-diagnosis.v1',original_study='vtuber-v4-prosody-r1',original_user_decision='rejected',
        default_changed=False,motion_model_promoted=False,naturalness_accepted=False,semantic_model_trained=False,
        clips=scenes,before=read(OUT/'playback-before.json'),
        changes=['Single video decoder with its own muxed speech clock; no automatic currentTime corrections.',
                 'Genuine 60 fps re-render of the exact archived 60 Hz inputs, with identical parameter readback and speech.',
                 'The rejected motion/retiming policy is retained and not selected as a new default.'],
        scope='Repair presentation and isolate sampling cadence. This does not establish movement naturalness.',
        user_feedback_sha256=sha(STUDY/'user-feedback.json'))
    write(STUDY/'results.json',report);write(PUBLIC/'playback-check-report.json',report)


if __name__=='__main__':main()
