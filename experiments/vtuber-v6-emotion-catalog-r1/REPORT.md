# v6 emotion-catalog r1

schema: `vtuber.v6.emotion_catalog` · runtime: `v6.0.0-emotion-catalog` · **promoted: false**

数据全部来自冻结的合成/作者监督（`datasets/vtuber-v4`、`datasets/vtuber-v4-planner-v2`、`datasets/emotion-catalog-v1`），没有新增任何真人标注；segment 监督为合成正/负例。

## Gate

| 指标 | 本实验 | v5 基线 | 允许 | 结果 |
| --- | --- | --- | --- | --- |
| 连续 9 通道 MAE（归一化） | 0.02325 | 0.03694 | ≤ v5×1.1 (0.04063) | PASS |
| 旧动作 macro-F1（8 类） | 0.8629 | 0.8300 | 掉点 ≤2pp | PASS（+3.30pp） |
| 误触发率（target none） | 0.0505 | 0.0627 | ≤ +1pp | PASS（-1.22pp） |

**gate 结论：全部通过（仍不 promote，由 Lead 决定默认指针）**

## 连续分支（v4 test 划分，24 帧 × 9 背景通道，归一化 MAE）

| 通道 | 本实验 | v5 |
| --- | --- | --- |
| AngleX | 0.03727 | 0.05536 |
| AngleY | 0.02627 | 0.03599 |
| AngleZ | 0.04315 | 0.05537 |
| PositionX | 0.02741 | 0.03682 |
| PositionY | 0.02040 | 0.03200 |
| PositionZ | 0.03492 | 0.04689 |
| LeanInput | 0.01125 | 0.03438 |
| ParamEyeBallX | 0.00537 | 0.02226 |
| ParamEyeBallY | 0.00325 | 0.01336 |

参数量：continuous 622,345；event 338,933

## 事件分支（planner-v2 test 划分）

| 指标 | 本实验 | v5 planner |
| --- | --- | --- |
| 旧动作 macro-F1（8 类，segment 预测映射 none） | 0.8629 | 0.8300 |
| 误触发率 | 0.0505 | 0.0627 |
| body macro-F1（7 类） | 0.5950 | — |
| 5 维 values MAE | 0.0387 | — |
| segment 合成监督 test 准确率 | 0.4324（正例召回 0.300 / 负例特异度 0.588） | — |

arm 阈值 0.0（validation 上按误触发约束选择）。

## 与 v5 的差异 / 未达成项

- 三项 gate 均通过；仍未 promote，默认指针由 Lead 决定。
- segment 合成监督的正例召回偏低（test 0.30），segment 行为属于低置信候选；运行时由浏览器按 `confidence.action` 与动作策略决定是否采用。

## 训练摘要

- continuous: 4000 步，选中 3750 步，33.4s；最后 validation MAE 0.02484
- event: 3000 步，选中 2900 步，6.7s；最后 validation 0.7605（macro-F1）

## 已知偏差 / 说明

- event 的 `action_strength` 在旧 planner 记录中没有标签，训练时用 `body_strength` 作为代理；segment 记录用 evidence 映射。
- 训练条件（affect64）来自 Python 侧 60Hz 子步仿真；浏览器侧 EmotionCurve 的整秒 parity fixture 已写入 `tests/fixtures/emotion-curve-v2.json`。
- v5 planner 的旧动作指标由本实验在相同 planner-v2 test 记录上重算（冻结权重），非其原 run.json 的数字。

## 验证（训练后）

- `python -m unittest latent.test_emotion -v`：9 项通过（真实 308M 分类器 + 28 分数、引用剔除、窗口、结构、空文本、非法输入）。
- `python -m unittest latent.test_emotion_catalog -v`：6 项通过（prefill timeline v2 + plan v2 契约、predict 只返回 9 背景通道、非法输入；检查点缺失时 skip）。
- 真实策略冒烟（不起 HTTP）：prefill 首句 446.6 ms（首包含 0.8B 预热；分类 2 窗口 19.0 ms，0.8B 325.3 ms），timeline v2 2 点 28 标签；predict 18.0 ms，24×9 通道，`raw_out_of_range_fraction=0`。
- HTTP serve 冒烟（`:8799`）：`/health` 与 `/stream/status` `ready=true, driver=emotion_catalog, runtime_version=v6.0.0-emotion-catalog`，`/stream/prefill` 返回 2 条 plan v2（action 均为 catalog arm 类、body_overlay 合法），`/stream/predict` 15.4 ms 返回 24×9。摘要见 `smoke.json`、`serve-smoke.json`。
- 曲线 parity：`tests/fixtures/emotion-curve-v2.json`（3 case × 20Hz response/mood，含整秒网格点）与 TS `simulateEmotionCurve` 按同一 50ms 切分网格对齐后最大差约 5e-7。

## 选择与分布说明

- event 分支的 checkpoint/步数只按 validation 指标选择，test 只做最终一次评估。validation 与 test 的误触发率差异较大（本实验 0.9% → 5.0%，v5 基线 3.6% → 6.3%），属于 planner-v2 两个划分的来源分布差，报告以 test 为准。
- 另测过“segment 过采样（每批 +32 条）/ arm 权重上限 16”的变体：其 validation 旧动作 macro-F1 0.751 低于本基线 0.779（选择只使用 validation），故未采用；本实验保持统一采样。
