# Auto Live2D

新增 **v4 自动组合表演候选**：冻结 Qwen 语义骨干，学习选择手势、身体动作、表情、变体、强度和保持时间，按实际语音时钟执行。支持撒娇、前倾、轻摇等身体与单手手势组合，并保留显式导演和持久外观接口。现有动作展示为 14 组、42 段，另提供 24 组同语音、同帧率的新旧盲测。见 [接口说明](docs/performance-v4.md) 和 [训练与验证报告](experiments/vtuber-v4-composition-r1/REPORT.md)。模型仍有漏选与误选，v3 默认入口及原 16 组表情评分保留。

用冻结的语义模型驱动 Live2D 角色：**冻结 Qwen3.5-0.8B 提取台词/语境的语义特征，小型动作专家直接预测连续控制轨迹，再由浏览器的 Cubism 运行时渲染**；语音侧接入本地 Qwen3-TTS 做流式合成，并让嘴部、身体轨迹与语音节奏共用同一个媒体时钟。

![角色控制页面](docs/media/demo-desktop.png)

> 截图中的角色为免费练习模型“大肥鱼”，**原画：神宫凉子**；本仓库不包含该角色素材与 PSD。

## 项目内容

- 输入是角色将要说出的台词、语境与风格；输出为 **64×16 连续控制量（10 Hz × 64 步）、左右手状态、17 类表情/外观开关、3 种体型和原生动画选择**。
- 语义特征来自固定 revision 的 Qwen3.5-0.8B：只做一次前向，不做文本生成；两个小型 Transformer 分别做并行回归与 8 步条件 flow matching 采样。
- 呼吸、眨眼、待机与物理持续运行，动作不再压掉自动眨眼；头发、裙子和尾巴由原生物理随动。
- 语音使用 Qwen3-TTS 1.7B（da_fei_yu 音色）与 CUDA Graph 加速；首段音频就绪即可开口，取消“同步身体动作”可只播声音与口型。
- Windows 前台启动器统一管理网页、动作专家与 TTS；按 Ctrl+C 清理全部 Windows/WSL 进程。

语音响应、实际动作同步和工程验证见 [speech-v2 实测报告](experiments/speech-v2/REPORT.md)；旧 speech-v1 保持封存。

## 仓库内容（先读这一段）

本仓库**只包含自研代码、文档、测试与实验产物**。以下内容因体积或授权原因未包含，需要本地准备：

| 未包含内容 | 体积 | 获取方式 |
| --- | --- | --- |
| `vendor/cubism/` | ~1.2 MB | Live2D Cubism SDK for Web 5 R4 官方压缩包 <https://cubism.live2d.com/sdk-web/bin/CubismSdkForWeb-5-r.4.zip>，解压出 `Core/`、`Framework/`、`LICENSE.md` 放到 `vendor/cubism/`。该压缩包 SHA-256 见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) |
| `live2d/` | ~186 MB | “大肥鱼”免费练习模型（**原画：神宫凉子**）。请从原作者处获取，放到 `live2d/DeepSeek/DeepSeek/` 并保持 `大肥鱼.model3.json` 等文件名。使用规范禁止再分发原始 PSD |
| `models/Qwen3.5-0.8B/` | ~1.7 GB | 运行 `uv run --project latent python latent/prepare_encoder.py`，按 `latent/encoder-source.json` 的 revision 从 Hugging Face 下载（Apache-2.0） |
| `datasets/` | ~3 GB | 程序编排、在真实 Cubism 运行时录制的训练/审核数据；训练与评估复现需要自备，数据格式见 `latent/README.md` |
| `archive/` | ~5.3 GB | 2026-10-31 的历史封存快照（旧方案源码、数据、日志、模型权重） |
| Qwen3-TTS 项目与 da_fei_yu 检查点 | 数 GB | 独立项目与训练产物；把 `speech/config.json` 的 `repository` / `checkpoint` / `python` 改成你的路径 |

因此克隆后**不能**直接 `python main.py` 跑通，请先完成下文的本地资源准备。

## 环境要求

- Windows 10/11 x64；启动器与测试只用 Python 标准库（本机用 Python 3.14 验证，3.12+ 即可）
- Node.js ≥ 22.12 与 npm
- WSL2 `Ubuntu-24.04`，内含 `uv` 与 Python 3.12（动作专家环境在 WSL 文件系统中创建）
- NVIDIA GPU + CUDA；默认 `--device cuda`，`--device cpu` 可运行但未测量性能
- 支持 WebGL2 的现代浏览器；Cubism 运行与渲染在浏览器侧，执行动作时需保持页面打开

## 准备本地资源

1. **Cubism SDK**：下载上面的官方压缩包，把 `Core/`、`Framework/` 与 `LICENSE.md` 放到 `vendor/cubism/`。运行时只使用同一官方包里的 Core 与 Framework（Core 为 Live2D 专有许可，请自行确认协议）。
2. **编码器权重**：在 WSL 的 `Ubuntu-24.04` 中执行
   ```bash
   cd /mnt/<drive>/<path-to-repo>
   export UV_PROJECT_ENVIRONMENT=$HOME/.local/share/auto-live2d/latent-venv
   uv run --project latent python latent/prepare_encoder.py
   ```
   脚本会按 `latent/encoder-source.json` 校验/下载 `models/Qwen3.5-0.8B/`。
