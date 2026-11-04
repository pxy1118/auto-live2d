# 当前版本与交付边界

2026-11-04：用户反馈新的生成式语义方案效果不好，已停止该方案并恢复原来的 **v4-default-r1**，启动命令为 `python main.py`，默认模型指针仍为 `latent/stream-run.json`。新方案的[说明](semantic-live2d.md)与[连续播放实验](../research/live2d-semantic-planner-v1/CONTINUOUS_SPEECH.md)保留为未采用的研究记录。当前共享控制运行时仍为 `v4.14.0-continuous-utterance`；下文保留此前 `v4.13.0-clause-plan` 收尾与冻结交付的历史记录，旧清单不代表更新后的源码校验结果。

当前日常版本为 **v4-default-r1**，模型包在 `experiments/vtuber-v4-default-r1`，控制运行时为 `v4.13.0-clause-plan`。唯一默认指针是 `latent/stream-run.json`。本次 2026-11-04 收尾整理代码、构建、说明与验证，没有训练新模型或启用新的动作实验。

默认组合为冻结 Qwen3.5-4B、表演规划器、语境与任务身体分支（`task_context_first`，种子 7137）、七组协调手势与六类身体动作，以及原 Qwen3-TTS 1.7B 音色。两个语义分支共享 GPU 编码器，旧连续背景专家在 CPU；角色按实际音频播放时钟执行。外观只接受显式设置，特殊眼型互斥。

日常操作、停止和回退见 [默认方案](v4-default.md)，导演与外观接口及 JSON Schema 见 [接口](performance-v4.md)。本轮未接入上层聊天 LLM。

## 已整理

- 默认源码与暂停的在线接管源码分开保存；历史动作、韵律、映射、待机等研究去向见 [研究索引](../research/README.md)。
- 主页面显示默认包名称，历史片段入口标注为研究；README 的启动流程与当前会话界面一致。
- `releases/v4-default-r1/manifest.json` 记录本次源码、网页构建、依赖锁和本地资源的 SHA-256。本机 `archive/v4-default-r1-20261104/source-and-web.zip` 保存源码与网页快照，未打包角色素材、SDK、模型权重、训练数据或运行日志。
- 验证记录见 `test-results/v4-finalization-20261104/`，结论见 `releases/v4-default-r1/REPORT.md`。旧报告保留原路径与内容。

```powershell
# 检查源码、构建和清单；--resources 另外读取并校验本地模型、音色、SDK 与角色素材
python scripts/v4/release_default.py verify
python scripts/v4/release_default.py verify --resources
```

快照用于在保留本机依赖资源时恢复；公开克隆仍需按 README 准备 SDK、角色和模型。恢复到另一目录时，应先核对 `speech/config.json` 的本地路径，再安装锁定依赖并启动，不直接覆盖研究目录。

## 保留的限制

这是用户选定的可用默认组合。原 24 组盲测为新版 11、v3 2、差不多 9、都不满意 2，未达到 16 组明确偏好门槛；本次没有新增或改写评分。自然度和语义选择仍可能有误，完整初始验收仍未全部完成。

此前十分钟、69 分句功能检查通过。历史同机测量动作更新 P95 为 42.2 ms；首音增加 168.3 ms，包含会话建立增加 212.7 ms，后者超过 200 ms 目标 12.7 ms，严格延迟门槛仍未通过。这些是默认切换时的测量，本次收尾不将短时启动检查当作新的性能基准。
