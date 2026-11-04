"""Encode verified Cubism captures and publish blinded, matched-audio comparisons."""
import gzip
import hashlib
import json
import random
from itertools import permutations
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
STUDY = ROOT/'research/vtuber-v4-prosody-study'
DATA = ROOT/'datasets/vtuber-v4-prosody-r1'
CAPTURE = ROOT/'test-results/v4-prosody-study'
PUBLIC = ROOT/'datasets/vtuber-v4/review'
MEDIA = PUBLIC/'prosody-r1'


def read(p):
    return json.loads(p.read_text(encoding='utf-8'))


def write(p, value):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False)+'\n', encoding='utf-8')


def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def unpack(p):
    return json.loads(gzip.decompress(p.read_bytes()))


def run(args):
    return subprocess.run(args, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout


def metrics(clip, scene):
    generated = unpack(CAPTURE/clip['id']/'input.json.gz')
    recorded = unpack(CAPTURE/clip['id']/'actual.json.gz')
    ids = recorded['parameter_ids']; x = np.asarray(recorded['actual'], dtype=float)
    # Readbacks of real body inputs, normalized by the actual asset's ranges later.
    body = ['AngleX','AngleY','AngleZ','PositionX','PositionY','PositionZ','LeanInput']
    trace = generated['trace']
    gaps = []
    for i, cue in enumerate(scene['cues'][:-1]):
        start, stop = cue['end_ms'], scene['cues'][i+1]['at_ms']
        a, b = max(0, int(start/1000*60)), min(len(x), int(stop/1000*60))
        position = [ids.index(k) for k in body]
        # Degree/position units differ: this number is explicitly a diagnostic, not a quality score.
        gaps.append(dict(start_ms=start, end_ms=stop,
            body_input_rms=float(np.sqrt(np.mean(x[a:b,position]**2))) if b>a else None,
            retained_posture_rms=float(np.sqrt(np.mean([[f['posture'][k]**2 for k in body] for f in trace[a:b]]))) if b>a else None))
    return dict(gaps=gaps,arm_starts=sum(e['kind']=='arm' for e in generated['events']),
                body_starts=sum(e['kind']=='body' for e in generated['events']),
                motion_rate_min=min(t['rate'] for t in trace),motion_rate_max=max(t['rate'] for t in trace))


def main():
    captured = read(CAPTURE/'capture.json'); assert captured['ok'] and len(captured['clips']) == 24
    before = read(STUDY/'runtime-before.json')
    for p, h in before['files'].items():
        assert sha(ROOT/p) == h, p
    MEDIA.mkdir(parents=True, exist_ok=True)
    rng = random.Random(113703)
    orders=list(permutations(['fixed','rhythm','rhythm_posture']));rng.shuffle(orders)
    orders.extend([orders[0],(orders[0][1],orders[0][2],orders[0][0])])
    scene_index = read(DATA/'manifest.json')
    mapping, public_scenes, rows = {}, [], []
    contact = Image.new('RGB',(720,8*380),'#edf2ef'); draw=ImageDraw.Draw(contact)
    for scene_number, entry in enumerate(scene_index['scenes']):
        scene = read(DATA/entry['path']); variants=orders[scene_number]
        mapping[scene['id']] = dict(zip(['A','B','C'],variants))
        audio = MEDIA/(scene['id']+'.wav');shutil.copyfile(DATA/scene['id']/'audio.wav',audio)
        pub = dict(id=scene['id'],title=scene['title'],texts=[c['text'] for c in scene['cues']],
                   audio='prosody-r1/'+audio.name,audio_sha256=sha(audio),duration_ms=scene['duration_ms'],variants=[])
        decoded_audio = []
        for col, (label, condition) in enumerate(zip(['A','B','C'],variants)):
            clip=next(c for c in captured['clips'] if c['scene']==scene['id'] and c['condition']==condition)
            folder=CAPTURE/clip['id']; token=hashlib.sha256((scene['id']+condition+'r1').encode()).hexdigest()[:14]
            video,poster=MEDIA/(token+'.mp4'),MEDIA/(token+'.webp')
            usable=False
            if video.exists():
                existing=json.loads(run(['ffprobe','-v','error','-show_streams','-of','json',str(video)]))
                usable=any(s.get('codec_type')=='video' and int(s.get('nb_frames',0))==clip['images'] for s in existing['streams'])
                if not usable:
                    write(CAPTURE/'encoding-first-failure.json',dict(reason='FFmpeg -shortest removed the final video frame to match fractional-frame audio duration.',
                        expected_frames=clip['images'],actual=existing['streams'],fix='Explicit frame count; no -shortest. Audio stays identical across variants.'))
            if not usable:
                run(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','lavfi','-i','color=c=0xedf2ef:s=480x720:r=20',
                     '-framerate','20','-i',str(folder/'%04d.png'),'-i',str(audio),
                     '-filter_complex','[0:v][1:v]overlay=shortest=1:format=auto,format=yuv420p[v]',
                     '-map','[v]','-map','2:a:0','-c:v','libx264','-preset','fast','-crf','20','-c:a','aac','-b:a','128k',
                     '-frames:v',str(clip['images']),'-movflags','+faststart',str(video)])
            info=json.loads(run(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(video)]))
            stream=next(s for s in info['streams'] if s['codec_type']=='video')
            assert stream['r_frame_rate']=='20/1' and int(stream['width'])==480 and int(stream['height'])==720
            assert abs(float(info['format']['duration'])*1000-scene['duration_ms'])<120
            assert int(stream['nb_frames'])==clip['images']
            pcm=run(['ffmpeg','-v','error','-i',str(video),'-map','0:a:0','-f','s16le','-'])
            decoded_audio.append(hashlib.sha256(pcm).hexdigest())
            image_index=min(clip['images']-1,round(2.1*20))
            with Image.open(folder/f'{image_index:04d}.png') as raw:
                image=Image.new('RGBA',raw.size,'#edf2ef');image.alpha_composite(raw.convert('RGBA'));image=image.convert('RGB')
                image.save(poster);contact.paste(image.resize((240,360)),(col*240,scene_number*380+20))
                draw.text((col*240+8,scene_number*380+4),f"{scene['id']} {label}",fill='#203e30')
            diagnostic=metrics(clip,scene)
            rows.append(dict(**clip,diagnostics=diagnostic,video='prosody-r1/'+video.name,video_sha256=sha(video),poster_sha256=sha(poster)))
            pub['variants'].append(dict(label=label,video='prosody-r1/'+video.name,poster='prosody-r1/'+poster.name))
            print(json.dumps(dict(encoded=clip['id'],blinded_label=label,frames=clip['frames'])),flush=True)
        assert len(set(decoded_audio))==1, 'Encoded audio differs across conditions'
        pub['muxed_audio_identical']=True;public_scenes.append(pub)
    contact.save(MEDIA/'contact.png')
    for scene in public_scenes:
        matched=[c for c in rows if c['scene']==scene['id']]
        assert len({(c['diagnostics']['arm_starts'],c['diagnostics']['body_starts']) for c in matched})==1, 'Action counts confound the timing comparison'
    counts={condition:{label:sum(row[label]==condition for row in mapping.values()) for label in ['A','B','C']} for condition in ['fixed','rhythm','rhythm_posture']}
    assert all(max(row.values())-min(row.values())<=1 for row in counts.values())
    write(STUDY/'blinding.json',dict(seed=113703,mapping=mapping,label_counts=counts,balanced_positions=True,scope='Hidden by the review UI; not a security boundary'))
    aggregate=[]
    for condition in ['fixed','rhythm','rhythm_posture']:
        group=[c for c in rows if c['condition']==condition]
        active=[c for c in group if c['scene'] not in ['neutral','quoted']]
        aggregate.append(dict(condition=condition,clips=len(group),actual_frames=sum(c['frames'] for c in group),
            two_raised_arm_samples=sum(c['two_raised_arm_samples'] for c in group),
            out_of_range_inputs=sum(c['out_of_range_inputs'] for c in group),
            mean_parameter_velocity_p95=float(np.mean([c['parameter_velocity_p95'] for c in active])),
            mean_parameter_acceleration_p95=float(np.mean([c['parameter_acceleration_p95'] for c in active])),
            max_policy_tick_p95_ms=max(c['policy_tick_p95_ms'] for c in group),
            mean_gap_retained_posture_rms=float(np.mean([g['retained_posture_rms'] for c in active for g in c['diagnostics']['gaps']]))))
    report=dict(schema='prosody-study-results.v1',created_utc=datetime.now(timezone.utc).isoformat(),
        status='机制检查通过，主观自然度尚未评价',promoted=False,trained=False,human_votes=0,semantic_model_used=False,
        protocol_sha256=sha(STUDY/'protocol.json'),
        final_test_loaded=False,actual_cubism=True,real_tts=True,clips=24,actual_parameter_frames=captured['frames'],
        rows=aggregate,clip_diagnostics=rows,browser_version=captured['browser_version'],paired_action_counts_matched=True,
        findings=[
            'The controller is prefix-causal, honors pause/cancel and preserves one primary arm under these controlled intents.',
            'Bounded native-curve retiming and a small persistent posture state are executable on the actual Cubism asset.',
            'The neutral and quoted controls remain motionless despite acoustic accents and gesture words.',
            'These checks demonstrate mechanisms, not improved naturalness or semantic generalization.',
            'No word-level emphasis alignment, learned timing model or seamless native-arm handoff has been validated.'],
        limitations=read(STUDY/'protocol.json')['limitations'],
        balanced_blinding=counts,
        latency_scope='Offline local-policy timing only. Rendering ran after releasing TTS/4B workers; no concurrent or first-audio latency claim.',
        failure_record=dict(browser='Bundled Chromium 145 / revision 1208 failed sequential large-image decoding; identical original PNG bytes loaded in system Chrome 156.',
                            files=['test-results/v4-prosody-study/bootstrap-failure-detailed.json','test-results/v4-prosody-study/bootstrap-failure.png'],
                            original_assets_modified=False),
        default_and_old_ratings_unchanged=True,source_hashes={})
    sources=[STUDY/'protocol.json',STUDY/'cases.json',STUDY/'conductor.ts',DATA/'manifest.json',CAPTURE/'capture.json',
             ROOT/'scripts/v4/prepare_prosody_study.py',ROOT/'scripts/v4/capture_prosody_study.ts',ROOT/'scripts/v4/publish_prosody_study.py',
             ROOT/'tests/prosody-study.test.ts']
    report['source_hashes']={str(p.relative_to(ROOT)).replace('\\','/'):sha(p) for p in sources}
    base=next(r for r in aggregate if r['condition']=='fixed')
    report['diagnostic_relative_changes']={r['condition']:{
        'velocity_p95_mean_relative':r['mean_parameter_velocity_p95']/base['mean_parameter_velocity_p95']-1,
        'acceleration_p95_mean_relative':r['mean_parameter_acceleration_p95']/base['mean_parameter_acceleration_p95']-1
    } for r in aggregate if r['condition']!='fixed'}
    write(STUDY/'results.json',report);write(PUBLIC/'prosody-study-report.json',report)
    write(PUBLIC/'prosody-study-scenes.json',public_scenes)
    shutil.copyfile(STUDY/'review.html',PUBLIC/'prosody-study.html')
    write(STUDY/'runtime-after.json',dict(files={p:sha(ROOT/p) for p in before['files']},unchanged=True))
    summary='\n'.join('| '+r['condition']+' | '+str(round(r['mean_parameter_velocity_p95'],4))+' | '+
                      str(round(r['mean_parameter_acceleration_p95'],4))+' | '+str(round(r['mean_gap_retained_posture_rms'],4))+' |' for r in aggregate)
    text=f'''# Live2D 语音节奏与连续姿态研究 r1

本轮完成了 8 个新编双句场景、16 段本地原音色 TTS、3 个受控执行条件、24 段实际 Cubism 渲染，共 {captured['frames']:,} 帧 60 Hz 参数回读。视频为 20 fps，物理持续按 60 Hz 更新。每个场景三版使用同一音频、相同意图、手势变体、口型及表情；只比较执行机制。

这是一轮工程机制实验。语义意图由作者固定，没有调用或重训语义模型，没有人体动作真值或人工自然度评分，也未读取历史最终测试。当前默认模型、原有动作源码、评分和权重哈希均保持。

## 对照条件

- fixed：现有 GestureLibrary 与 BodyMotionLayer，固定动作时间。
- rhythm：只用当前/过去能量和稀疏声学重音，平滑调整整条原生曲线的时钟速度，并增加小幅有限头部强调。肩/肘不单独缩放，速度限幅 0.85–1.12 倍。
- rhythm_posture：在 rhythm 上增加小幅、阻尼约束的头/躯干姿态状态，跨短停顿保留，900 ms 无新句后开始释放。本轮没有改变原生手臂切换机制。

## 实际诊断

| 条件 | 归一化参数速度 P95 的场景均值 | 加速度 P95 的场景均值 | 句间保留姿态 RMS |
|---|---:|---:|---:|
{summary}

速度/加速度统计在六个有动作场景上计算，保留姿态为辅助状态 RMS；它们不是自然度得分，不能用“更大”或“更小”直接选赢家。没有人体真值，因而也不能报告加速度误差或 FGD。

节奏条件的速度 P95 场景均值约增加 10%，加速度 P95 场景均值约增加 30%。这说明反应更明显，也提示变化可能更突然；不能据此认定“更灵动”。三版每场景实际启动的手臂/身体动作数量相同，排除了多触发动作造成的数量混杂。下一步需要把整条曲线变速、小幅重音强调和姿态延续进一步拆开，并用人工偏好判断突发强调是否合适。

24 段中双臂同时抬起的输入样本、越界输入均为 0；中性与引用控制没有触发动作。各段结束后动作输入回落。改变未来音频/未来分句不改变过去输出，暂停重复采样、重复事件以及取消后迟到事件均有检查。

## 当前结论与下一步

有界的语音时钟调整和跨句小幅姿态状态可以在当前角色上执行。它们是否更灵动、更自然，仍需要隐藏版本名的感知比较。首轮页面提供 A/B/C、差不多及都不满意，导出新评分，不写入以前的评分。

建议下一阶段依据真实偏好挑选有效机制，再制作带峰值、保持、收势和不动时段标注的角色轨迹数据。对声学突发是否对应语义强调进行人工校验，再训练轻量因果时间控制器；不得把本轮规则轨迹当作人类自然动作真值。原生手臂之间直接承接和眼神协同保留为后续独立实验。

## 文献依据

- [LiveGesture §3.2](https://arxiv.org/html/2604.10927v1)：因果音频、动作历史及区域协调。这里只借鉴输入约束和分工，没有导入其人体权重。
- [EMAGE §4.2](https://arxiv.org/html/2401.00374v5)：分别表达语义内容和音频节奏，再自适应融合。这里仅做节奏执行机制对照。
- [DiffSHEG 附录 D](https://arxiv.org/html/2401.04747v2)：灵活程度和平滑度需同时观察，并结合人评。这里不复用其 3D 指标数值。

## 复现与证据

```powershell
python -X utf8 scripts/v4/prepare_prosody_study.py --audio
npx tsx --test tests/prosody-study.test.ts
npx tsx scripts/v4/capture_prosody_study.ts
python -X utf8 scripts/v4/publish_prosody_study.py
```

音频准备需原有 TTS 在 8769 运行，独立渲染需开发服务器 8775；采集器只通过本地 engine 调用，不建立 /ws 控制连接，不接管用户角色。采集时释放了 4B/TTS 显存，所列策略耗时不含语义、TTS、网络或渲染，也不是在线延迟验收。

研究源码、协议、音频、原生资产 manifest、压缩参数回读、帧图、视频与失败记录分别保存在 research/vtuber-v4-prosody-study、datasets/vtuber-v4-prosody-r1、test-results/v4-prosody-study 和 datasets/vtuber-v4/review/prosody-r1。旧 Chromium 在第三张原图解码失败，系统 Chrome {captured['browser_version']} 正常；未修改资产规避问题。
'''
    (STUDY/'REPORT.md').write_text(text,encoding='utf-8')
    print(json.dumps(dict(clips=24,frames=captured['frames'],promoted=False,trained=False,human_votes=0)),flush=True)


if __name__=='__main__':
    main()
