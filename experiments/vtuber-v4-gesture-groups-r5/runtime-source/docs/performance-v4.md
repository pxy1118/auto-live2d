# 流式会话表演 v4

当前候选改用**语义模型选择完整动作组**。动作组统一编排躯干、头部、手臂、手腕和绘制模式，表情与真实语音口型独立。此调整来自用户对生硬、幅度不足和全部侧抬动作的反馈，以及允许预设动作组的明确要求。连续动作专家保留研究入口，不再作为默认手臂执行方式。

`latent/stream-run.json` 指向 `experiments/vtuber-v4-gesture-groups-r5`，运行时为 v4.10-body-composition。这是尚未通过主观验收的 v4 候选，原有“说话并表演”继续使用 v3；`latent/default-run.json` 未变。当前改动与限制见 [实验报告](../experiments/vtuber-v4-gesture-groups-r5/REPORT.md)。本轮没有接入实际聊天 LLM。

## 会话调用

保持角色页面打开，先启用声音。HTTP 为 `POST /api/command`；WebSocket 为 `/ws` 的 command 消息，均使用 `{method, params, request_id}`。[工具 JSON Schema](performance-tools.json) 可供未来上层 LLM 包装器使用。

```json
{"method":"performance.start","params":{"context":"和观众日常聊天","kind":"regression","motion_backend":"groups","motion_style":"restrained"},"request_id":"start-1"}
{"method":"performance.append","params":{"session_id":"返回的32位ID","seq":0,"text":"大家好呀。"},"request_id":"append-0"}
{"method":"performance.finish","params":{"session_id":"返回的32位ID","seq":1,"text":"我们接着聊吧。"},"request_id":"finish-1"}
```

`seq` 从 0 严格递增。句号、问号、感叹号、分号、逗号及换行提交分句，`flush:true` 可显式提交，`finish` 提交余文。每次最多追加 2000 字，队列最多 12000 字，超过 240 字自动分段。整句入口及原 `/api/speech/perform` 保留。

重试复用同一 request_id；不同内容复用 ID 报错。最近 512 个请求返回原响应，更旧 ID 及运行页重连前的 ID 返回 request_id_expired，标记保留至 Node 重启。取消后迟到的文字、TTS 和动作结果不能恢复播放。

完整客户端：`python examples/performance_demo.py --text "大家好。我们接着聊吧。"`。默认不会改变外观；可额外传 `--gesture chest`、`--glasses black`。

## 完整动作组

| gesture | 内容 | 来源 |
| --- | --- | --- |
| wave | 原生点题位置的屈肘张掌挥手 | 原生肩肘曲线，双挥/点头后短挥/停留后慢挥 |
| chest | 身前抚胸 | 原生手臂曲线与躯干配合 |
| grass | 身前狗尾草展示 | 原生进入/退出与原动画腕部片段 |
| point | 抬起食指指出重点 | 原生手型与手臂曲线 |
| thanks | 抚胸并轻点头致谢 | 原生抚胸与新躯干配合 |
| explain | 身前说明，略转头、倾身 | 原生抚胸与新躯干配合 |
| refuse | 抬指摇头、张掌暂停或抬指退身 | 原生食指与新编排 |
| rest | 释放当前动作并暂时抑制自动手势 | 执行层指令 |

每组有 3 种结构不同的编排，通过主手节奏、前倾/回身、移重心、头部先动与躯干跟随等变化区分。未指定 variant 时轮换，指定时取 0/1/2。7 组手势共 21 段；加上 5 组独立身体动作和 1 组自由组合示例，展示页共 13 组、39 段。真实 Cubism 60 Hz 执行、30 fps 视频，包含进入、停留、收回。这里通过工具直接调用编排，不把预设关节曲线标成神经模型生成。

庆祝动作已按用户要求移除：页面、能力清单与工具 Schema 不再提供 cheer；旧选择器仍保留历史检查点的 9 维输出，若胜出类别是已移除的 cheer，直接转为 none、动作置信度和门控归零，不重新归一化以提升其他动作。浏览器对迟到的旧 cheer 预测也做同样处理。

问候保留原生“指出重点”的肩、肘及透视参数进入/保持/退出曲线，关闭食指绘制并张掌，仅在手腕叠加小幅挥动。当前七组的全部变体均只有一只主动手臂，移除抚胸/致谢的附加抬手以及点题/说明的另一侧配合。另一只手自然垂放，动作差异由主手节奏、头部和躯干表现。切换先完成当前动作退出，再进入下一组，避免左右手交接时同时举起。能力清单提供 arm_policy 与 variant_active_arms，状态中提供 active_arm。

