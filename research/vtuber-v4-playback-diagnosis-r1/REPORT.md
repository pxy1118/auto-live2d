# 卡顿反馈与播放诊断 · 2026-11-03

用户原话：“我觉得这个方案不行，动作都很卡顿”。v4 prosody r1 整体判为未通过；此反馈是整体否决，不伪造成 24 项盲测分数。原模型默认、权重、原人工评分均保持。

## 复现

旧页面播放约 7.5 秒，三路视频合计触发 90 次 seeking，其中播放开始 1 秒后的 currentTime 写入 78 次。三路实际呈现间隔 P95 均约 183.6 ms，最大间隔约 266.8 ms。视频本身为 20 fps，单帧源时间步长为 50 ms。getVideoPlaybackQuality 的 droppedVideoFrames 仍可为 0，因此只看丢帧计数和播放时钟相等会漏掉这个问题。

根因是为追赶单独音轨，timeupdate 回调反复给三路视频设置 currentTime。每次跳转都会打断连续解码，下一次音频回调仍可能看到时间差而再次跳转。之前只测了启动后某个时刻的同步误差，没有检查完整播放中的 seek 次数和画面呈现间隔，验收不充分。

## 修复与受控对照

播放器改为单路视频，使用其自身封装的音轨作为时钟。currentTime 只在用户主动拖动进度或从头播放时改变，播放中没有自动追赶。保留同一轨迹的 20 fps 原视频，并从原始 60 Hz 参数记录重新逐帧渲染真实 60 fps 视频，没有插帧。

补录挥手、撒娇、已否决节奏原型三段，共 2,298 帧。与原 60 Hz Cubism 参数回读逐值比较，最大差异均为 0；20/60 fps 视频解码得到的音频 PCM 完全相同。第三段保留失败原型供诊断，不表示其动作质量获得认可。

| 播放方式 | 播放中自动时间写入 | 实际呈现间隔 P95 | 超过 100 ms 的间隔 |
|---|---:|---:|---:|
| 原三路同步 / 20 fps | 78 次（三路合计） | 约 183.6 ms | 32–35 次/路 |
| 单路 / 同一 20 fps 原视频 | 0 | 66.7 ms | 0 |
| 单路 / 真实 60 fps | 0 | 33.3 ms | 0 |

以上是同机系统 Chrome 156 的无头浏览器实测，忽略首秒启动段，约 6.5 秒稳态观察。没有直接测量用户内嵌浏览器，也不代表所有设备或长期负载表现。新增回归检查实际帧回调、自动 seek 次数、暂停、手动 seek、帧率/片段切换和页面布局；检查通过。

## 动作方案状态

播放修复解决了一项已复现的共同卡顿来源，不能据此把原节奏方案改判通过。原型还存在需单独检查的动作时序问题：重音叠加脉冲采用截断正弦，其起止导数不连续；音频能量变化也在改变整段动作时钟。后续动作研究先以正常速度的原动作库和稳定 60 fps 呈现为参考，再分别验证动作阶段、保持与收势，不把这轮失败轨迹当作自然动作真值。当前没有重训、增加动作幅度或推广失败原型。

## 保留与复现

原 r1 的 6,171 个文件哈希保持，仅当前公开入口 prosody-study.html 被有意替换。旧页面原字节保存在 prosody-playback-before.html，并与旧 provenance 中的哈希一致；旧源码、参数、视频、实验报告和评分保持。当前维护页面源为 research/vtuber-v4-playback-diagnosis-r1/review.html。旧 r1 发布脚本属于历史实验复现流程；当前页面由 publish_playback_check.py 发布。

```powershell
npx tsx scripts/v4/diagnose_prosody_playback.ts
npx tsx scripts/v4/recapture_playback_check.ts
python -X utf8 scripts/v4/publish_playback_check.py
npx tsx scripts/v4/diagnose_prosody_playback.ts --after
npx tsx tests/playback-check.ts
python -X utf8 scripts/v4/finalize_playback_check.py
```

补录使用独立 8775 开发服务器及只读原始参数；不注册控制 WebSocket，不接管默认角色。原 4B/TTS 服务在本轮保持运行。
