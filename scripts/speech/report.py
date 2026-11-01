"""Freeze a reviewable speech-integration demo without duplicating model weights."""
import json,shutil,wave,hashlib
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

ROOT=Path(__file__).resolve().parents[2]
def read(p):return json.loads(p.read_text(encoding='utf-8-sig'))
def sha(p):
    with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()

folder=ROOT/'experiments/speech-v1'
if (folder/'FULL-MANIFEST.json').exists():raise ValueError('Speech demo already sealed; use a new version')
folder.mkdir(exist_ok=True);(folder/'browser').mkdir(exist_ok=True);(folder/'source').mkdir(exist_ok=True)
result=read(ROOT/'test-results/speech/verification.json');control=read(ROOT/'test-results/verification.json');latent=read(ROOT/'test-results/latent/verification.json')
assert result['ok'] and control['ok'] and latent['ok'] and len(latent['cases'])==25
case=result['cases'][0];key=case['speech_id'];audio=ROOT/'.runtime/speech/audio'/(key+'.wav')
assert sha(audio)==case['audio_sha256']
shutil.copy2(audio,folder/'sample.wav');shutil.copy2(audio.with_suffix('.json'),folder/'sample.json')
for source,name in [(ROOT/'test-results/speech/verification.json','speech-verification.json'),(ROOT/'test-results/verification.json','control-regression.json'),(ROOT/'test-results/latent/verification.json','latent-regression.json')]:shutil.copy2(source,folder/name)
for p in (ROOT/'test-results/speech').glob('*.png'):shutil.copy2(p,folder/'browser'/p.name)
for dirname in ['speech']:
    shutil.copytree(ROOT/dirname,folder/'source'/dirname,dirs_exist_ok=True,ignore=shutil.ignore_patterns('__pycache__'))
for relative in ['src/speech.ts','src/speech-panel.ts','src/engine.ts','src/latent-panel.ts','src/main.ts','src/latent.css','server/speech-bridge.ts','server/index.ts','server/latent-bridge.ts','start.ps1','stop.ps1','package.json','tests/speech-browser.ts','examples/speak_demo.py','scripts/speech/report.py']:
    target=folder/'source'/relative;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(ROOT/relative,target)
with wave.open(str(folder/'sample.wav')) as f:rate=f.getframerate();waveform=np.frombuffer(f.readframes(f.getnframes()),dtype='<i2').astype(float)/32768
frames=[f for f in case['trace'] if f['phase']=='playing'];t=np.array([f['audio_time_ms'] for f in frames])/1000
fig,ax=plt.subplots(2,1,figsize=(10,5.2),sharex=True,layout='constrained')
stride=max(1,len(waveform)//6000);ax[0].plot(np.arange(len(waveform))[::stride]/rate,waveform[::stride],color='#60786d',lw=.55);ax[0].set_ylabel('PCM amplitude');ax[0].set_title('Qwen3-TTS audio and actual Cubism mouth readback')
ax[1].plot(t,[f['expected'] for f in frames],label='Audio envelope at playback clock',color='#368b6e',lw=1.8)
ax[1].plot(t,[f['actual'] for f in frames],label='Actual ParamMouthOpenY',color='#d28d52',lw=1,alpha=.9)
ax[1].set(xlabel='Audio playback position (seconds)',ylabel='Mouth openness',ylim=(-.02,.92));ax[1].legend(frameon=False,loc='upper right',fontsize=8)
for a in ax:a.spines[['top','right']].set_visible(False);a.grid(alpha=.12)
fig.savefig(folder/'sync.png',dpi=160);plt.close(fig)
source=read(ROOT/'speech/model-source.json')
report=f'''# Qwen3-TTS 与 Live2D 语音闭环 v1

已连接用户训练好的 1.7B CustomVoice checkpoint，音色 `da_fei_yu`。台词经 TTS 合成整句音频，同时取得原有 VTuber v3 身体动作；浏览器按 AudioContext 时钟播放，实际波形的 60 Hz 能量曲线驱动嘴部开合。

## 实际测量

测试台词：**大家晚上好，我是大肥鱼。很高兴又见到你。**

| 项目 | 结果 |
| --- | --- |
| 实际音频 | {case['duration_ms']/1000:.2f} 秒 / {rate} Hz PCM16 |
| 本次合成耗时 | {case['synthesis_ms']/1000:.2f} 秒 |
| 实际嘴部参数与播放时钟下口型包络的相关系数 | {case['correlation']:.4f} |
| 嘴部参数平均绝对偏差（参数范围 0～1） | {case['mae']:.4f} |
| 原有神经动作播放案例 | 25/25 通过 |
| 原始控制、录制回放和外部调用回归 | 通过；回放参数最大误差 {control['max_replay_parameter_error']} |

该相关系数验证的是**预定能量包络到真实 Cubism 嘴部参数的执行同步**，不是音素口型准确率或语音识别准确率。尚未进行逐音素或主观听感评估。嘴部截图与实际网格也已检查，张开/闭合可见。

![实际音频和口型](sync.png)

[示例语音](sample.wav) · [口型、来源与音频哈希](sample.json) · [逐帧浏览器检查](speech-verification.json)

## 已验证行为

- 浏览器声音未启用时返回明确错误，启用后能重试同一个准备 ID；成功播放后 ID 消耗一次。
- 实际音频驱动可覆盖动作模型的中性闭嘴输出，语义嘴形继续保留。
- 声音与动作一起暂停/续播；播放结束闭嘴，四项基础行为保持开启。
- 仅语音模式保留当前表情/姿态；停止和复位能取消播放。
- 音频尚在获取/解码时取消，或合成期间点击停止，均不会迟到自动出声。
- 页面“说话并表演”、停止按钮和移动端布局通过。

## 接口与启动

双击根目录 `start.cmd`，打开 `http://127.0.0.1:8765/?speech=1#latent-panel`，输入台词后点击 **说话并表演**。外部 LLM 使用 `/api/speech/prepare` → `/api/speech/execute`；先在页面启用一次声音。示例脚本为 `examples/speak_demo.py`。根 `stop.ps1` 同时关闭 Node、动作专家和 TTS。

配置和工作方式见 [speech/README.md](../../speech/README.md)，接口见 [docs/api.md](../../docs/api.md)。TTS 复用原训练环境（Torch 2.7.0 / Transformers 4.57.3），与动作模型环境分开，避免依赖冲突。用户模型保持原位引用，未复制多份权重。

## 当前边界

当前先合成整句再播放，非流式生成。口型是音频能量驱动的开合，尚无 A/I/U/E/O、唇齿音等音素级形状。身体轨迹保留自己的 6.4 秒或原生动作时长，长语音继续使用常驻待机。当前记录只作工程验证，未加入任何动作训练集；原有冻结数据与动作模型哈希已复核。

TTS 权重 SHA-256：`{source['files'][0]['sha256']}`。音频 SHA-256：`{case['audio_sha256']}`。
'''
(folder/'REPORT.md').write_text(report,encoding='utf-8')
files=[{'path':str(p.relative_to(folder)).replace('\\','/'),'bytes':p.stat().st_size,'sha256':sha(p)} for p in sorted(folder.rglob('*')) if p.is_file()]
(folder/'FULL-MANIFEST.json').write_text(json.dumps({'schema':'speech_integration.v1','files':files,'trained_action_dataset_modified':False},ensure_ascii=False,indent=2),encoding='utf-8')
print({'report':str(folder/'REPORT.md'),'files_sealed':len(files),'audio_seconds':len(waveform)/rate,'correlation':case['correlation']})
