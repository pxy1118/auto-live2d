# Qwen3-TTS 与 Live2D 口型

当前使用 `D:/Workplace/Qwen3-TTS/runs/da_fei_yu/checkpoint-best`，1.7B CustomVoice，speaker=`da_fei_yu`。配置在 config.json，权重和 speech tokenizer 的 SHA-256 在 model-source.json，加载时校验。原有角色动作模型继续使用冻结的 VTuber v3。

## 使用

双击项目根目录 start.cmd，同时启动页面、动作专家和 TTS。进入角色页面，在台词框输入 300 字以内的文本，点击 **说话并表演**。首次点击会启用浏览器声音，随后完成合成和动作预测，再开始播放。取消“同步身体动作”可仅播放语音和口型，并保留当前表情/姿态。**停止说话**可中断播放，也可取消尚在准备的播放；正在执行的那次 GPU 合成会自行完成，不会在取消后突然出声。

声音首次启用需要浏览器用户操作。外部程序调用前，在页面点击一次 **启用声音**。root stop.ps1 会同时关闭 Node、动作专家和 TTS。

```powershell
python examples/speak_demo.py --text "大家晚上好，我是大肥鱼。"
python examples/speak_demo.py --voice-only --text "我已经收到啦。"
```

## 执行链路

1. `/api/speech/prepare` 用实际训练权重合成完整 WAV；从**最终 PCM 波形**提取 60 Hz 能量曲线，再预测同一台词的身体动作。
2. `/api/speech/execute` 将音频、口型和可选模型轨迹送到同一个角色页面。
3. 页面预先加载并解码音频，在 AudioContext 时钟上开始播放；轨迹在音频开始的渲染帧进入。
4. 每帧按播放位置插值口型，并在普通动作参数之后、物理之前叠加 ParamMouthOpenY。ParamMouthForm 保留语义表情的控制。

这解决的是**音频驱动张嘴/闭嘴**，尚未做音素级 A/I/U/E/O 或唇齿音识别。当前先合成整句再播放，未启用流式 TTS。身体轨迹保留 6.4 秒或原生动作的原时长；长语音期间口型会继续，身体回到常驻待机。

音频和身体动作可一起暂停/续播（engine.pause）。停止、复位、开始录制和回放录制会停止语音；解码尚未结束时收到取消也会阻止迟到播放。语音播放期间的基础呼吸、眨眼、待机和物理保持开启。

## 环境与文件

TTS 复用 `/home/cola/miniconda3/envs/qwen3-tts/bin/python`：Python 3.12、Torch 2.7.0+cu128、Transformers 4.57.3、Flash Attention 2。动作专家使用自己的 uv 环境和 Transformers 5.22.1；两个环境分开启动。未重新安装或改写训练项目。

| 文件 | 职责 |
| --- | --- |
| config.json / model-source.json | 本机路径、音色、模型来源与哈希 |
| runtime.py / serve.py | 本地 Qwen3-TTS 推理，端口 8769 |
| manage.py | 按 PID、创建时间、工作目录核对进程后启停 |
| lips.py | 波形能量、静音门限和开合平滑 |
| ../server/speech-bridge.ts | 合成、动作预测与一次性播放接口 |
| ../src/speech.ts | 音频时钟、嘴部优先层、暂停/取消 |

生成文件在 `.runtime/speech/audio/`，只保留最近 20 份；本服务只清理自己生成的 UUID 文件。语音准备 ID 有效 5 分钟，成功播放后消耗一次；浏览器尚未启用声音时可以启用后重试。正在录制时拒绝便捷语音播放，避免覆盖未保存的录制。

## 验证

```powershell
npm run test:speech
# 该命令默认测试隔离服务 8766，也可指定 DEMO_URL。
```

原始检查结果在 test-results/speech/，交付快照见 experiments/speech-v1/。检查使用真实 TTS、AudioContext、实际 Cubism 参数和网格，覆盖静音闭嘴、暂停/续播、动作口型优先级、表情保留、停止与取消，以及页面按钮和移动端。
