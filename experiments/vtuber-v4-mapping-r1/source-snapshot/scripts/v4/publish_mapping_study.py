"""Encode real 60-fps mapping ablations and publish a single-decoder comparison."""
import gzip
import hashlib
import json
import shutil
import subprocess
from pathlib import Path
from PIL import Image

ROOT=Path(__file__).resolve().parents[2]
STUDY=ROOT/'research/vtuber-v4-mapping-r1'
DATA=ROOT/'datasets/vtuber-v4-mapping-r1'
OUT=ROOT/'test-results/v4-mapping-r1'
PUBLIC=ROOT/'datasets/vtuber-v4/review'
MEDIA=PUBLIC/'mapping-r1'


def read(p):return json.loads(p.read_text(encoding='utf-8'))
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(p,v):p.write_text(json.dumps(v,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf-8')
def run(args):return subprocess.run(args,check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE).stdout


def main():
    capture=read(OUT/'capture.json');assert capture['ok'] and len(capture['clips'])==12
    protocol=read(STUDY/'protocol.json');MEDIA.mkdir(parents=True,exist_ok=True)
    labels={'current':'当前动作库执行','mapped':'资产映射','mapped_micro':'映射＋细微反应'}
    scenes=[];micro_evidence=[]
    for item in protocol['scenes']:
        scene=read(DATA/item['id']/'scene.json');audio=DATA/scene['id']/'audio.wav';variants=[];decoded=[]
        for mode,label in labels.items():
            id=scene['id']+'-'+mode;clip=next(c for c in capture['clips'] if c['id']==id);folder=OUT/id
            video=MEDIA/(id+'.mp4');poster=MEDIA/(id+'.webp')
            if not video.exists():
                run(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','lavfi','-i','color=c=0xedf2ef:s=480x720:r=60',
                    '-framerate','60','-i',str(folder/'%04d.png'),'-i',str(audio),
                    '-filter_complex','[0:v][1:v]overlay=shortest=1:format=auto,format=yuv420p[v]',
                    '-map','[v]','-map','2:a:0','-c:v','libx264','-preset','fast','-crf','20','-g','60',
                    '-c:a','aac','-b:a','128k','-frames:v',str(clip['frames']),'-movflags','+faststart',str(video)])
            info=json.loads(run(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(video)]))
            v=next(s for s in info['streams'] if s['codec_type']=='video');assert v['r_frame_rate']=='60/1' and int(v['nb_frames'])==clip['frames']
            assert abs(float(info['format']['duration'])*1000-scene['duration_ms'])<80
            decoded.append(hashlib.sha256(run(['ffmpeg','-v','error','-i',str(video),'-map','0:a:0','-f','s16le','-'])).hexdigest())
            at=90 if scene['id']=='shy' else 126
            with Image.open(folder/f'{at:04d}.png') as raw:
                image=Image.new('RGBA',raw.size,'#edf2ef');image.alpha_composite(raw.convert('RGBA'));image.convert('RGB').save(poster)
            variants.append(dict(id=mode,label=label,video='mapping-r1/'+video.name,poster='mapping-r1/'+poster.name,
                video_sha256=sha(video),poster_sha256=sha(poster),frames=clip['frames'],fps=60))
            recorded=json.loads(gzip.decompress((folder/'actual.json.gz').read_bytes()))
            onset=scene['cues'][0]['at_ms']
            def measured(key,start,stop,kind):
                j=recorded['parameter_ids'].index(key)
                a=int((onset+start)/1000*60);b=int((onset+stop)/1000*60)+1
                samples=[r[j] for r in recorded['actual'][a:b]]
                return dict(scene=scene['id'],condition=mode,feature=kind,parameter=key,
                            start_ms=onset+start,end_ms=onset+stop,minimum=min(samples),maximum=max(samples))
            if scene['id']=='welcome':micro_evidence.append(measured('ParamBrowLY',300,910,'early_brow_raise'))
            if scene['id']=='shy':micro_evidence.append(measured('ParamEyeBallX',450,1900,'finite_side_glance'))
            if scene['id']=='cajole':micro_evidence.append(measured('ParamEyeLOpen',650,1130,'slow_blink_window'))
            print(json.dumps(dict(encoded=id,fps=60,frames=clip['frames'])),flush=True)
        assert len(set(decoded))==1,'Speech audio differs across the ablation'
        scenes.append(dict(id=scene['id'],title=scene['title'],texts=scene['texts'],framing=scene['framing'],
            duration_ms=scene['duration_ms'],same_audio_pcm=True,arm_inputs_identical=True,variants=variants))
    write(PUBLIC/'mapping-study-scenes.json',scenes)
    shutil.copyfile(STUDY/'review.html',PUBLIC/'mapping-study.html')
    report=dict(schema='asset-mapping-results.v1',promoted=False,trained=False,semantic_model_used=False,
        human_quality_accepted=False,old_final_test_loaded=False,scenes=4,clips=12,actual_frames=capture['actual_frames'],
        protocol_sha256=sha(STUDY/'protocol.json'),active_mappings=8,total_asset_mapping_entries=40,
        conditions=list(labels),clip_diagnostics=capture['clips'],response_probes=capture['probes'],
        neutral_readbacks_identical=capture['neutral_readbacks_identical'],source_asset_hash=capture['asset_hash'],
        all_arm_finger_inputs_identical=True,default_changed=False,paired_audio_pcm_identical=True,
        micro_reaction_readbacks=micro_evidence,
        status='实际渲染与机制检查完成；自然度未验收',limitations=protocol['limitations'])
    write(STUDY/'results.json',report);write(PUBLIC/'mapping-study-report.json',report)


if __name__=='__main__':main()
