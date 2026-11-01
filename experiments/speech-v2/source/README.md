# Auto Live2D

当前主线：**冻结 Qwen3.5-0.8B 提取语义特征，用小型动作专家直接预测连续控制轨迹，再驱动 Live2D。** 已完成真实训练和浏览器执行实验。

语音已接入训练好的 **Qwen3-TTS 1.7B / da_fei_yu**，默认使用 CUDA Graph 加速和流式播放。语音与动作并行准备，首段音频就绪即可开口；嘴部、身体轨迹和语音节奏使用同一个 AudioContext 时钟。点头与躯干小幅随动来自实际音频能量，手势和表情仍由语义模型决定。见 [语音接入说明](speech/README.md)。

语音响应、实际动作同步和工程验证见 [speech-v2 实测报告](experiments/speech-v2/REPORT.md)；旧 speech-v1 保持封存。

默认使用 VTuber v3 的并行预测头；Flow 头保留为对照。输入是角色将要说出的台词、语境与风格，输出为 **64×16 连续控制量、左右手状态、17 类表情/外观开关、3 种体型和原生动画选择**。呼吸、眨眼、待机、物理默认持续运行；动作不再压掉自动眨眼。头发、裙子和尾巴由原生物理随动。

当前数据集包含 **200 段审核过的程序动作、200 组台词配对**，训练 176、验证 12、测试 12，按动作族及完全相同的目标轨迹隔离。脸红仅占 9%，显式手势占 10%，并补充生气黑脸与全部可见配置的切换示例。审核包括实际渲染分镜与数值检查，审核者为助手，尚无真人自然度验收。见 [当前实验报告](experiments/vtuber-v3/REPORT.md) 与 [数据覆盖证据](datasets/vtuber-v3/review/coverage.json)。

## 启动

在 Windows 终端执行：

```powershell
cd D:\Workplace\auto-live2d
python main.py
```

打开 <http://127.0.0.1:8765/>，等待角色、动作专家和语音就绪。输入台词后点击 **说话并表演**，首次点击启用浏览器声音；也可以只用原有“预测并从初始姿态表演”预演动作。取消“同步身体动作”可仅播放声音与口型。每次动作复位保留背景时钟，呼吸、眨眼、待机与物理持续。页面链接可打开 [数据集回放与分镜](http://127.0.0.1:8765/dataset/vtuber-v3/review/index.html)。

启动器会依次构建网页、加载动作专家与 Qwen3-TTS，然后打开页面。保持这个终端运行，**按 Ctrl+C 关闭全部服务**。模型加载中途取消、某个服务异常退出时，也会清理本次启动的其他进程。重复启动或端口已被占用会报错，不会接管其他进程。

不自动打开浏览器：

```powershell
python main.py --no-browser
```

也可在另一个终端执行 `python main.py --stop` 或 `stop.ps1`。`start.cmd`、`start.ps1` 已改为同一个前台入口。

本机环境：Windows Python（启动器仅用标准库）、Node.js ≥22.12、WSL `Ubuntu-24.04`、WSL 内的 `uv` 与 Python 3.12。默认使用 CUDA；CPU 模式为 `python main.py --device cpu`，未测量 CPU 性能。启动时按锁文件同步依赖；已有编码器权重和动作检查点均从本地读取。日志、当前进程记录和最后一次退出结果在 `.runtime/`。

TTS 使用现有 `qwen3-tts` 训练环境，路径由 speech/config.json 指定；与动作专家的 uv 环境隔离。模型权重指纹在 speech/model-source.json。

浏览器承担实际 Cubism 运行与渲染，API 执行动作时需保持页面打开。同一服务只接纳一个角色执行页面。

## 目录

| 目录 | 唯一职责 |
| --- | --- |
| `src/`、`server/` | 完整角色控制、连续轨迹播放、网页与本地 API |
| `latent/` | 冻结语义编码、动作专家、训练、评估与推理服务 |
| `speech/` | 本地 Qwen3-TTS、音频驱动嘴部、独立环境与进程管理 |
| `datasets/` | [版本索引](datasets/README.md)；vtuber-v3 为当前默认，冻结旧版保留对照 |
| `experiments/` | vtuber-v3 为当前模型；v1/v2 与最初基线保留权重、报告和验证 |
| `docs/` | 架构、接口、原始模型审计 |
| `tests/`、`examples/` | 验证与最小外部控制示例 |
| `live2d/`、`vendor/`、`models/` | 原始角色、Cubism SDK 与固定版本 TTS 推理加速源码、0.8B 编码器权重 |
| `archive/` | 已停止的旧方案及中间预览，含源码、数据、日志和校验清单 |

`dist/`、`node_modules/`、`.runtime/`、`test-results/` 是构建、依赖或运行产物。

`main.py` 是统一启动器。Windows 侧管理网页进程和子进程树，WSL 侧管理模型进程组；控制管道关闭或收到取消信号时结束模型，避免启动脚本退出后仍占用显存。最近一次清理结果保存在 `.runtime/main-last.json`。

## 开发与复现

仅调试角色控制页面：`npm run dev`。这不会自动启动语义编码服务。

```powershell
npm test
npm run build
# 在角色服务已启动、且没有其他执行页面占用时：
npm run test:browser
npm run test:latent
npm run test:speech
npm run test:speech:stream
# 先关闭已有服务；该检查会实际启动/关闭模型，并发送真实 Ctrl+C：
python -m unittest discover -s tests -p test_launcher.py -v
```

训练与数据细节见 [训练说明](latent/README.md)、[数据说明](datasets/vtuber-v3/README.md)、[架构](docs/architecture.md)、[接口](docs/api.md)。完整控制接口覆盖 509 个参数、147 个部件、23 个表情、8 个动画和 131 组物理。学习模型覆盖可见表情/外观/体型/手势及原生动作，不逐项生成全部 509 参数。完整“脱捕”和手势的原始曲线由已有动画播放，其选择由模型预测。

旧 TF-IDF/MLP、Qwen JSON 控制、LoRA 工程测试及采集审核界面均已封存，当前入口不加载它们。恢复查阅见 [封存索引](archive/2026-10-31-exploration/README.md)。

角色资源未修改；公开展示按包内要求署名“原画：神宫凉子”。SDK 与编码器的来源和协议分别保留于 `vendor/cubism/SOURCE.json`、`latent/encoder-source.json` 及对应资源目录。

TTS 加速使用 [faster-qwen3-tts](https://github.com/andimarafioti/faster-qwen3-tts) 0.3.2（MIT），为兼容现有 Transformers 4.57.3 固定源码版本与 SHA-256，见 `vendor/faster-qwen3-tts/SOURCE.json`。训练权重和训练项目均未改写；当前语音节奏联动是推理时的音频驱动层，尚未训练音频到身体动作的联合模型。
