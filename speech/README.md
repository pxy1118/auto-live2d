# Qwen3-TTS 与 Live2D 口型

当前使用项目内权重 `models/Qwen3-TTS-12Hz-1.7B-da_fei_yu/`（1.7B CustomVoice，speaker=`da_fei_yu`），推理源码为 `vendor/qwen3-tts/` 固定副本。配置在 config.json，权重与 speech tokenizer 的 SHA-256 在 model-source.json，源码逐文件哈希在 `vendor/qwen3-tts/SOURCE.json`，加载时全部校验；不依赖 Hugging Face 缓存或外部训练仓库。原有角色动作模型继续使用冻结的 VTuber 语义编码器与两个小动作头。

## 使用

在项目根目录运行 `python main.py`，同时启动页面、动作专家和 TTS。保持终端运行，按 Ctrl+C 一并关闭。进入角色页面，在台词框输入 400 字以内的文本，点击 **说话并表演**。首次点击会启用声音；CUDA 默认边生成边说。取消“同步身体动作”可仅播放语音和口型，并保留当前表情/姿态。**停止说话**会中断声音，取消尚未完成的流式解码。使用完整合成兼容接口时，取消可阻止迟到播放，该次 GPU 调用仍会完成。

声音首次启用需要浏览器用户操作。外部程序调用前，在页面点击一次 **启用声音**。另一个终端可用 `python main.py --stop` 或 root stop.ps1 关闭全部服务。

```powershell
python examples/speak_demo.py --text "大家晚上好，我是大肥鱼。"
python examples/speak_demo.py --voice-only --text "我已经收到啦。"
```

## 执行链路

1. 页面“说话并表演”调用 `/api/speech/perform`。动作专家与 CUDA Graph TTS **并行**运行，同一整句台词保留完整文本上下文，不把文字截成短句重合成。
2. TTS 每 8 个 codec 帧输出一段约 640 ms 的真实 PCM16；首段进入浏览器后即调度播放，后续边生成边缓冲。最终 WAV 保存的样本与流式传输的样本完全一致。
3. 嘴部、语义动作进度和小幅语音节奏动作都采样 AudioContext 的实际播放位置。生成轨迹按语音长度重定时；最终长度未知时使用估计，得到实际样本数后从当前动作进度继续对齐，避免倒放表情或手势。完整原始“脱捕”保留原速，可以在短台词结束后继续完成。
4. 从实际 PCM 因果提取 60 Hz 嘴部开合、平滑能量与稀疏重音。小幅点头与胸部俯仰联动，躯干重音比头部晚 90 ms；两次重音至少相隔 550 ms。该层不增加手势或表情开关。
5. ParamMouthOpenY 在语义动作之后、物理之前叠加；ParamMouthForm 保留情绪嘴形。呼吸、眨眼、待机和物理常驻。

流式播放遇到缓冲不足会保持音频与身体的媒体进度，数据恢复后续播；暂停可继续接收缓冲，恢复时从原样本位置开始。停止或关闭流式请求会取消后续解码，迟到分块不能重新开始播放。

兼容的 `/api/speech/prepare` 和 `/execute` 仍可用于先检查完整 WAV、再一次性播放；prepare 同样使用加速，并行准备音频与动作。CPU 模式使用原 Hugging Face 完整合成路径，页面自动选择兼容接口，未测试 CPU 性能。

当前解决的是**语音节奏与动作执行的配合**。嘴部尚无音素级 A/I/U/E/O 或唇齿音识别；语义动作模型仍只读台词/语境，没有新增音频条件训练，也没有逐词强制对齐。音频重音层是可检查的信号处理与播放逻辑。

音频和身体动作可一起暂停/续播（engine.pause）。停止、复位、开始录制和回放录制会停止语音；解码尚未结束时收到取消也会阻止迟到播放。语音播放期间的基础呼吸、眨眼、待机和物理保持开启。

## 环境与文件

TTS 复用独立 conda 环境（路径在 config.json 的 `python` 字段，当前 `/home/cola/miniconda3/envs/qwen3-tts/bin/python`）：Python 3.12、Torch 2.7.0+cu128、Transformers 4.57.3。环境不属于模型资产；推理源码在项目内 `vendor/qwen3-tts/`，conda 环境已用 editable 安装指向该副本，也可从任意目录 import。CUDA Graph 使用 SDPA；可在 config.json 将 backend 改为 huggingface，恢复原 Flash Attention 2 完整推理。动作专家使用自己的 uv 环境和 Transformers 5.22.1；两个环境分开启动。未重新安装或改写训练项目。

加速后端是 [faster-qwen3-tts](https://github.com/andimarafioti/faster-qwen3-tts) 0.3.2，固定 commit `b84dc773b2199a85cb421eb76857e4475e03e8c4`（MIT），保留未修改源码、协议和逐文件哈希。该版本匹配现有 Transformers 4；不向训练环境安装新版依赖。启动时校验权重与加速源码，捕获 CUDA Graph 并预热流式解码后再报告 ready。权重仍是原 checkpoint-best。

| 文件 | 职责 |
| --- | --- |
| config.json / model-source.json | 项目相对路径、音色、权重来源与哈希 |
| runtime.py / serve.py | 本地 Qwen3-TTS 推理，端口 8769 |
| accelerator.py | 使用固定版本推理源码捕获 CUDA Graph |
| ../vendor/qwen3-tts/ | Qwen3-TTS 推理源码固定副本（Apache-2.0，含逐文件 SHA-256） |
| ../models/Qwen3-TTS-12Hz-1.7B-da_fei_yu/ | da_fei_yu 音色微调检查点，不随公开仓库分发 |
| ../main.py | 前台管理整组服务，Ctrl+C 关闭；WSL 内按进程组清理 |
| manage.py | 独立调试单个 TTS 服务时使用的旧管理工具 |
| lips.py | 波形能量、静音门限和开合平滑 |
| features.py | 跨分块连续的因果口型、能量和稀疏重音 |
| ../server/speech-bridge.ts | 合成、动作预测与一次性播放接口 |
| ../src/speech.ts / speech-motion.ts | 样本连续调度、媒体时钟、动作重定时与暂停/取消 |

生成文件在 `.runtime/speech/audio/`，只保留最近 20 份；本服务只清理自己生成的 UUID 文件。语音准备 ID 有效 5 分钟，成功播放后消耗一次；浏览器尚未启用声音时可以启用后重试。正在录制时拒绝便捷语音播放，避免覆盖未保存的录制。

## 验证

```powershell
npm run test:speech
npm run test:speech:stream
# 该命令默认测试隔离服务 8766，也可指定 DEMO_URL。
```

原始整句接口检查在 test-results/speech/；流式播放、时间同步和性能测量在 test-results/speech-v2/。检查使用真实 TTS、AudioContext、实际 Cubism 参数和网格，覆盖先出声后完成合成、长语音动作伸展、头/躯干重音、暂停与渲染卡顿、缓冲不足、取消解码、旧分块隔离、表情保留和移动端。旧快照 experiments/speech-v1/ 保持封存。

交付测量、样例语音、同步图与源码快照见 [speech-v2 实测报告](../experiments/speech-v2/REPORT.md)。

测量脚本：`scripts/speech/benchmark_stream.py` 在当前 TTS 环境中访问已启动的 8769 服务，记录首 PCM 延迟、全程时间、波形与分块边界；`benchmark.py --backend huggingface|cuda_graph` 则在服务关闭时独立加载相同权重作完整合成对比。测量结果代表本机与指定台词，不保证其他机器的延迟。
