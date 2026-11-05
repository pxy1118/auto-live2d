# 情感分类与动作模型默认包

用户明确要求移除 4B 并接入情感分类。当前运行时使用固定的 Horizon-Labs/multilingual-emotions-base、已有 Qwen3.5-0.8B 动作编码器、连续背景回归专家与轻量动作头。检查点来源、SHA-256 与角色通道契约见 `run.json`。

默认三个模型均使用 GPU，情感分类器保留 FP32 精度；服务跟随统一的 `--device`，不单独固定到 CPU。

当前软件运行时为 `v5.1.0-emotion-curves`，短语观测由连续反应/心境层承接，表情与动作共用混合权重；此变更不重新训练或替换本包检查点。见 `docs/emotion-curves.md`。

连续专家来自 `vtuber-v4-default-r1`；轻量动作头来自 `vtuber-v4-composition-r2`，只复用训练权重，不恢复旧运行入口。情绪输出由新分类器替换，并通过已有条件输入对接动作网络。没有新增动作训练、真人示范或自然度评分。

`python latent/prepare_emotion_action.py` 下载情感模型并复用本地来源检查点；缺失来源权重时明确报错。默认指针只指向本目录，不回退加载 4B。

语音与动作分段已解耦：已知短段只合成一次，多个语义计划按同一音频时钟执行；长文预取下一组。实现与验证边界见 `docs/architecture.md` 与 `test-results/emotion-action-v1/`。
