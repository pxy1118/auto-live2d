# 当前默认方案

运行 `python main.py`，打开 <http://127.0.0.1:8765/>。当前包为 `experiments/vtuber-v5-emotion-action-r1`，由 `latent/stream-run.json` 指定；运行时为 `v5.1.0-emotion-curves`。

## 页面与语音

输入文字后点击“开始说话”，或按 Ctrl / ⌘ + Enter。“停止”打断当前发言。首次点击启用浏览器声音，语境和表演风格默认折叠，角色可选全身或半身预览。

240 字以内的已知台词一次合成，逗号和句号不反复启动 TTS；动作按语义句执行，表情由短语观测驱动连续曲线。快速反应与慢速心境沿同一音频时钟变化，跨句保留情绪，暂停冻结。长文按预算分组，并在播放时预取下一组。增量文字等完整句结束或 finish 再提交，逗号不提交。详见 [连续情绪说明](emotion-curves.md)。

## 模型

- Horizon-Labs/multilingual-emotions-base：约 308M，GPU FP32，多标签情绪识别。
- 当前 Qwen3.5-0.8B 动作编码器、连续背景专家与复用的轻量动作头：GPU，负责动作语义、协调与时间。
- 原 Qwen3-TTS / da_fei_yu：CUDA Graph，音色不变。

4B 规划器及其语境身体分支已退出默认链路。两种较小模型保持职责独立；情绪分类结果通过已有条件输入对接动作网络。没有重训动作或音色；新方案尚未做新的自然度盲测。

“活泼”为默认，连续背景头身保留完整幅度，手势最短间隔 4 秒、独立身体 2.6 秒。语义动作门槛、单手协调和特殊眼型互斥继续生效；可选“自然”或“克制”。

## 准备与验证

```powershell
python latent/prepare_emotion_action.py
python latent/prepare_emotion_action.py --verify-only
```

模型来源与 SHA-256 位于 `latent/emotion-source.json`，动作权重来源位于默认包的 `run.json`。旧大模型文件仅作本地历史资源，不被当前服务加载。旧面板、旧 HTTP 接口与 `--legacy`、`--semantic` 回退不再提供。

停止使用 Ctrl+C，或 `python main.py --stop`。外部接入见 [会话 API](performance-v4.md)，模型边界与语音时序见 [架构说明](architecture.md)。同句前后对照与浏览器验证位于 `test-results/emotion-action-v1/`。
