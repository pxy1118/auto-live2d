# 本地资产与推理代码布局

运行 `python main.py` 只需要本仓库内的模型、推理代码与两个 Python 环境；加载路径全部相对于项目根目录，**不再依赖 Hugging Face 缓存或 `D:/Workplace/Qwen3-TTS` 外部路径**。

## 目录

| 位置 | 内容 | 大小（本机） | 来源与获取 |
| --- | --- | --- | --- |
| `models/Qwen3.5-0.8B/` | 冻结文本编码器（bf16） | 1.6 GB | `latent/prepare_encoder.py`，revision 与 SHA-256 见 `latent/encoder-source.json` |
| `models/multilingual-emotions-base/` | 28 类情感分类器（FP32） | 1.2 GB | `latent/prepare_emotion.py`，来源与逐文件 SHA-256 见 `latent/emotion-source.json` |
| `models/Qwen3-TTS-12Hz-1.7B-da_fei_yu/` | da_fei_yu 音色微调检查点（CustomVoice 1.7B + speech tokenizer） | 4.2 GB | 原训练输出，从 `D:/Workplace/Qwen3-TTS/runs/da_fei_yu/checkpoint-best` 移入；SHA-256 见 `speech/model-source.json` |
| `experiments/vtuber-v6-acting-feedback-r3-final/` | v6 事件/连续分支检查点与运行元数据 | 3.9 MB | `latent/train_acting_feedback.py` 训练产物；`run.json` 记录数据与契约哈希 |
| `vendor/qwen3-tts/` | Qwen3-TTS 推理源码固定副本（Apache-2.0） | 0.9 MB | 上游 `QwenLM/Qwen3-TTS` commit `022e286b...`；逐文件 SHA-256 见 `SOURCE.json` |
| `vendor/faster-qwen3-tts/` | CUDA Graph 加速源码固定副本（MIT） | <0.1 MB | 上游 commit `b84dc773...` |
| `datasets/emotion-catalog-v1/` | affect 缓存、曲线仿真、合成监督记录 | 80.9 MB 缓存 + 269 KB 记录 | `research/emotion-catalog-r1-archive/build_affect_cache.py.snapshot`（缓存可由脚本重建，按 `.gitignore` 不随仓库分发） |
| `live2d/DeepSeek/DeepSeek/` | 角色模型与原生动画 | 本机素材 | 按 README 从原作者处获取，禁止再分发 |
| `vendor/cubism/` | Cubism SDK for Web 5 R4 | 本机 SDK | 从官方 SDK 包提取 |

推理代码全部在项目内：`latent/serve.py`、`speech/serve.py`、`speech/runtime.py`、`server/index.ts`、`main.py`；TTS 的 `qwen_tts` 包已改为项目内 editable 安装（conda 环境中 `pip install -e vendor/qwen3-tts`），从任意目录 import 都解析到 `vendor/qwen3-tts/qwen_tts/`。

## 自检

```powershell
python scripts/verify_local_assets.py
```

逐文件校验 48 项资产的存在与 SHA-256（编码器、情感模型、TTS 权重、两个 vendor 源码副本、运行时 profile、v6 检查点），不需要网络；失败时非零退出并列出缺失/不匹配项。

## 两个 Python 环境

- **动作/情感**：WSL 内 uv 环境，默认 `~/.local/share/auto-live2d/latent-venv`（可用 `UV_PROJECT_ENVIRONMENT` 覆盖）；由 `main.py` 自动同步与启动。
- **TTS**：独立 conda 环境，路径在 `speech/config.json` 的 `python` 字段；当前为 `/home/cola/miniconda3/envs/qwen3-tts/bin/python`。环境不属于模型资产，不随仓库分发；如需迁移，修改该字段即可，`vendor/qwen3-tts` 源码副本与 `models/` 权重不受影响。

## 已释放的 HF 缓存

清理前 WSL `~/.cache/huggingface/hub` 的 4 个 Qwen3-TTS 基础/训练模型（0.6B Base、0.6B CustomVoice、1.7B CustomVoice、1.7B VoiceDesign）共 **13.4 GB**，Windows HF 缓存的 Qwen3-TTS 0.6B Base **2.4 GB**，均已删除（合计约 **15.5 GB**）。推理不再需要它们：微调检查点已包含模型与 speech tokenizer，加载时 `local_files_only=True`，并在空 `HF_HOME` 下实测通过。

WSL HF 缓存中仍有与本项目无关的模型（faster-whisper-small、MiniCPM5-2B、Ornith 等，约 5.3 GB），未擅自删除；Windows HF 缓存剩余约 0.2 GB 也保留。需要清理时另行确认。

## 外部残留（未删除，待确认）

- `D:/Workplace/Qwen3-TTS/` 训练仓库：已移出 `runs/da_fei_yu/checkpoint-best` 与 `qwen_tts` 源码副本，仍保留训练脚本、数据集与其它 run，约 4.3 GB。
- `models/Qwen3.5-4B/`：v5 之前的研究用 4B 权重，当前 v6 默认链路不加载，12.9 GB，可按需删除或归档。

这两项不影响 `python main.py` 运行。