3. **角色素材**：从原作者处获取“大肥鱼”模型，放到 `live2d/DeepSeek/DeepSeek/`。模型与 PSD 不随仓库分发，公开发布衍生内容时须署名“原画：神宫凉子”。
4. **Qwen3-TTS**：准备 Qwen3-TTS 项目与 da_fei_yu 检查点，并把 `speech/config.json` 的 `repository`、`checkpoint`、`python` 改成你的本机路径；权重与推理源码哈希由 `speech/model-source.json`、`vendor/faster-qwen3-tts/SOURCE.json` 校验。
5. **前端依赖**：`npm ci`（首次启动时启动器也会自动执行）。

## 启动与停止

在 Windows 终端执行：

```powershell
python main.py
```

启动器会依次构建网页、加载动作专家与 Qwen3-TTS，然后打开 <http://127.0.0.1:8765/>。输入台词后点击 **说话并表演**，首次点击启用浏览器声音；也可以只用“预测并从初始姿态表演”预演动作。取消“同步身体动作”可仅播放声音与口型。每次动作复位保留背景时钟，呼吸、眨眼、待机与物理持续。页面链接可打开数据集回放与分镜（需要本地 `datasets/`）。

保持这个终端运行，**按 Ctrl+C 关闭全部服务**。模型加载中途取消、某个服务异常退出时，也会清理本次启动的其他进程。重复启动或端口已被占用会报错，不会接管其他进程。

WSL 宿主启动时会把控制台输入切到原始模式（关闭 `ENABLE_PROCESSED_INPUT`），此时真实终端里的 Ctrl+C 只会变成一个普通字节，启动器收不到取消信号。启动器在运行期间会把该模式重新打开，并额外监听这个 `0x03` 字节作为兜底；退出时恢复原控制台模式。若某个终端仍吞掉 Ctrl+C，可在另一个终端执行 `python main.py --stop`；Zed 等终端在存在选区时会把 Ctrl+C 用于复制，先单击终端清除选区再按。

不自动打开浏览器：`python main.py --no-browser`。也可在另一个终端执行 `python main.py --stop` 或 `stop.ps1`；`start.cmd`、`start.ps1` 是同一个前台入口。

日志、当前进程记录和最后一次退出结果在 `.runtime/`。所有服务默认只监听 `127.0.0.1`，不对外暴露网络端口。

## 目录

| 目录 | 职责 |
| --- | --- |
| `src/`、`server/` | 角色控制、连续轨迹播放、网页与本地 API（8765） |
| `latent/` | 冻结语义编码、动作专家、训练、评估与推理服务（8768） |
| `speech/` | Qwen3-TTS 推理、音频驱动嘴部、独立环境与进程管理（8769） |
| `experiments/` | vtuber-v3 为当前模型；v1/v2 与最初基线保留权重、报告和验证 |
| `docs/` | 架构、接口、原始模型审计与 README 截图 |
| `tests/`、`examples/` | 验证与最小外部控制示例 |
| `vendor/faster-qwen3-tts/` | 固定版本 TTS 推理加速源码（MIT） |
| `live2d/`、`vendor/cubism/`、`models/` | 未包含，见上文“仓库内容” |
| `datasets/`、`archive/` | 未包含，见上文“仓库内容” |

`dist/`、`node_modules/`、`.runtime/`、`test-results/` 是构建、依赖或运行产物，已在 `.gitignore` 中排除。

`main.py` 是统一启动器：Windows 侧管理网页进程和子进程树（Job Object），WSL 侧用独立进程组管理动作专家与 TTS；控制管道关闭或收到取消信号时结束模型，避免启动脚本退出后仍占用显存。最近一次清理结果保存在 `.runtime/main-last.json`。架构与接口细节见 [架构](docs/architecture.md)、[接口](docs/api.md)。

## 开发与复现

仅调试角色控制页面：`npm run dev`（不会自动启动语义编码服务）。

```powershell
npm test
npm run build
# 在角色服务已启动、且没有其他执行页面占用时：
npm run test:browser
npm run test:latent
npm run test:speech
npm run test:speech:stream
# 先关闭已有服务；该检查会实际启动/关闭模型，发送控制事件，并核对启动器在
# WSL 宿主把控制台切到原始模式后仍恢复 Ctrl+C 处理：
python -m unittest discover -s tests -p test_launcher.py -v
```

训练细节与环境见 [训练说明](latent/README.md)；动作数据集由程序编排、在真实 Cubism 运行时录制，训练 176 / 验证 12 / 测试 12，按动作族及完全相同的目标轨迹隔离。完整控制接口覆盖 509 个参数、147 个部件、23 个表情、8 个动画和 131 组物理；学习模型覆盖可见表情/外观/体型/手势及原生动作，不逐项生成全部 509 参数。

旧 TF-IDF/MLP、Qwen JSON 控制、LoRA 工程测试及采集审核界面已封存到本地 `archive/`，当前入口不加载它们。

## 许可与第三方

- 本项目自研代码与实验产物以 **MIT** 许可发布，见 [LICENSE](LICENSE)。
- 第三方内容（Live2D Cubism SDK、Qwen3.5-0.8B、Qwen3-TTS、faster-qwen3-tts、数据集与角色素材）的归属、许可与获取方式见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。
- 角色素材：“大肥鱼”，原画：神宫凉子。仓库内截图仅用于展示本项目的运行效果。
