# v4 默认会话表演

当前默认包为 `experiments/vtuber-v4-default-r1`，依据用户明确请求“我觉得已经可以了，加入默认方案吧”启用。历史研究分数、失败记录和原人工评分保持；这次产品默认选择不回写以前的自动质量门槛。

```powershell
python main.py
```

启动器自动读取 `latent/stream-run.json` 中的已启用方案，打开主页面的会话表演区域。支持逐步追加文字、整段输入、显式情绪/动作导演和持久外观设置。默认使用协调动作组；自由连续手臂与 Flow 保留研究入口。

构成：

- 冻结 Qwen3.5-4B 与已选词元注意力规划器负责手势、情绪、眼型及时间安排。
- 最新语境＋任务说明身体分支负责身体类型、必要性与独立强度；以三个种子的**校准目标中位数**选取 7137，没有使用最终测试选择。
- 两个规划分支共享一份 4B 骨干；默认 CUDA 下，旧 0.8B/连续背景专家在 CPU，4B 与原 TTS 在 GPU。
- 连续执行与物理沿用现有运行时。特殊眼型互斥 0/1，外观仍只由显式接口修改。
- 超长语境按词元预算保留当前完整台词、事实前缀及最近对话，省略中段旧信息；调试指标明确记录是否发生裁剪。超出单句预算的输入报错，不截断正在说的台词。

## 回退

以下命令仅切换本次启动，不改默认指针：

```powershell
python main.py --stop
python main.py --legacy
```

它使用 v3 底层预测与原 `experiments/vtuber-v4-composition-r2` 流式方案。再次普通启动即可返回新默认：

```powershell
python main.py --stop
python main.py
```

原来两份模型配置及修改前源码已备份到 `.runtime/v4-default-change/backup`。`latent/default-run.json` 的 v3 路径继续供底层兼容接口使用；用户默认会话入口由已启用的 `latent/stream-run.json` 决定。

## 检查与记录

`performance.status`、`capabilities.get` 会报告启用状态。动作服务的 `/stream/status` 另报告实际设备与身体分支是否共享编码器。部署检查与实际语音测量保存在 `test-results/v4-default`；默认包的选择来源和用户接受记录分别在 `selection.json`、`run.json`。

工程检查不等于新的自然度盲测。模型仍可能误选或漏选；继续保留原生曲线和导演覆盖，便于在使用中调整。