## 可组合的身体动作

| body_motion | 三种编排 |
| --- | --- |
| lean | 前倾靠近、前倾后退回重心、歪头后探身 |
| sway | 左右递减轻摇、移重心停留再回摆、轻摇后靠近 |
| nod | 单次点头、两次轻重点头、抬下巴后确认 |
| tilt | 歪头后侧倾、反向歪头后前倾、左右端详回正 |
| turn | 先侧首再带动躯干、侧首停留转回、扫视两侧 |
| rest | 只收回附加身体动作，手势继续 |

身体层独立于手势，可单独调用 `performance.direct({body_motion:"lean"})`，也可与 `gesture` 放在同一指令。动作进行中单独追加身体指令不会重启或释放手势。只操作 7 个头身输入，不写入手臂、表情、口型、外观或物理输出。身体偏移叠加到当前手势/连续专家，最终按角色有效范围限制；替换以 300 ms 匹配位置和速度，提前释放以 600 ms 平滑回到当前基础表演。

`body_variant` 为 0/1/2，省略时轮换；`body_strength` 为 0～1，默认 0.75，与表情强度 `intensity` 分开；`body_hold_ms` 为 0～15000，默认 2200 ms，进入与退出各 700 ms。点头和摇晃是一段有限表演，长时间停留不会机械循环。头部与躯干采用不同的相位和峰值，原有手势也直接复用这些身体编排。

页面“身体与手势组合”可选择“不换手势，只播身体”。展示页的“只看身体与头部”筛选含 15 段双臂自然垂放的表演。当前语义选择器仍只学习历史的手势标签；独立身体动作由导演接口或页面调用，尚未重新训练单独选择这 5 类动作。

冻结 Qwen 语义特征经过轻量学习选择器产生 `gesture_intent` 与置信度。阈值仅决定是否调用动作组，不表示表情强度。运行时没有关键词到动作的检索规则。自动手势每分句最多一次，克制风格下至少间隔 6 秒；日常小幅头部/躯干及表情仍由连续专家产生。这个选择器目前只有合成语义标注监督，可能漏选或误选；上层可明确指定动作。

`motion_backend:"groups"` 是 v4 默认；`"continuous"` 是未通过手部质量检查的研究路径。Flow 保留权重和失败记录，当前页面禁用其在线候选，不能凭其离线误差切换默认。

## 导演与外观

```json
{"method":"performance.direct","params":{"gesture":"chest","gesture_hold_ms":1400,"variant":0,"cue_id":"body-1"},"request_id":"chest-1"}
{"method":"performance.direct","params":{"clause":1,"gesture":"grass","gesture_hold_ms":2400,"variant":1},"request_id":"grass-at-clause-1"}
{"method":"performance.direct","params":{"gesture":"point","variant":0,"body_motion":"lean","body_variant":2,"body_strength":0.6,"body_hold_ms":2200,"cue_id":"point-lean"},"request_id":"combo-1"}
{"method":"performance.direct","params":{"body_motion":"sway","body_variant":1,"body_strength":0.75,"cue_id":"body-only"},"request_id":"body-1"}
{"method":"performance.direct","params":{"emotion":"angry","intensity":0.85,"hold_ms":4000,"cue_id":"anger"},"request_id":"angry-1"}
{"method":"performance.direct","params":{"expression":"><","intensity":0.7,"hold_ms":2500},"request_id":"eyes-1"}
{"method":"performance.release","params":{"cue_id":"body-1"},"request_id":"release-1"}
{"method":"appearance.update","params":{"glasses":"black","skirt":"short","shoes":true},"request_id":"appearance-1"}
```

不带 clause 立即生效，带 clause 绑定从 0 开始的指定分句，从实际开口触发。可将动作、情绪、表情放在同一指令中。`gesture_hold_ms` 为进入动作后保持多久，0～15000 ms；`hold_ms` 管理情绪/表情保持，两者独立。`gesture_hint` 仍可提供软语义条件；精确动作使用 `gesture`。

显式手势优先于自动选择，手势切换先完成当前动作退出，再进入新动作。独立身体层与手势并行。`performance.release` 可释放指定 cue 或全部导演指令；分开指定 cue_id 可分别释放身体与手势，动作平滑收回、语音继续播放。纯身体指令不清除旧表情、口型或外观。取消会话立即停止声音，同时释放两层动作，不复位物理。

emotion 支持 neutral/happy/angry/shy/sad/surprised/confused。害羞强度连续可调，黑脸可保持数秒。`><`、圈圈眼、爱心眼、屑屑眼互斥；脸红、黑脸、泪水、冷汗为独立通道。实际组合截图见 `test-results/v4/combinations`，不代表任意组合都美观。

