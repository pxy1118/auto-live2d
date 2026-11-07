# 原生情绪动作模型

当前运行时 `v6.4.0-acting-feedback`，默认包 `experiments/vtuber-v6-acting-feedback-r3-final`。动作反馈、数据与训练见 [r3 记录](../docs/acting-feedback-training.md)。

- 分类器保留28个独立sigmoid输出，GPU FP32冻结；0.8B语义编码器GPU冻结。
- 事件头329687参数：语义1024 + affect64 + 纯动作历史26，输出17个动作ID（含none）、变体、强度/保持/句内位置。没有旧7情绪或12面部历史。
- 连续背景头622345参数：保留9通道，r1权重按原字节复用；不重新训练、不绑定动作目录的类别数。
- prefill只做因果情绪观测与每个分句的语义缓存；/stream/plan在实际播放时接收当前曲线和动作历史；/stream/predict复用同一分句缓存。

复现事件训练（需要冻结的反馈数据与原r2特征；拒绝覆盖已完成实验）：

```bash
uv run --project latent python latent/train_acting_feedback.py
```

13项GPU/情绪测试：

```bash
uv run --project latent python -m unittest latent.test_emotion_catalog latent.test_emotion
```

旧r1训练器与情绪动作只作快照保留在 `research/emotion-catalog-r1-archive/`，不是当前入口。新增动作只需注册和资源绑定；模型选择词表仍固定，加入模型自动选择需另行扩展训练，不能靠改JSON扩充输出层。

以下内容是 v3/v4 历史研究记录，仍可复现，但不属于 v6 默认链路。

## 历史研究：并行回归与 Flow

输入台词/语境/风格，经冻结 Qwen3.5-0.8B 语言骨干提取最后 16 个 token 的 1024 维特征。两个小型 Transformer 动作专家分别进行并行回归、8 步条件 flow matching 采样。当前输出 10 Hz、64 步的 16 轴轨迹、双手状态、17 类表情/外观概率、3 种体型和原始动画选择。分类头使用真实录制的开关时间监督，推理不按关键词查表。

这是 VLA 式“预训练表征 + 动作专家”的本地工程先导。当前没有视觉观测、动作 VAE、音频输入或机器人预训练动作权重；动作专家从本项目的数据学习。

## 环境

Python 3.12；依赖固定在 `pyproject.toml` 与 `uv.lock`。本机将虚拟环境放在 WSL 文件系统，避免 Windows 挂载盘的安装开销：

```bash
cd /mnt/d/Workplace/auto-live2d
export UV_PROJECT_ENVIRONMENT=$HOME/.local/share/auto-live2d/latent-venv
uv sync --project latent --locked
```

上述命令在 WSL `Ubuntu-24.04` 中执行。Windows 侧运行 `python main.py` 会自动完成这一步并前台管理全部服务；按 Ctrl+C 一并关闭，启动中途取消也会清理模型进程。编码器来自固定 revision，记录在 `encoder-source.json`。缺失权重时可运行 `uv run --project latent python latent/prepare_encoder.py`。

## 复现

实验目录拒绝覆盖，请为新实验指定新目录：

```bash
uv run --project latent python latent/train.py --output experiments/my-base --steps 2000 --loss balanced
uv run --project latent python latent/fit_appearance.py --base experiments/my-base --output experiments/my-config
uv run --project latent python latent/fit_motion.py --base experiments/my-config --output experiments/my-run
uv run --project latent python latent/evaluate_reviewed.py --experiment experiments/my-run --dataset datasets/vtuber-v3
uv run --project latent python latent/behavior_probe.py --experiment experiments/my-run --output experiments/my-run/behavior.json
uv run --project latent python -m unittest discover -s latent -p 'test_*.py'
```

`--loss original` 用于相同结构的原损失对照。回归头运行指定步数，Flow 头运行 1.5 倍步数；seed=41、batch=24、AdamW lr=8e-4。训练自动选 CUDA，缺失时退到 CPU。

