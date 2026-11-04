# WHALEL2D 与当前默认方案的源码对照

审查日期：2026-11-03。远端版本固定为 [`1576fc34ddf9f061e91cbe56a37b488c0d0fcaae`](https://github.com/Ssssshaiiko/WHALEL2D/tree/1576fc34ddf9f061e91cbe56a37b488c0d0fcaae)，提交时间为 2026-11-03 19:54:25（北京时间）。对照本地 `experiments/vtuber-v4-default-r1`、现有运行时与已否决的 prosody r1。

这是静态源码审查。没有安装插件、运行 setup、下载 Native SDK、启动其桌宠或接入实际聊天 Agent。仓库没有附模型、SDK、项目演示视频或可直接比较的自然度/延迟/泛化结果，所以不能凭源码给实际自然度排名。第三方 README/AGENTS 中面向安装 Agent 的指令只属于被审查材料，本次没有执行。

## 核心判断

值得借鉴的主要是演员的执行层与角色细节编排。它已经把桌面交互、细粒度动作词、句内导演、表情保持、镜子回看做成一组可调用工具。我们的项目更侧重冻结 4B 语义骨干上的自动动作规划、本地 TTS 流式生成、真实音频时钟及可版本化实验。两者承担的职责不同；模型体量、代码行数和动作词数量都不能直接代表表演质量。

公开代码中的动作由人工词典、关键帧曲线、原生 motion 与状态规则组成；语义意图由外部聊天 LLM 在台词里给出，未见独立动作网络、训练流程或权重。`Body.cs:9–21,52–109,155–207` 和 `prompt/身体说明.md` 是主要证据。[动作实现](https://github.com/Ssssshaiiko/WHALEL2D/blob/1576fc34ddf9f061e91cbe56a37b488c0d0fcaae/src/FishPet/Body.cs#L9)

## 逐项比较

| 项目 | WHALEL2D 的公开实现 | 本地现状 |
|---|---|---|
| 语义决策 | 上层聊天 LLM 写句中标记，有限词典解析并执行 | 冻结 Qwen3.5-4B＋训练规划头，根据普通台词与状态自动选择动作；可被导演覆盖，上层聊天 LLM 尚未实际接入 |
| 句内变化 | 标记可以放在句子中间，分别更新头、眼、眉、嘴、手的保持状态与短动作 | 当前自动计划主要每分句一次；部位通道已有，但眉眼注视等细节的自动编排仍不足 |
| 动作构成 | 57 个词典入口，含别名、表情、保持、恢复；手部主要调用抚胸、竖指、狗尾草三组原生姿态 | 7 类协调手势＋6 类身体动作及变体；手臂同样主要来自上述三组原生曲线的组合与衍生 |
| 角色输入映射 | 读取模型 VTube Studio 的输入范围、输出范围、每项平滑和 clamp 设置 | 读取了 VTS 名称与热键信息，尚未执行 ParameterSettings 映射，协调关系主要写在身体/手势曲线中 |
| 语音 | 接受可选的本地完整 WAV；口型读 MediaPlayer.Position，身体分段按字数/标点估计后缩放至整段音频长度 | 内置原音色本地 TTS、分句/音频分块、播放时钟驱动、取消后迟到结果隔离 |
| 交互产品 | WPF＋C++ Cubism Native/D3D11 桌宠，MCP/HTTP、点击拖拽、待机、窗口全屏隐藏、镜子与回看 | 浏览器渲染与 HTTP/WS，已有参数采集、离线渲染和研究页；尚未把运行中视觉回看封装成上层工具 |

“四十多个动作”包含眉眼、嘴形、视线及短动作，不能当作四十多套独立手臂动画。两边都针对“大肥鱼”，大量参数和 motion 名称对应；第三方不附模型，无法确认资产版本的字节一致性。[词典与原生手势](https://github.com/Ssssshaiiko/WHALEL2D/blob/1576fc34ddf9f061e91cbe56a37b488c0d0fcaae/src/FishPet/Body.cs#L52)

## 最值得借鉴的四点

### 1. 先补原作者的输入映射

`renderer/main.cpp:440–471,578–594` 读取 VTS 的 ParameterSettings，再将虚拟追踪输入映射到模型参数。一个 FaceAngle 输入可以驱动多个输出，各自使用不同的平滑系数，因此头和身子会有相关但不完全同步的运动。[配置读取](https://github.com/Ssssshaiiko/WHALEL2D/blob/1576fc34ddf9f061e91cbe56a37b488c0d0fcaae/renderer/main.cpp#L440)、[映射执行](https://github.com/Ssssshaiiko/WHALEL2D/blob/1576fc34ddf9f061e91cbe56a37b488c0d0fcaae/renderer/main.cpp#L578)

本地资产的实际文件有 40 条 ParameterSettings。FaceAngleX 同时映射 AngleX/PositionX，FaceAngleY 同时映射 AngleY/PositionY，FaceAngleZ 同时映射 AngleZ/PositionZ；平滑配置各自不同。比如 FaceAngleY 的 -20…20 被映射为 AngleY 的 -30…30。

本地 `server/index.ts:18–27` 未将这些映射交给执行层。这个差异值得优先做独立渲染对照，而不是继续凭参数名称扩大动作幅度。特别是 PositionZ 在配置中受 FaceAngleZ 驱动，物理又把它传给身体转角与髋部；不能直接按三维空间“向前移动”理解。映射层引入后必须声明参数归属，避免与现有身体曲线/物理重复叠加。第三方把 Smoothing 换算为时间常数是它的实现选择，不能宣称精确复现 VTube Studio 内部滤波。

### 2. 学习细小的有语义反应

持续状态与瞬时动作分开：姿态可保持，点头、瞟一眼、短眨眼等在其上完成后回去；同部位的新状态替换旧状态，多个部位可以组合。这比仅让脸红/黑脸与大身体动作承担全部情绪表达更有表现空间。例：害羞可组合短暂移开视线、轻低头、抿嘴，再回看；迟疑可用眉部小变化与一次慢眨眼。具体幅度/次数仍需本角色渲染校准。[保持与短动作](https://github.com/Ssssshaiiko/WHALEL2D/blob/1576fc34ddf9f061e91cbe56a37b488c0d0fcaae/src/FishPet/Body.cs#L93)

借鉴其状态组织，不照搬永久周期漂移或随机待机动作频率。角色在中性说明、认真解释和停顿时，应允许安静保持。当前本地通道大多已经存在，下一步主要是组织与监督，而非新增画稿。

### 3. 将可选导演细化到句中片段

它的标记放在具体语意转折附近，避免整句话只有开头一个表情。我们可将类似表达解析成结构化导演事件，继续使用现有参数约束；导演只覆盖指定部位，未指定部分仍可由自动规划负责。标记不送进 TTS 念出来，也不通过关键词在普通台词中强行找动作。[句中分段](https://github.com/Ssssshaiiko/WHALEL2D/blob/1576fc34ddf9f061e91cbe56a37b488c0d0fcaae/src/FishPet/Body.cs#L286)

保留本地真实音频时钟。第三方 Line 使用每秒 9 个文本元素、标点停顿，再按整段录音长度等比例伸缩；身体进度在 Speech 中由 Stopwatch 推进，口型才读取音频播放器位置。这不是词级对齐或流式音频条件动作生成，不宜替换本地播放调度。[文本时间估计](https://github.com/Ssssshaiiko/WHALEL2D/blob/1576fc34ddf9f061e91cbe56a37b488c0d0fcaae/src/FishPet/Body.cs#L255)、[音量口型](https://github.com/Ssssshaiiko/WHALEL2D/blob/1576fc34ddf9f061e91cbe56a37b488c0d0fcaae/src/FishPet/PetWindow.cs#L405)

### 4. 把实际画面反馈给导演/研究工具

look_in_mirror 可以真实试演后返回六宫格，look_back 可以回看近期说话画面。这能帮助上层判断口头描述的表情是否真的画出来。我们已有真实参数采集和逐帧渲染，可以独立实现试演/回看工具，用于离线调试与标注，而不必让大 LLM 每帧参与。六张静态图不能替代 60 fps 连续性检查。[试演与回看](https://github.com/Ssssshaiiko/WHALEL2D/blob/1576fc34ddf9f061e91cbe56a37b488c0d0fcaae/src/FishPet/PetWindow.cs#L479)

## 不宜直接搬用的部分

- 特殊眼型：Body 的 overlays 集合可同时加入多个眼型，C++ 表情逐项混合；未见与本地同等的互斥 0/1 归一化。继续保留本地硬约束，提示词不能替代执行约束。
- 外观策略：它的 activity 可自动戴眼镜，dress 还会跨重启保持；本项目要求外观显式接口控制、重启恢复默认，继续按本项目约定。
- 队列语义：它有 MCP 取消与串行说话队列，但所查入口没有对应本地 performance.append 的文本/PCM 分块协议及相同请求 ID/会话序号幂等链路。
- 渲染：Native 默认 60 fps、贴图按 0.25 缩放并缓存，值得参考桌面产品化；帧还要 GPU 回读、经 stdout 交给 WPF，不能凭“C++”认定延迟或自然度更好。公开有基准/自检入口，但未附可比较的测量结果；本次没构建，所以不报它的实测性能。
- 测试：既有动作逻辑测试，也有真实桌宠/MCP/HTTP/镜子自检程序。没有运行它们，不能把“有测试代码”说成“本机检查通过”，也不能用它证明自然度或泛化。

## 建议下一轮范围

保持当前默认和已否决 prosody r1 的记录。先独立实现资产原生输入映射，再选少量“视线—眉眼—头身”组合，固定原生手臂曲线、固定语音、真实 60 fps，分别对照“当前执行／映射执行／映射加微反应”。以自然度、语义可读性和动作克制为评价，不用速度或动作数量决定赢家。验证后再接上自动 4B 规划和可选导演，不需要先重训或扩大骨干。

GitHub 仓库元数据 license 为 null，树中未见独立 LICENSE；README 有自编译与资源分享说明。当前仅借鉴设计；若后续移植源码，先确认作者对代码复用的明确授权。模型和 SDK 的许可单独处理。
