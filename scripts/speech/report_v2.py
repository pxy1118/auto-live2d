"""Seal measured streaming/synchronization results without duplicating weights."""
import hashlib
import json
from pathlib import Path
import shutil
import statistics
import wave
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

ROOT=Path(__file__).resolve().parents[2]
read=lambda p:json.loads(p.read_text(encoding='utf-8-sig'))


def sha(path):
    with path.open('rb') as handle:return hashlib.file_digest(handle,'sha256').hexdigest()


if __name__=='__main__':
    folder=ROOT/'experiments/speech-v2';results=ROOT/'test-results/speech-v2'
    if (folder/'FULL-MANIFEST.json').exists():raise ValueError('speech-v2 already sealed')
    stream=read(results/'stream-verification.json');legacy=read(ROOT/'test-results/speech/verification.json')
    latent=read(ROOT/'test-results/latent/verification.json');frozen=read(results/'frozen-verification.json')
    launcher=read(ROOT/'test-results/launcher/test_01_real_ctrl_c_stops_every_service_and_duplicate_is_rejected.json')
    stop_case=read(ROOT/'test-results/launcher/test_05_stop_command_handles_a_retained_launcher_process_handle.json')
    shutdown=read(ROOT/'.runtime/main-last.json')
    assert stream['ok'] and legacy['ok'] and latent['ok'] and len(latent['cases'])==25
    assert all(v['verified'] for v in frozen.values()) and launcher['all_stopped'] and stop_case['all_stopped'] and shutdown['all_stopped']
    assert not (ROOT/'.runtime/main-process.json').exists(),'Stop the verification services before sealing'
    old=ROOT/'experiments/speech-v1';old_manifest=read(old/'FULL-MANIFEST.json')
    assert all(sha(old/entry['path'])==entry['sha256'] for entry in old_manifest['files'])
    baseline=read(results/'baseline.json');fast=read(results/'benchmark-cuda_graph.json');bench=read(results/'stream-benchmark.json')
    case=stream['cases'][0];audio=ROOT/'.runtime/speech/audio'/Path(case['audio_url']).name
    assert sha(audio)==case['audio_sha256'];assert all(c['pcm_exact_match'] for c in bench['cases'])
    folder.mkdir(exist_ok=True);(folder/'browser').mkdir(exist_ok=True)
    shutil.copy2(audio,folder/'sample.wav');shutil.copy2(audio.with_suffix('.json'),folder/'sample.json')
    for source,name in [(results/'stream-verification.json','stream-verification.json'),(ROOT/'test-results/speech/verification.json','legacy-verification.json'),
                        (ROOT/'test-results/latent/verification.json','latent-regression.json'),(results/'baseline.json','baseline.json'),
                        (results/'benchmark-cuda_graph.json','benchmark-cuda_graph.json'),(results/'stream-benchmark.json','stream-benchmark.json'),
                        (results/'frozen-verification.json','frozen-verification.json'),(ROOT/'.runtime/main-last.json','shutdown.json'),
                        (ROOT/'test-results/launcher/test_01_real_ctrl_c_stops_every_service_and_duplicate_is_rejected.json','ctrl-c-verification.json'),
                        (ROOT/'test-results/launcher/test_05_stop_command_handles_a_retained_launcher_process_handle.json','stop-command-verification.json'),
                        (results/'final-shutdown-verification.json','final-shutdown-verification.json')]:
        shutil.copy2(source,folder/name)
    for file in results.glob('*.png'):shutil.copy2(file,folder/'browser'/file.name)
    sources=['main.py','src/controller.ts','src/engine.ts','src/speech.ts','src/speech-motion.ts','src/speech-panel.ts','src/latent-panel.ts','src/main.ts',
             'server/speech-bridge.ts','server/ndjson.ts','server/index.ts','server/latent-bridge.ts','latent/serve.py','examples/speak_demo.py',
             'tests/speech-stream-browser.ts','tests/speech-browser.ts','tests/speech-motion.test.ts','tests/test_launcher.py',
             'package.json','package-lock.json','scripts/speech/benchmark.py','scripts/speech/benchmark_stream.py','scripts/speech/report_v2.py',
             'vendor/faster-qwen3-tts/SOURCE.json','vendor/faster-qwen3-tts/LICENSE','docs/api.md','docs/architecture.md','README.md']
    sources += [str(p.relative_to(ROOT)).replace('\\','/') for p in (ROOT/'speech').glob('*') if p.is_file()]
    for relative in sources:
        destination=folder/'source'/relative;destination.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(ROOT/relative,destination)
    frames=[t for t in case['trace'] if t['phase']=='playing'];positions=np.array([t['audio_ms']/1000 for t in frames])
    fig,axes=plt.subplots(3,1,figsize=(10,8),layout='constrained')
    gaps=np.flatnonzero(np.diff(positions)>.15)+1
    plot_positions=np.insert(positions,gaps,np.nan)
    def plotted(values):return np.insert(np.asarray(values,dtype=float),gaps,np.nan)
    for index in gaps:
        for axis in axes[:2]:axis.axvspan(positions[index-1],positions[index],color='#d6d8da',alpha=.28)
    with wave.open(str(folder/'sample.wav'),'rb') as handle:
        sr=handle.getframerate();pcm=np.frombuffer(handle.readframes(handle.getnframes()),dtype='<i2').astype(float)/32768
    step=max(1,len(pcm)//7000);axes[0].plot(np.arange(len(pcm))[::step]/sr,pcm[::step],color='#7898a3',lw=.55,label='Served PCM')
    axes[0].plot(plot_positions,plotted([t['actual'] for t in frames]),color='#bb5840',lw=1.2,label='Actual Cubism mouth')
    axes[0].plot(plot_positions,plotted([t['expected'] for t in frames]),color='#215c4b',lw=.8,alpha=.8,label='Audio-clock mouth cue')
    axes[0].set(ylabel='Amplitude / mouth',title='Same PCM samples drive voice and mouth');axes[0].legend(loc='upper right',fontsize=8,ncol=3)
    axes[1].plot(plot_positions,plotted([t['rhythm']['beat'] for t in frames]),color='#215c4b',lw=1.1,label='Head emphasis')
    axes[1].plot(plot_positions,plotted([t['rhythm']['body_beat'] for t in frames]),color='#be9250',lw=1.1,label='Chest emphasis (90 ms later)')
    axes[1].set(xlabel='Audio position (s)',ylabel='Accent strength',title='Sparse audio emphasis couples head and chest');axes[1].legend(loc='upper right',fontsize=8)
    trace=[t for t in case['trace'] if t['phase']!='idle'];wall=[t['wall_ms']/1000 for t in trace]
    axes[2].plot(wall,[t['audio_ms']/1000 for t in trace],label='Audio position',color='#215c4b')
    axes[2].plot(wall,[(t['motion_ms'] or 0)/1000 for t in trace],label='Retimed semantic phase',color='#bb5840')
    axes[2].set(xlabel='Wall time after click (s)',ylabel='Media / model seconds',title='Shared clock across pause and a 650 ms render stall');axes[2].legend(loc='upper left',fontsize=8)
    for axis in axes:axis.grid(alpha=.18);axis.spines[['top','right']].set_visible(False)
    fig.savefig(folder/'sync.png',dpi=180);plt.close(fig)
    matched=[c['synthesis_ms'] for c in fast['cases'] if c['text']==baseline['text']]
    full=statistics.mean(matched);pcm_times=[c['first_pcm_ms'] for c in bench['cases']]
    source=stream['status'];vendor=source['accelerator_source']
    report=f'''# 语音响应与动作联动 v2

使用原有 da_fei_yu / checkpoint-best 与 VTuber v3 动作专家。新增 CUDA Graph 推理、流式 PCM 播放、动作与语音并行准备、统一媒体时钟和小幅语音重音联动。未重新训练，也未改动训练项目、原始角色、冻结数据或动作检查点。

## 实测

本机 RTX 5070 Ti，CUDA，Qwen3-TTS 1.7B，Torch {source['environment']['torch']} / Transformers {source['environment']['transformers']}。旧完整接口基线为同机同句的一次已有热服务测量，加速完整接口为两次独立服务测量；流式 worker 为两句各三次，浏览器为一次完整记录。不是跨硬件基准或主观自然度评分。

| 测量 | 结果 |
| --- | --- |
| 同一句原完整合成（语音 4.32 秒） | {baseline['synthesis_ms']/1000:.3f} 秒 |
| 同一句 CUDA Graph 完整合成 | {full/1000:.3f} 秒；约 {baseline['synthesis_ms']/full:.2f} 倍 |
| 热 worker 首 PCM，6 次 | {min(pcm_times)/1000:.3f}～{max(pcm_times)/1000:.3f} 秒；中位 {statistics.median(pcm_times)/1000:.3f} 秒 |
| 浏览器点击到实际音频时钟起播 | {case['first_audio_ms']/1000:.3f} 秒 |
| 浏览器点击到实际嘴部开度超过 0.12 | {case['first_mouth_open_ms']/1000:.3f} 秒 |
| 该浏览器样例语音 / 全部生成耗时 | {case['duration_ms']/1000:.2f} / {case['synthesis_ms']/1000:.3f} 秒 |
| 音频开始播放时仍在生成 | {case['worker_busy_at_start']} |
| 真实 TTS 播放缓冲不足 | 0 次 |
| 预定口型到实际 Cubism 嘴部参数相关系数 | {case['correlation']:.4f} |
| 已有动作与可见配置回归 | 25/25 通过 |
| 冻结 v2/v3 数据与动作实验逐文件校验 | 全部通过 |
| 真实 Ctrl+C 与最后一次测试关闭 | 进程、端口全部释放 |

首 PCM、AudioContext 起播、嘴部出现有声开合是不同测量。模型音频带有前导安静段；没有将它们混称为首个有声音节的延迟。嘴部阈值是实际模型参数的代理，并非人工听感计时。口型相关系数仅验证执行同步，不代表音素准确率。

## 动作如何配合语音

语义专家仍根据整句台词/语境生成连续轨迹与表情、手势配置。生成轨迹按音频总长度重定时；最终长度尚未知时预留结束区，得到真实样本数后从当前进度继续对齐，不倒退。语音较长时身体继续表演。完整原始脱捕保持原速，可以在短台词结束后继续完成。

实际 PCM 产生因果能量、开合与稀疏重音；小幅点头与晚 90 ms 的躯干重音联动。两次强调至少间隔 550 ms，手势与表情不由音量切换。停顿时重音衰减，呼吸、眨眼、待机和物理继续运行。暂停、缓冲不足时媒体进度保持；渲染卡顿后身体相位从音频时钟恢复。

这是语义动作加音频节奏层，尚未训练音频条件动作网络，也没有逐词强制对齐或音素级口型。若要学习“哪个词对应哪个动作”，下一步需要带语音时间戳的文本—音频—动作监督，按说话人/台词族隔离评估。

![实际波形、嘴部与动作时钟](sync.png)

灰区是测试中刻意阻塞渲染产生的无逐帧采样窗口，曲线在此留空；声音继续播放，恢复绘制后重新按媒体位置采样。它不表示卡顿期间画面仍能更新。

[实际流式语音](sample.wav) · [波形与推理来源](sample.json) · [逐帧浏览器验证](stream-verification.json) · [完整接口回归](legacy-verification.json) · [流式测量](stream-benchmark.json)

## 验证范围

真实模型与 Cubism 检查覆盖：首段播放时继续生成；零真实断流；长句动作伸展；头/躯干重音；暂停/续播；650 ms 渲染阻塞后的时钟恢复；仅语音保留黑脸和情绪嘴形；取消真实解码；并发拒绝；迟到分块隔离；缺失/重复样本拒绝；故意缓冲不足后的续播；外部 Python 调用和移动端。另有单元检查覆盖动作专家失败时取消并行 TTS、流截断后的清理与无效协议。所有数据/动作检查点校验通过。

6 次流式测量逐样本验证传输 PCM 与最终 WAV 完全一致。分块边界跃变未高于各波形通常的 99 分位跳变；这是数值检查，不替代人工试听或音色相似度/自然度评分。

停止路径另外复现并修复了 Windows 保留已退出进程句柄时的误报：创建时间继续用于核对身份，额外读取退出状态区分已结束进程。已用保留 Popen 句柄的单元复现、完整 `--stop` 路径和真实 Ctrl+C 验证。[Windows 退出状态接口](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getexitcodeprocess)

## 运行与复现

`python main.py` 启动全部服务，模型和解码器预热后报告就绪；按 Ctrl+C 全部关闭。页面刷新到新版本后，点击“说话并表演”。外部 LLM 可调用 `/api/speech/perform`，或运行 `python examples/speak_demo.py --text "你好，我是大肥鱼。"`。原 prepare/execute 接口继续可用。

`npm test`、`npm run check`、`npm run test:speech`、`npm run test:speech:stream`；动作回归为 `npm run test:latent`。流式测量脚本 `scripts/speech/benchmark_stream.py`；独立完整合成比较 `scripts/speech/benchmark.py --backend huggingface|cuda_graph`，需先关闭已有 TTS。

加速源码：[{vendor['repository']}]({vendor['repository']})，版本 {vendor['version']}，commit `{vendor['revision']}`，MIT。固定源码与逐文件哈希见 source/vendor/faster-qwen3-tts/SOURCE.json；保留现有 Transformers 4.57.3 环境，未安装替换训练依赖。CPU 完整推理回退路径保留，未测试其性能。

TTS 权重 SHA-256：`{source['checkpoint_sha256']}`。样例 WAV SHA-256：`{case['audio_sha256']}`。当前测试未加入动作训练集。旧 experiments/speech-v1/ 保持封存；本目录的 source/ 是交付时源码快照，不是新入口。
'''
    (folder/'REPORT.md').write_text(report,encoding='utf-8')
    files=[{'path':str(p.relative_to(folder)).replace('\\','/'),'bytes':p.stat().st_size,'sha256':sha(p)} for p in sorted(folder.rglob('*')) if p.is_file()]
    manifest={'schema':'speech_streaming.v2','trained_action_dataset_modified':False,'tts_weights_modified':False,'files':files}
    (folder/'FULL-MANIFEST.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'report':str(folder/'REPORT.md'),'files':len(files),'first_playback_ms':case['first_audio_ms'],'first_mouth_open_ms':case['first_mouth_open_ms'],'full_speedup':baseline['synthesis_ms']/full},ensure_ascii=False))