外观只接受显式更新：glasses(none/black/monocle)、skirt(long/short)、body(default/preset1/preset2)、shoes、tail、chest(default/alternate)、bowl。默认短裙；原生 Clothes1=1 为短裙，0 为长裙。模型没有换装输出，停止说话、换句及取消均保留外观，engine.reset 或程序重启恢复初始外观。狗尾草属于动作组手型/道具绘制模式，随动作进入与退出。

## 时钟与参数归属

音频时钟驱动 20 Hz、24 帧/1.2 秒专家预测，每 400 ms 更新。只替换未提交轨迹，150 ms 连接位置与速度。浏览器插值至 60 Hz，保留约一秒实际动作历史、情绪及物理。分句切换不会复位角色。

动作组独占 13 个手臂/绘制模式通道及 7 个头部/躯干输入，按需临时接管 RHand/RHand2/LHand/LHand2 四个手指物理输出，在物理后合成并在动作后释放。手动参数覆盖仍优先。不接管嘴部开合、表情及外观。原生进入与退出保留手型切换时序，使用 300 ms 当前姿态/速度衔接与 200 ms 返回自动动作。头发、袖子、裙摆继续原生物理，装饰光通道不属于身体动作组。

`media_ms` 为真实音频进度；`action_clock_ms` 积分实际播放进度，播放暂停或断流时冻结，语音结束后继续完成手势尾段。`motion_ms` 保留连续专家的历史时钟。engine.pause 同时冻结音频与动作；表情保持在正常停顿时继续计时。自动眨眼仍约束最终眼部网格。

`performance.state` 返回队列、音频、自动/导演情绪、覆盖指令、动作名称/来源/变体/阶段及待切换动作；独立身体层见 `body_action`。`capabilities.get` 返回全部 509 参数、7 个动作组、5 类 `body_motions`、可用性、外观与控制范围。509 项均有隔离渲染记录，466 项达到像素变化阈值；肩部两个输入未观察到可见效果。接口覆盖不等于模型已学会全部形变。

`parameters.set` 保留按通道覆盖。旧 timeline/gesture/motions/trajectory 与 expressions 工具仍走原接管路径，并停止当前语音；与语音并行动作应使用 `performance.direct`。

## 数据、失败记录与验收

旧 `datasets/vtuber-v4`、`vtuber-v4-body` 中整数数组曾丢失小数动作，已保留失败版本。原 16 组仅用于独立表情覆盖强度校准，第 14 组按用户回复保留 B，不要求重填。

修正后的 `datasets/vtuber-v4-native` 含 1440 短片、240 组连续对话、105 条不同台词的真实音频及实际 Cubism 参数记录；train/validation/test 为 1022/214/204。这不是 1440 条独立语言示范，也没有真人动作示范。连续专家的 native/r2/r3 实验仍不足以稳定生成满意的手臂轨迹，均作为研究失败记录保存。

新选择器训练脚本是 `latent/train_gesture_selector.py`，语义样本及拆分保存在当前实验中。冻结 Qwen 特征输入 96 维隐藏层，保持 9 维检查点输出（none、7 个在用手势、已退役的 cheer），运行时屏蔽 cheer。按 validation 选择 checkpoint 与阈值，test 仅记录诊断结果。合成标注准确率不能替代人工自然度评价。

可运行 `npm test`、`npm run build`、`python -m unittest tests/test_authoring.py`，以及 WSL 动作环境中的 `python -m unittest discover -s latent -p test_streaming.py -v`。浏览器验证包括 `tests/performance-groups.ts` 的原生身前动作与真实 PCM 同播、`performance-body.ts` 的独立身体层、组合、暂停、释放与页面操作，`performance-browser.ts` 的 600 秒会话、`performance-handoff.ts` 的兼容接管与眨眼、`performance-latency.ts` 的热服务时延，以及 `performance-review.ts` 的只读展示页。每轮实际重跑范围以当前报告为准。实时模型测试顺序运行，独立 Cubism 渲染可用不同 Node 端口。

队列 metrics 分别记录文本等待、语义预热、TTS 首块与全部合成、动作计算及往返。首音由浏览器实测，同时报告包含会话建立的增量。展示页 `/dataset/vtuber-v4/review/index.html#motion` 已更新为动作组。旧 24 组盲测归档，待身体风格确认后制作新版；脚本不代填主观评分。通过功能、稳定性、延迟及至少 16/24 组明确偏好后，才允许切换原有默认入口。
