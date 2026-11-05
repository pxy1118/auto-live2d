# 研究索引

2026-11-04 最新默认权重为 `vtuber-v5-emotion-action-r1`，运行时 `v5.1.0-emotion-curves`：GPU 情感分类＋连续情绪层＋0.8B 动作，4B 分支不再加载。以下默认描述保留为历史研究来源，当前入口见主 README 与 `docs/emotion-curves.md`。

2026-11-04：标准入口已简化为当前会话表演，`--legacy`、`--semantic` 与旧 HTTP 兼容接口已移除。以下涉及旧入口的命令是历史记录，不代表当前启动方式。

日常入口只有 `python main.py`，加载 `experiments/vtuber-v4-default-r1`。目录的存在不表示已经启用；默认指针见 `latent/stream-run.json`，交付状态见 [当前版本](../docs/project-status.md)。以下历史目录和评分保留原路径，便于复查来源。

| 研究 | 去向 | 证据入口 |
| --- | --- | --- |
| 协调动作、单手关节与身体组合 | 默认版使用七组手势、六类身体动作；双臂庆祝已停用 | `experiments/vtuber-v4-default-r1/run.json`、`src/gesture-library.ts`、`src/body-motion.ts` |
| 泛化与意图研究 | 选定的 4B 词元注意力规划器已合入；其余候选保留 | `experiments/vtuber-v4-generalization-r1/REPORT.md`、`research/vtuber-v4-intent-study/` |
| 语境与任务身体研究 | `task_context_first`、种子 7137 身体分支已合入，共享 4B 编码器 | `research/vtuber-v4-context-study/REPORT.md`、`experiments/vtuber-v4-default-r1/selection.json` |
| 韵律调速 | 用户认为卡顿，未合入 | `research/vtuber-v4-prosody-study/` |
| 播放诊断 | 保留播放器与录制诊断记录，不代表韵律方案被接受 | `research/vtuber-v4-playback-diagnosis-r1/` |
| VTube Studio 参数映射 | 离线候选，未通过人工接受，未合入 | `research/vtuber-v4-mapping-r1/` |
| 在线动作接管 | 已暂停；四份未验证源码保存在 `candidate/`，默认源码已恢复到 `baseline/` | [暂停说明](vtuber-v4-online-coupling-r1/README.md) |
| 待机灵动性 | 离线原型，尚未验证完整在线接入及人工自然度，未合入 | `research/vtuber-v4-liveliness-r1/` |
| WHALEL2D、my-neuro | 固定提交的只读源码审计，没有安装或合并对方运行时 | `research/whalel2d-audit-20261103/`、`research/my-neuro-audit-20261103/` |
| 本次收尾 | 确认默认边界、构建与启动，保存源码和网页快照 | `research/vtuber-v4-finalization-20261104/`、`releases/v4-default-r1/` |

兼容入口仍使用 `experiments/vtuber-v3`；`python main.py --legacy` 同时使用原 `vtuber-v4-composition-r2` 流式方案。无需移动或重命名实验目录。

原 16 组风格选择与 24 组比较结果保持原样，不将实验模拟结果记成人工评价。旧质量门槛未全部通过；默认启用依据用户后续明确认可。
