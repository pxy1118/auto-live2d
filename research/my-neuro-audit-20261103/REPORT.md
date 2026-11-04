# my-neuro 源码审阅与当前项目对照

审阅时间：2026-11-03。固定版本：[a72ef146e1839a0b4135bceb47b922a7caaebc02](https://github.com/morettt/my-neuro/tree/a72ef146e1839a0b4135bceb47b922a7caaebc02)，提交时间 2026-11-02 16:55:35（北京时间）。

本次只读审阅上游源代码，没有安装依赖、运行上游代码、调用聊天模型或动作生成服务。此前本地在线接管开发仍处于用户要求的暂停状态；其未验证改动不算已完成能力。本次仅新增参考源文件快照和本审阅记录。

## 结论

值得借鉴，特别是持续情绪、低频待机动作、面部部位仲裁与动作接管。应区分两个路径：它的 Live2D 编舞是通用 LLM 生成关键帧，加本地规则、表情解算和微动；身体动作生成插件接收外部服务的关节序列，目前播放对象是 VRM/PMX。后者不能直接解决当前 Live2D 角色的手肘、前臂和手型问题。

这些源码足以判断机制，不能据此认定它比本项目的实际画面更自然。没有进行同资产、同音频、同场景的渲染对比，也没有重测它的首音或动作推理延迟。README 中的整套产品功能和延迟宣传不作为本次动作质量证据。

## Live2D 路径实际做了什么

- `motion-director.js` 将完整回复、用户消息、情绪标签和资产提示送入可配置的聊天 API，身体与面部分两路请求；空的专用配置可复用对话 API。身体输出小幅 x/y/z 关键帧；面部输出 AU、注视和脸红，不允许编舞请求直接控制语音开口。没有在这条路径发现独立训练的 Live2D 连续动作专家。
- 同文件先放入本地回退编舞，随后流式接受模型关键帧，带运行代号和取消信号。语义动作请求还经过 `motion-directives.js` 的显式指令/文本模式处理。因此不是所有看起来对上文字的反应都来自模型泛化。
- `param-director.js` 按部位保存进入、保持、退出时长，支持 `sticky`、`hold_group` 和主动释放。身体、脸部、待机等时间线分通道，微动按当前参数占有权让位。
- `expression-solver.js` 将语义表情单元和原生表情/动画一起筛选，结合情绪相关度、新颖性、历史、冲突及互斥规则。`semantic-actions.js`、`facs-mapper.js` 再把语义控制映射到具体模型参数。这主要是规则与约束解算，不能当作一个新训练的面部生成模型。
- `runtime.js` 给语音口型、原生眼部动画、程序眨眼和面部控制安排写入顺序；`face-micro-motion.js` 在强控制占有参数时缩小对应微动，避免反复覆盖。

来源：[编舞器](https://github.com/morettt/my-neuro/blob/a72ef146e1839a0b4135bceb47b922a7caaebc02/live-2d/js/ai/motion-director.js#L373)、[部位执行器](https://github.com/morettt/my-neuro/blob/a72ef146e1839a0b4135bceb47b922a7caaebc02/live-2d/js/avatar/live2d/param-director.js#L823)、[表情解算](https://github.com/morettt/my-neuro/blob/a72ef146e1839a0b4135bceb47b922a7caaebc02/live-2d/js/avatar/live2d/expression/expression-solver.js#L131)、[微动让位](https://github.com/morettt/my-neuro/blob/a72ef146e1839a0b4135bceb47b922a7caaebc02/live-2d/js/avatar/live2d/face-micro-motion.js#L51)。

## 最值得吸收的设计

### 1. 慢情绪与一次性表情分开

`vad-state.js` 的 VAD 是愉悦度、唤醒度、支配感三维情绪，不是语音活动检测。它保存当前值、目标值、角色基线和保持时间，先靠近目标，保持后再衰减。默认 `emotionHoldSeconds=18` 是保持公式的一项，不代表每次精确保持 18 秒；`nudge` 实际按输入强度计算保持时间。

当前项目已有跨句情绪保持和独立表情强度。可以进一步让慢状态决定身体松紧、注视稳定性和待机倾向，而非每次直接触发一个新手势。强度应来自语义意图、导演值或独立学习结果，不把分类置信度当表情幅度。

来源：[VADState](https://github.com/morettt/my-neuro/blob/a72ef146e1839a0b4135bceb47b922a7caaebc02/live-2d/js/avatar/live2d/vad-state.js#L57)。

### 2. 低频、可打断的待机动作

`idle-action-scheduler.js` 默认间隔 7–19 秒，另外有单动作冷却、最近动作/方向避重；候选包括点头、歪头、侧看、重心移动、靠近、慢眨眼等。`param-director.js` 仅在不说话、不等待说话、没有其他活动时允许这一调度器；说话开始时清掉待发步骤并淡出待机通道。

这个设计适合解决“停止说话后完全木住”，也符合用户反对手舞足蹈的要求。移植思路时先用已校准的眼神、头部、轻微躯干动作，手臂不加入随机待机池；恢复说话时立即让位。其连续正弦微动是另一机制，不应把有节制的离散调度等同于持续随机晃动。

来源：[待机调度](https://github.com/morettt/my-neuro/blob/a72ef146e1839a0b4135bceb47b922a7caaebc02/live-2d/js/avatar/live2d/idle-action-scheduler.js#L114)、[说话时让位](https://github.com/morettt/my-neuro/blob/a72ef146e1839a0b4135bceb47b922a7caaebc02/live-2d/js/avatar/live2d/param-director.js#L432)。

### 3. 分部位持续时间和冲突处理

可以让黑脸保持数秒、眼神短暂回避、眉毛先动再缓释、嘴形持续服从语音；这些部位无需共用一个保持时间。相同情绪也不必永远用同一组眉眼组合。候选筛选应保持语义核心，有限变化次要部位，并明确禁止不合理组合。

本项目的特殊眼型仍需保持离散互斥；外观继续只受显式接口控制。不要把通用 AU 连续混合直接套到 `><`、圈圈眼等绘制开关上。

来源：[按参数时长](https://github.com/morettt/my-neuro/blob/a72ef146e1839a0b4135bceb47b922a7caaebc02/live-2d/js/avatar/live2d/param-director.js#L840)、[组合冲突](https://github.com/morettt/my-neuro/blob/a72ef146e1839a0b4135bceb47b922a7caaebc02/live-2d/js/avatar/live2d/expression/expression-solver.js#L179)。

### 4. 从画面实际姿态接下一段

最新提交专门修复 3D 动作间的姿态保持：完成或打断时保持当前姿态，下一段从实际显示姿态开始，约 0.4 秒消去入口偏差；停用插件才恢复原始状态。它的实现含骨骼旋转和模型空间对齐，不能直接作为 Live2D 参数代码使用，但“保留当前值、接管来源清楚、只平滑过渡差值”的原则很有参考价值。

当前在线接管候选继续沿此方向开发时，仍应验证当前位置和速度、非默认姿态、暂停、断流、取消后迟到消息，以及面部让位；不能把上游使用缓动公式当作本项目连续性已通过。

来源：[修复提交](https://github.com/morettt/my-neuro/commit/a72ef146e1839a0b4135bceb47b922a7caaebc02)、[3D 接管实现](https://github.com/morettt/my-neuro/blob/a72ef146e1839a0b4135bceb47b922a7caaebc02/live-2d/plugins/community/body-actions/retarget.js#L155)。

## 不直接采用的部分

| 项目 | 源码观察 | 本项目处理 |
|---|---|---|
| 语音同步 | 该 TTS 播放路径用整段时长估字符间隔，字幕字符进度触发编舞；没进度时按估算语速推进 | 继续采用实际音频播放时钟，后续需要词级时机再做真实对齐 |
| 动作输出 | Live2D 编舞输出头/躯干小目标，原生动画另行调用；3D 插件输出骨骼关节 | 保留当前角色已校准的原生手臂、手腕和绘制状态，不把 3D 权重/坐标直接映到 2D |
| 兼容参数 | 其默认使用 `ParamAngleXYZ`、`ParamBodyAngleXYZ` 等常见 ID | 当前资产这些 ID 属物理输出；应控制 `AngleXYZ`、`PositionXYZ` 等输入并交给物理传递 |
| 微动 | 包含周期微动和语音能量调制 | 不据此重新启用用户否决的节奏变速方案，先比较有限、低频反应 |
| 语义能力 | Live2D 编舞可复用任意配置的对话模型；3D 动作服务的底层权重不在此仓库提供 | 无法从仓库名或功能清单推断体量、泛化能力和本机性能；保留现有 4B 语义及验证拆分 |

语音路径来源：[TTS 字符进度](https://github.com/morettt/my-neuro/blob/a72ef146e1839a0b4135bceb47b922a7caaebc02/live-2d/js/voice/tts-playback-engine.js#L125)、[无进度回退](https://github.com/morettt/my-neuro/blob/a72ef146e1839a0b4135bceb47b922a7caaebc02/live-2d/js/avatar/live2d/param-director.js#L720)。3D 插件说明明确表示仅支持 VRM/PMX，生成与语音并行，不保证按标签位置精确对齐：[插件说明](https://github.com/morettt/my-neuro/blob/a72ef146e1839a0b4135bceb47b922a7caaebc02/live-2d/plugins/community/body-actions/README.md#L35)。

本地参数归属直接核对原始 `大肥鱼.physics3.json`：`AngleX/Y/Z`、`PositionX/Y/Z` 是输入而非输出；`ParamAngleX/Y/Z` 和 `ParamBodyAngleX/Y/Z` 同时参与输入和输出。显示文件中有 `LEyeSquint/REyeSquint`，没有上游默认的 `EyeL_Squint/EyeR_Squint`。这说明名称存在也不足以认定有独立控制权，仍需实际渲染校准。

## 建议开发顺序

1. 先完成已经暂停的在线接管候选验证，确认暂停、断流、非默认姿态及手臂/物理归属不回退。
2. 再引入稀疏待机调度与可解释的注意力状态，先做低幅、无手臂版本；使用相同语音与动作来源比较。
3. 最后扩充慢情绪和分部位保持/退出。先做执行层对照，若表现有收益，再决定是否增加训练标签或模型输出。

本次不修改默认配置、不切模型、不重启主服务、不新增人工评分，不把待开发能力写成已经通过。

## 保存与许可

27 个只读参考文件保存在 `.runtime/reference-repos/my-neuro-a72ef14/`，`source-manifest.json` 记录固定提交与每个文件的 Git blob SHA；仅供审阅，不被项目运行时导入。源码快照保留原许可和文件头。根许可证为 MIT；部分运行时和情绪文件注明参考 Apache-2.0 项目，若今后实际移植源码，应同时保留适用的声明。
