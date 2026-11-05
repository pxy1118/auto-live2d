# Auto Live2D

输入台词，让角色伴随语音做表情和动作。未来由 **DeepSeekharness（DSH）** 提供台词；语音继续使用本地 **Qwen3-TTS / da_fei_yu**。

当前模型包为 `vtuber-v5-emotion-action-r1`，控制运行时为 `v5.0.0-emotion-action`，默认风格为“活泼”。页面只保留角色预览、台词、开始/停止，语境与风格放在折叠设置中。

![说话与表演界面](docs/media/demo-desktop.png)

角色为免费练习模型“大肥鱼”，**原画：神宫凉子**。本仓库不包含角色原始素材与 PSD。

## 使用

```powershell
python main.py
```

打开 <http://127.0.0.1:8765/>，输入台词，点击 **开始说话**。首次点击同时启用声音；**停止**中断当前发言。支持 Ctrl / ⌘ + Enter 开始，可切换全身或半身预览。

“语境与表演风格”是可选设置。默认“活泼”保留完整的连续背景头身幅度，手势与身体动作分别采用 4 秒和 2.6 秒的最短间隔；也可以选择“自然”或“克制”。协调关节曲线、语义门槛、原音色与原生物理沿用现有方案。

保持启动终端运行，按 **Ctrl+C** 关闭全部服务。另一个终端也可执行 `python main.py --stop`。不自动打开网页用 `python main.py --no-browser`；`start.cmd`、`start.ps1` 使用同一入口。日志和进程记录位于 `.runtime/`。

## 当前运行链路

- [Horizon-Labs/multilingual-emotions-base](https://huggingface.co/Horizon-Labs/multilingual-emotions-base) 默认在 GPU 上以 FP32 输出 28 类独立情感分数。句内短语形成观测点，连续情绪层保留混合情感，以较快反应和较慢心境驱动表情与动作；跨句延续，随实际音频推进，不因逗号重启 TTS。
- 当前 Qwen3.5-0.8B 动作编码器与轻量动作头在 GPU 上处理台词、语境、动作历史和情绪条件；沿用已确认的协调曲线、连续背景、呼吸、眨眼与物理。
- 已移除默认链路中的 4B 规划器和依赖它的身体分支。分类器负责情绪，动作模型负责手势与身体语义。
- Qwen3-TTS 音色与 CUDA Graph 方案继续使用。240 字以内的已知台词合成一次，标点不反复重启；多个表演计划跟随同一音频时钟。长文按预算拆分，播放时预取下一组。
- Windows Node 提供网页与会话 API（8765）；WSL 动作服务（8768）和 TTS（8769）由统一启动器管理。

旧预测/语音面板、参数实验台、手动动作面板和历史评分入口已移除。日常服务不再提供 `/api/latent/*`、`/api/speech/*`，也不再支持 `--legacy`、`--semantic` 或自动回退。v3 整段动作头、Flow、旧门控和九类手势选择器不再随默认模型加载。历史数据、评分和研究代码保留作研究记录。

当前 0.8B 连续专家属于现有表演的一部分。架构与未来统一模型的边界见 [架构说明](docs/architecture.md)，近期变更见 [版本记录](docs/project-status.md)。本次没有重训模型，也没有将历史评分改写成新的自然度结论。

情绪曲线、概率与表达强度的区别，以及借鉴 SoulLink 的范围见 [连续情绪说明](docs/emotion-curves.md)。

## 外部调用与 DSH

外部程序使用 `POST /api/command`，角色页面需保持打开并先通过用户点击启用声音。整段台词只需建立会话后一次提交：

```json
{"method":"performance.start","params":{"context":"和观众日常聊天"},"request_id":"start-1"}
{"method":"performance.finish","params":{"session_id":"上一步返回的ID","seq":0,"text":"大家好呀，今天也一起加油吧！"},"request_id":"finish-1"}
```

增量文字使用 `performance.append`；结束使用 `performance.finish`，打断使用 `performance.cancel`。模型候选与动作后端由服务固定，不需要调用方选择。人工导演与持久外观使用当前 `performance.direct` 和 `appearance.update`。

完整客户端见 [`examples/performance_demo.py`](examples/performance_demo.py)，接口见 [会话 API](docs/performance-v4.md)与[工具 Schema](docs/performance-tools.json)。

## 本地资源与环境

公开仓库包含自研代码、说明、测试与实验元数据。运行还需要本机资源：

| 资源 | 准备方式 |
| --- | --- |
| Live2D Cubism SDK for Web 5 R4 | 从官方 SDK 包提取 `Core/`、`Framework/`、`LICENSE.md` 到 `vendor/cubism/`；来源见 [第三方说明](THIRD-PARTY-NOTICES.md) |
| 大肥鱼角色 | 从原作者处获取，保持模型目录与文件名，放在 `live2d/DeepSeek/DeepSeek/`；禁止再分发原始 PSD |
| Qwen3.5-0.8B 权重 | 运行 `latent/prepare_encoder.py`，按固定来源下载到 `models/`；当前不需要 4B |
| 多语言情感模型 | 运行 `python latent/prepare_emotion_action.py`；固定来源与 SHA-256 见 `latent/emotion-source.json` |
| 当前表演检查点 | 按 `latent/stream-run.json` 和模型包 `run.json` 准备；当前运行通道契约是 `latent/runtime-profile.json` |
| Qwen3-TTS 与 da_fei_yu 音色 | 在 `speech/config.json` 中设置 `repository`、`checkpoint`、`python`；推理加速源码位于 `vendor/faster-qwen3-tts/` |

需要 Windows 10/11、Node.js ≥ 22.12、Python 3.12+、WSL2 `Ubuntu-24.04`、WSL 内的 uv/Python 3.12、NVIDIA CUDA 与支持 WebGL 的浏览器。首次运行 `npm ci`。动作环境由启动器在 WSL 文件系统内管理。

在 WSL 中准备编码器：

```bash
cd /mnt/d/Workplace/auto-live2d
export UV_PROJECT_ENVIRONMENT=$HOME/.local/share/auto-live2d/latent-venv
uv run --project latent python latent/prepare_encoder.py
uv run --project latent python latent/prepare_emotion_action.py
```

服务默认只监听 `127.0.0.1`，运行时需要浏览器保持角色页面打开。训练数据、历史快照和大模型权重不随公开仓库分发；训练复现另见 `latent/README.md`。本地路径应按实际目录调整。

## 开发与验证

```powershell
npm run dev
npm test
npm run build
python -m unittest tests.test_default_launcher -v
# 表演和 TTS 服务已启动后，在独立端口验证生产页面：
npm run test:browser
npm run test:continuous
```

浏览器检查覆盖真实语音、角色渲染、单页开始/停止、音频暂停/恢复、导演指令、取消和移动端。当前记录在 `test-results/emotion-action-v1/`。历史冻结清单对应原源码，不能当作当前开发树的哈希验证结果。

## 许可

自研代码与实验产物采用 MIT，见 [LICENSE](LICENSE)。Cubism、Qwen、角色素材等第三方资源的来源与许可见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。