默认数据由 `training-set.json` 指定，目前为 `datasets/vtuber-v3`。训练器默认仅选择通过审核的 train，不混入旧 pilot。缓存 `features-train.pt` 同时校验数据、编码器 revision 和样本 ID 顺序。联合训练后 `fit_appearance.py` 只在 train 上平衡采样体型类别，冻结其余权重；本次 200 步即达到训练配置全帧正确，非体型权重逐项一致。所有实验保存源码、profile、来源、数据指纹、权重哈希和加载校验。

最后 `fit_motion.py` 在 train 内提高前倾配置的采样率，继续训练连续解码器与输出层：并行 1000 步、Flow 1500 步；语义投影、时间查询和全部分类头冻结并逐项验证不变。此步骤解决了明确请求前倾时幅度过小的问题。早期失败对照保存在 archive 中，最终指标以当前实验的 split-evaluation.json 为准。

本轮相同步数对照为 `original-loss-control` 与 `activity-balanced`；较短的 `baseline` 保留最初失败结果。统一指标重算：

```bash
uv run --project latent python latent/compare.py --study experiments/latent-study
```

启动时加载 `default-run.json` 指向的实验，修改后需停止并重启动作服务。当前默认 `experiments/vtuber-v3`，页面默认并行头与活泼风格。旧 12 轴和无表情头的检查点仍可按原 profile 加载。

## 文件职责

| 文件 | 职责 |
| --- | --- |
| `common.py`、`profile.json`、`encoder-source.json` | 训练通道与固定来源契约 |
| `data.py` | 冻结源样本校验、10 Hz 重采样、初始状态和手势监督 |
| `encoder.py` | 仅一次前向的冻结语义特征，不调用文本生成 |
| `networks.py`、`train.py` | 动作专家结构、损失与训练 |
| `evaluate.py`、`plot_run.py`、`compare.py` | 延迟、逐样本曲线、统一训练拟合指标 |
| `runtime.py`、`trajectory.py` | 数值推理、显式限幅、手势切换编排、原生命令 |
| `serve.py`、`manage.py` | 本地推理端口 8768 与受管理进程启停 |

每个数据集和新实验各自保存 profile。根 `latent/profile.json` 仅作为旧 12 轴录制与检查点的兼容契约，其中 actions 不用于当前推理。新 profile 同时定义通道范围、可学习的原生表情名称和眼型互斥组。

## 当前边界

训练目标是自动眨眼叠加前的 `action_driver`，通过背景眨眼和原生物理得到最终参数；旧录制兼容回退到 driver。当前状态输入为 21 维（16 个驱动、5 个手势独热量），从默认动作状态开始。执行复位保留背景时钟，四项基础行为保持开启。尚未训练连续对话的动作衔接。

当前 200 段/配对来自程序编排和助手审核，未经过真人自然度评分。训练 176、验证 12、测试 12；留出集仍来自相同编排程序。监督保存 16 个连续通道；右眼睑和开口在普通动作中为中性，自动眨眼由底层执行，未学习音频口型。全部可见配置都有训练示例，但不能由覆盖推断任意语言都能正确调用，也不等于学会全部 509 参数。当前留出集没有正向手势或服装案例。

输出 64 个时刻为 0～6.3 秒，插值到 6.4 秒；手势或表情退出可能延长至 8 秒以内。手势最短连续 2 帧、相邻切换至少 1.3 秒；表情经短闪烁抑制和眼型互斥后调用原始 exp3，默认渐变 180 ms。若预测未关闭表情，结束时显式清理并计数。所有限幅、抑制、冲突消解与清理统计随预测返回。

脸红阈值 0.82、强度 0.4；黑脸阈值 0.7、强度 0.85；其他开关阈值 0.65；手势需达到 0.85 置信度。阈值为 profile 中预先指定的执行配置。完整“脱捕”选择达到 0.95 置信度时播放 13.8 秒原始曲线，并报告 `execution_mode=native_motion`，此时不执行连续生成轨迹。
