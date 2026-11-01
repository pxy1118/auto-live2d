# 大肥鱼 Live2D 模型全功能分析

分析日期：2026-10-31（Asia/Shanghai）。模型目录：`live2d/DeepSeek/DeepSeek`。

这是配置和资源的静态审计：逐一解析 JSON、解码动画曲线、核对引用及 PNG 文件头，并查看配套缩略图。未在 VTube Studio、VBridger 或 Cubism 中逐项渲染与面捕实测；下文的功能表示资源和配置提供的能力，不代表已验证每个画面效果。原模型文件未修改。

## 1. 模型与资源

内部名称为“大肥鱼”，文件夹名为 DeepSeek。模型缩略图表现为蓝发、兽耳、女仆服角色。它是绑定完成的 Live2D 角色资源；文件夹中没有聊天模型、语音识别、TTS 或自主决策程序。

| 项目 | 核对结果 |
| --- | --- |
| 导出模型 | 大肥鱼.moc3，约 15.73 MiB；文件头 MOC3，版本字节 5 |
| 参数显示信息 | 509 条记录，21 个命名组，另有 1 条未分组呼吸参数；包含辅助项和分隔项 |
| 部件显示信息 | 148 条 Parts 记录；这不是 ArtMesh 数量 |
| VTS 输入映射 | 40 |
| 热键 | 28 项：21 个表情切换、6 个动作、1 个移除全部表情 |
| 表情 | 23 个 exp3 文件，其中竖食指开/关 2 个未绑定热键 |
| 动画 | 8 个 motion3 文件：常规待机、脱捕待机、3 组动作进出 |
| 物理 | 131 组，299 个输入项、292 个输出项、431 个粒子顶点，文件设定 60 FPS |
| VTS 保存版本 | 1.35.44 |
| VBridger | AdvancedARKitSettings.vbridger，18,664 字节，非明文 JSON；未解析其内部计算公式 |
| 工程源文件 | 有 3749 × 7697 像素 PSD；没有发现可编辑的 .cmo3 建模工程或 .can3 动画工程 |
| 贴图与运行包 | 5 张 PNG；运行模型目录约 60.46 MiB，不含 PSD |

### 贴图实际规格

目录名 `.4096` 不等于所有贴图都是 4096 像素。

| 文件 | 尺寸 | PNG 文件 MiB | RGBA8 基础显存 MiB |
| --- | --- | --- | --- |
| 大肥鱼.4096/texture_00.png | 4096 × 8192 | 9.98 | 128 |
| 大肥鱼.4096/texture_01.png | 4096 × 8192 | 12.60 | 128 |
| 大肥鱼.4096/texture_02.png | 2048 × 2048 | 2.16 | 16 |
| 大肥鱼.4096/texture_03.png | 8192 × 8192 | 17.76 | 256 |
| 大肥鱼.4096/texture_04.png | 4096 × 4096 | 1.10 | 64 |

按 RGBA8、每张仅一份且不生成 mipmap 计算，基础贴图合计 **592 MiB**；实际占用还取决于上传格式、mipmap、遮罩、渲染缓存等。含 8192 边长贴图，接入时需检查运行设备的最大纹理尺寸。

## 2. 面捕、身体和嘴型能力

- 头部：左右转头、上下抬低头、左右歪头，经 `AngleX/Y/Z → 物理 → ParamAngleX/Y/Z` 传导。
- 身体：胸腔、肩膀、骨盆、双腿、重心与缓动均有参数和物理链。当前 `PositionX/Y/Z` 接的是 `FaceAngleX/Y/Z`，因此是随头部联动的身体摆动；未配置真实全身位置/骨骼追踪。模型整体位置追踪 `ModelPositionMovement.Use=false`。
- 眼睛：左右独立开闭、眼球横纵向、瞳孔透视、笑眼、左右眯眼、眉毛高低和角度、眉心抬起、惊讶与多层高光。眼球横向输入使用右眼数据并反向映射；两侧眉高和角度共用 `Brows` 输入，不能据此声称当前已独立追踪左右眉。
- 嘴部：张嘴、嘴形、下巴、伸舌、歪嘴、噘嘴、漏斗嘴、嘴宽窄、鼓腮、抿嘴、上下唇内卷、左右嘴角和鼻部动作均有输入映射或物理链。部分输入来自自定义跟踪器/VBridger，是否有实时数据须现场确认。
- 语音：`VoiceA/I/U/E/O → ParamA/I/U/E/O`，`VoiceSilence → ParamSilence`，已配齐 5 个元音和静音映射。是否启用麦克风、音源和校准不由这个模型目录完整决定。
- 呼吸：`ParamBreath` 使用 VTS 自动呼吸 `UseBreathing=true`，并参与身体、头发、胸部、服饰、尾巴等物理输入。

VTS 支持通过麦克风分析 A/I/U/E/O 并输出上述输入值，见[官方 Lipsync 文档](https://github.com/DenchiSoft/VTubeStudio/wiki/Lipsync)。本目录并不包含独立音频识别器或可直接播放的配音文件。

### 全部 40 条输入映射

以下是 **VTS 配置映射范围**，不是从 moc3 运行时读取的参数真实上下限。保留源文件中的大小写和拼写。

| 名称 | 输入 | 输入范围 | Live2D 输出 | 输出范围 | 平滑 |
| --- | --- | --- | --- | --- | --- |
| Face Left/Right Rotation | FaceAngleX | -30 → 30 | AngleX | -30 → 30 | 15 |
| Face Up/Down Rotation | FaceAngleY | -20 → 20 | AngleY | -30 → 30 | 4 |
| Face Lean Rotation | FaceAngleZ | -30 → 30 | AngleZ | -30 → 30 | 30 |
| Auto Breath | 自动呼吸 | 0 → 1 | ParamBreath | 0 → 1 | 0 |
| Eye X | EyeRightX | -0.6 → 0.6 | ParamEyeBallX | 1 → -1 | 8 |
| Eye Y | EyeRightY | -0.7 → 0.7 | ParamEyeBallY | -1 → 1 | 8 |
| Eye Open Left | EyeOpenLeft | 0 → 0.8 | ParamEyeLOpen | 0 → 1.5 | 10 |
| Brow Height Left | Brows | 0.3 → 0.6 | ParamBrowLY | -1 → 1 | 49 |
| Eye Open Right | EyeOpenRight | 0 → 0.8 | ParamEyeROpen | 0 → 1.5 | 10 |
| Brow Height Right | Brows | 0.3 → 0.6 | ParamBrowRY | -1 → 1 | 49 |
| 撅嘴 | MouthShrug | 0 → 0.55 | Mouthpucker | 0 → 1 | 19 |
| 漏斗 | MouthFunnel | 0 → 0.4 | MouthFunnel | 0 → 1 | 7 |
| 歪嘴 | MouthX | -0.8 → 0.8 | MouthX | -1 → 1 | 23 |
| 鼓脸 | CheekPuff | 0 → 1 | CheeckPuff | 0 → 1 | 53 |
| 抿嘴 | MouthPressLipOpen | 1 → -1 | MouthPressLipOpen | -1 → 1 | 3 |
| Jaw Open | JawOpen | 0 → 1 | JawOpen | 0 → 1 | 0 |
| 撅嘴 | MouthPucker | -0.7 → 0.7 | MouthPuckerWiden | -1 → 1 | 0 |
| 微笑 | MouthSmile | 0.2 → 0.7 | EyeSmile | 0 → 1 | 20 |
| 眉心角度 | BrowInnerUp | 0 → 0.5 | BrowInnerUp | 0 → 1 | 68 |
| eyeSquint_R | REyeSquint | 0 → 1 | REyeSquint | 0 → 1 | 10 |
| eyeSquint_L | LEyeSquint | 0 → 1 | LEyeSquint | 0 → 1 | 10 |
| 身体X | FaceAngleX | -30 → 30 | PositionX | -30 → 30 | 20 |
| 身体Y | FaceAngleY | -30 → 30 | PositionY | -30 → 30 | 20 |
| 身体Z | FaceAngleZ | -30 → 30 | PositionZ | -30 → 30 | 20 |
| 吐舌 | TongueOut | 0 → 1 | TongueOut | 0 → 1 | 3 |
| L UP | mouthSmileL | 0 → 1 | MouthSmile_L | 0 → 1 | 20 |
| R UP | mouthSmileR | 0 → 1 | MouthSmile_R | 0 → 1 | 20 |
| Noesneer | nosesNEER | 0 → 1 | NoseNeer | 0 → 1 | 20 |
| 上唇抿唇 | MouthRollUpper | 0 → 1 | MouthRollUpper | 0 → 1 | 20 |
| 下唇抿唇 | MouthRollLower | 0 → 1 | MouthRollLower | 0 → 1 | 20 |
| Mouth Form | MouthSmile | 0 → 1 | ParamMouthForm | -1 → 1 | 0 |
| Mouth Open | MouthOpen | 0 → 1 | ParamMouthOpenY | 0 → 1 | 0 |
| Silence | VoiceSilence | 0 → 1 | ParamSilence | 0 → 1 | 0 |
| Phoneme A | VoiceA | 0 → 1 | ParamA | 0 → 1 | 0 |
| Phoneme I | VoiceI | 0 → 1 | ParamI | 0 → 1 | 0 |
| Phoneme U | VoiceU | 0 → 1 | ParamU | 0 → 1 | 0 |
| Phoneme E | VoiceE | 0 → 1 | ParamE | 0 → 1 | 0 |
| Phoneme O | VoiceO | 0 → 1 | ParamO | 0 → 1 | 0 |
| BrowR | Brows | 0 → 1 | ParamBrowRAngle | -1 → 1 | 7 |
| Brow L | Brows | 0 → 1 | ParamBrowLAngle | -1 → 1 | 20 |

## 3. 全部 28 项热键

键名按原配置记载：`N1`～`N9`、`LeftShift` 等未擅自改写。全部 `IsActive=true`、`IsGlobal=true`，键盘热键启用，屏幕热键禁用。表情热键默认按一次开、再按一次关，没有配置松键关闭或定时关闭。

| 功能 | 按键 | 动作类型 | 目标文件 | 停在末帧 |
| --- | --- | --- | --- | --- |
| 兔牙 | Alt + N1 | ToggleExpression | 兔牙.exp3.json | 否 |
| 加载 | Alt + N2 | ToggleExpression | 加载.exp3.json | 否 |
| 单片眼镜 | Alt + Q | ToggleExpression | 单片眼镜.exp3.json | 否 |
| 圈圈眼 | Alt + N3 | ToggleExpression | 圈圈眼.exp3.json | 否 |
| 屑 | Alt + N4 | ToggleExpression | 屑屑眼.exp3.json | 否 |
| 流泪 | Alt + N5 | ToggleExpression | 流泪.exp3.json | 否 |
| 爱心眼 | Alt + N6 | ToggleExpression | 爱心眼.exp3.json | 否 |
| 脱鞋 | Alt + W | ToggleExpression | 脱鞋.exp3.json | 否 |
| 脸红 | Alt + N7 | ToggleExpression | 脸红.exp3.json | 否 |
| 钢盆 | Alt + E | ToggleExpression | 钢盆.exp3.json | 否 |
| 裙长切换 | Alt + R | ToggleExpression | 裙子切换.exp3.json | 否 |
| 黑框眼镜 | Alt + T | ToggleExpression | 黑框眼镜.exp3.json | 否 |
| 黑脸 | Alt + N8 | ToggleExpression | 黑脸.exp3.json | 否 |
| ＞＜ | Alt + N9 | ToggleExpression | ＞＜.exp3.json | 否 |
| 移除所有按键 | Alt + Delete | RemoveAllExpressions | — | 否 |
| 体型1 | LeftShift + N2 | ToggleExpression | 体型1.exp3.json | 否 |
| 体型2 | LeftShift + N3 | ToggleExpression | 体型2.exp3.json | 否 |
| 默认体型 | LeftShift + N4 | ToggleExpression | 默认体型.exp3.json | 否 |
| 前倾 | LeftShift + N5 | ToggleExpression | 前倾.exp3.json | 否 |
| 抚胸手打开 | Alt + Z | TriggerAnimation | 默认手切举手.motion3.json | 是 |
| 抚胸手关闭 | Alt + X | TriggerAnimation | 举手切默认手.motion3.json | 否 |
| 竖手指打开 | Alt + C | TriggerAnimation | 竖手指切出来动画.motion3.json | 是 |
| 竖手指关闭 | Alt + V | TriggerAnimation | 竖手指切回默认.motion3.json | 否 |
| 狗尾巴草打开 | Alt + D | TriggerAnimation | 狗尾草切换出来.motion3.json | 是 |
| 狗尾巴草关闭 | Alt + F | TriggerAnimation | 狗尾草切回默认手.motion3.json | 否 |
| 尾巴开关 | LeftShift + N1 | ToggleExpression | 尾巴开关.exp3.json | 否 |
| 流冷汗 | Alt + S | ToggleExpression | 流冷汗.exp3.json | 否 |
| 胸口衣服 | LeftShift + S | ToggleExpression | 胸口衣服.exp3.json | 否 |

`Alt + Delete` 是“移除全部表情”，不等于停止动作、恢复所有动画写入参数或重载模型。抚胸、竖食指、狗尾草应使用各自关闭动作回到默认手。

## 4. 全部 23 个表情文件

表情包含 13 个视觉开关、5 类衣装/体型控制、前倾和竖食指开关。所有参数项都使用 `Blend=Add`；下表为增量而非绝对目标值。

| 文件 | 参数增量 | 对应热键名称 |
| --- | --- | --- |
| 体型1.exp3.json | Clothes2 0.4 (Add) | 体型1 |
| 体型2.exp3.json | Clothes2 1 (Add) | 体型2 |
| 兔牙.exp3.json | key9 1 (Add) | 兔牙 |
| 前倾.exp3.json | LeanInput -30 (Add) | 前倾 |
| 加载.exp3.json | key8 1 (Add) | 加载 |
| 单片眼镜.exp3.json | key12 1 (Add) | 单片眼镜 |
| 圈圈眼.exp3.json | key3 1 (Add); key4 0 (Add); key5 0 (Add); key6 0 (Add) | 圈圈眼 |
| 尾巴开关.exp3.json | Clothes5 -1 (Add) | 尾巴开关 |
| 屑屑眼.exp3.json | key3 0 (Add); key5 0 (Add); key6 1 (Add) | 屑 |
| 流冷汗.exp3.json | key13 1 (Add) | 流冷汗 |
| 流泪.exp3.json | key2 1 (Add) | 流泪 |
| 爱心眼.exp3.json | key4 1 (Add) | 爱心眼 |
| 竖食指关.exp3.json | Movement3 0 (Add) | 未绑定 |
| 竖食指开.exp3.json | Movement1 0 (Add); Movement3 1 (Add) | 未绑定 |
| 胸口衣服.exp3.json | Clothes3 1 (Add) | 胸口衣服 |
| 脱鞋.exp3.json | Clothes4 1 (Add) | 脱鞋 |
| 脸红.exp3.json | key7 1 (Add) | 脸红 |
| 裙子切换.exp3.json | Clothes1 -1 (Add) | 裙长切换 |
| 钢盆.exp3.json | key10 1 (Add) | 钢盆 |
| 黑框眼镜.exp3.json | key11 1 (Add) | 黑框眼镜 |
| 黑脸.exp3.json | key1 1 (Add) | 黑脸 |
| 默认体型.exp3.json | Clothes2 0 (Add) | 默认体型 |
| ＞＜.exp3.json | key3 0 (Add); key4 0 (Add); key5 1 (Add); key6 0 (Add) | ＞＜ |

功能解释：`key1～13` 依次是黑脸、流泪、圈圈眼、爱心眼、＞＜眼、屑屑眼、脸红、加载、兔牙/大牙、钢盆、黑框眼镜、单片眼镜和冷汗。`Clothes1` 控制长短裙，`Clothes2` 控制体型变化，`Clothes3` 控制胸口衣服，`Clothes4` 控制鞋子，`Clothes5` 控制尾巴。体型文件分别对 Clothes2 增加 0、0.4、1；它们不是舞台缩放，且 Clothes2 还输入头发、帽子、尾巴和透明度物理。具体三个体型的视觉差异未渲染确认。

### 表情叠加与复位的边界

[Live2D 官方定义](https://docs.live2d.com/en/cubism-sdk-manual/expression/)中，Add 把文件值加到当前参数；因此 `Add 0` 不能直接覆盖已有值。这影响：

- `默认体型.exp3.json` 中 Clothes2 加 0：文件本身不构成强制复位。
- `竖食指关.exp3.json` 中 Movement3 加 0：文件本身不能强制关掉已写为 1 的参数。VTS 实际热键使用的是有归零曲线的关闭动画。
- 圈圈眼、＞＜眼、屑屑眼文件中的其他眼型加 0：文件算术本身不能保证互斥；ExpressionGroups 也为空。宿主是否自动停用冲突表情需要实测。
- 多个体型表情若同时保持激活可能叠加。外接程序应显式管理眼型/体型/手势状态，不能仅照文件名猜测开关语义。

以上是配置语义与潜在组合问题，未据此断言 VTS 现场表现必定错误。

## 5. 全部 8 个动画

全部动画文件声明 60 FPS、Loop=true、无 UserData 事件。动作开启热键另有 StopsOnLastFrame=true；因此实际播放方式由宿主共同决定，移植时不能把所有 Loop=true 都按无限循环播放。

| 文件 | 时长/秒 | 曲线数 | 用途 |
| --- | --- | --- | --- |
| IDLE.motion3.json | 5.983 | 21 | 常规待机 |
| 举手切默认手.motion3.json | 1.017 | 7 | 抚胸手关闭 |
| 狗尾草切回默认手.motion3.json | 1.133 | 8 | 狗尾巴草关闭 |
| 狗尾草切换出来.motion3.json | 1.233 | 9 | 狗尾巴草打开 |
| 竖手指切出来动画.motion3.json | 1.25 | 10 | 竖手指打开 |
| 竖手指切回默认.motion3.json | 1.25 | 9 | 竖手指关闭 |
| 脱捕.motion3.json | 13.15 | 24 | 丢失追踪后待机 |
| 默认手切举手.motion3.json | 1.133 | 7 | 抚胸手打开 |

- `IDLE` 约 5.983 秒，驱动泪花/眼睛高光闪烁、流泪内部动画、汗滴、呆滞辅助参数和尾部光效。它没有持续驱动头部 AngleX/Y/Z 转头。内部泪水曲线存在不等于默认总会显示流泪，还受显示开关等控制。
- `脱捕` 约 13.15 秒，曲线包含圈圈眼、加载、狗尾草手势、头部和身体轴、眼睛开闭、嘴形等；用于未检测到跟踪时的整段表演。配置等待时间为 0 秒。当前只确认曲线内容，未渲染确认表演观感。
- 手势有 3 组：抚胸/举手、竖食指、狗尾草，每组均有进入与退出过渡，约 1.0～1.25 秒。动作不只是开关贴图，还驱动上臂、前臂、手腕、手指及透视参数。

### IDLE.motion3.json 的全部曲线

范围由线性/阶跃端点及三次贝塞尔极值计算，属于动画文件数值，不是模型真实参数限制，也不包含 VTS 后处理和物理结果。

| ID | 显示名 | 起始值 | 末帧值 | 曲线最小值 | 曲线最大值 |
| --- | --- | --- | --- | --- | --- |
| ShockR | Shock R | -0.159 | -0.077 | -0.159 | 0.159 |
| ShockL | Shock L | -0.159 | -0.077 | -0.159 | 0.159 |
| Param11 | 呆滞 | 0 | 7 | 0 | 8 |
| SweatBurst1 | 冒汗1 | 0 | 0 | 0 | 1 |
| SweatBurst2 | 冒汗1 开关 | 0 | 0 | 0 | 1 |
| SweatBurst3 | 冒汗2 | 0 | 0 | 0 | 1 |
| SweatBurst4 | 冒汗2 开关 | 0 | 0 | 0 | 1 |
| Divider22 | ■■■■■■■■动画■■■■ | 0 | 0 | 0 | 0 |
| Param31 | 泪花闪烁 | -0.831 | -0.827 | -0.831 | 0.831 |
| Param32 | 高光闪烁 | -0.06 | -0.029 | -0.06 | 0.06 |
| Param27 | < 流泪-膨胀 | -1 | -1 | -1 | 1 |
| Param28 | < 流泪-滴下1 | 0.5 | 0.5 | 0.5 | 1 |
| RCry | <落泪 | 0 | 1 | 0 | 1 |
| Param29 | > 流泪-膨胀 | -1 | -1 | -1 | 1 |
| Param30 | > 流泪-滴下1 | 0.5 | 0.5 | 0.5 | 1 |
| LCry | >落泪 | 0 | 1 | 0 | 1 |
| Startwinkle | 星星闪烁 | -0.501 | -0.488 | -0.501 | 0.501 |
| Param55 | 光1 | 0 | 1 | 0 | 1 |
| Param56 | 光2 | 0.44 | 0.437 | 0 | 1 |
| Param58 | 光3 | 0 | 1 | 0 | 1 |
| Param57 | 光4 | 0.26 | 0.257 | 0 | 1 |

### 举手切默认手.motion3.json 的全部曲线

范围由线性/阶跃端点及三次贝塞尔极值计算，属于动画文件数值，不是模型真实参数限制，也不包含 VTS 后处理和物理结果。

| ID | 显示名 | 起始值 | 末帧值 | 曲线最小值 | 曲线最大值 |
| --- | --- | --- | --- | --- | --- |
| Movement2 | 2. 抚胸 | 1 | 0 | 0 | 1 |
| Param56 | 光2 | 1 | 1 | 1 | 1 |
| Param57 | 光4 | 0 | 0 | 0 | 0 |
| Param62 | L 大臂z | 0.03 | -0.001 | -0.03 | 0.03 |
| Param59 | 大臂透视 | 0.48 | -0.001 | -0.048 | 0.48 |
| Param60 | L小臂 Z | 0.86 | 0 | -0.008 | 0.86 |
| Param61 | L手腕 Z | 0 | 0.001 | 0 | 0.062 |

### 狗尾草切回默认手.motion3.json 的全部曲线

范围由线性/阶跃端点及三次贝塞尔极值计算，属于动画文件数值，不是模型真实参数限制，也不包含 VTS 后处理和物理结果。

| ID | 显示名 | 起始值 | 末帧值 | 曲线最小值 | 曲线最大值 |
| --- | --- | --- | --- | --- | --- |
| Movement1 | 1. 狗尾草 | 1 | 0 | 0 | 1 |
| Param56 | 光2 | 1 | 1 | 1 | 1 |
| Param57 | 光4 | 0 | 0 | 0 | 0 |
| Param36 | R大臂z | 0.04 | 0.001 | 0.001 | 0.068 |
| Param39 | 大臂透视 | 0.2 | 0 | 0 | 0.2 |
| Param41 | R小臂 Z | -0.732 | 0 | -0.766 | 0.007 |
| Param42 | R手腕 Z | 0 | -0.009 | -0.586 | 0.266 |
| Param43 | R 食指 | 0 | 0 | 0 | 0 |

### 狗尾草切换出来.motion3.json 的全部曲线

范围由线性/阶跃端点及三次贝塞尔极值计算，属于动画文件数值，不是模型真实参数限制，也不包含 VTS 后处理和物理结果。

| ID | 显示名 | 起始值 | 末帧值 | 曲线最小值 | 曲线最大值 |
| --- | --- | --- | --- | --- | --- |
| Movement1 | 1. 狗尾草 | 0 | 1 | 0 | 1 |
| Movement3 | 3. 竖食指 | 0 | 0 | 0 | 0 |
| Param56 | 光2 | 1 | 1 | 1 | 1 |
| Param57 | 光4 | 0 | 0 | 0 | 0 |
| Param36 | R大臂z | 0 | 0.04 | 0 | 0.068 |
| Param39 | 大臂透视 | 0 | 0.2 | 0 | 0.2 |
| Param41 | R小臂 Z | 0 | -0.732 | -0.766 | 0.007 |
| Param42 | R手腕 Z | 0 | 0 | -0.586 | 0.266 |
| Param43 | R 食指 | 0 | 0 | 0 | 0 |

### 竖手指切出来动画.motion3.json 的全部曲线

范围由线性/阶跃端点及三次贝塞尔极值计算，属于动画文件数值，不是模型真实参数限制，也不包含 VTS 后处理和物理结果。

| ID | 显示名 | 起始值 | 末帧值 | 曲线最小值 | 曲线最大值 |
| --- | --- | --- | --- | --- | --- |
| Movement1 | 1. 狗尾草 | 0 | 0 | 0 | 0 |
| Movement3 | 3. 竖食指 | 0 | 1 | 0 | 1 |
| Param56 | 光2 | 1 | 1 | 1 | 1 |
| Param57 | 光4 | 0 | 0 | 0 | 0 |
| Param40 | 竖手指 大臂无缝用 | 0 | 1 | 0 | 1 |
| Param36 | R大臂z | 0 | 0 | -0.004 | 0.004 |
| Param39 | 大臂透视 | 0 | 0.322 | 0 | 0.322 |
| Param41 | R小臂 Z | 0 | 0.702 | 0 | 0.708 |
| Param42 | R手腕 Z | 0 | 0 | -0.058 | 0.026 |
| Param43 | R 食指 | 0 | 0 | -0.164 | 0.066 |

### 竖手指切回默认.motion3.json 的全部曲线

范围由线性/阶跃端点及三次贝塞尔极值计算，属于动画文件数值，不是模型真实参数限制，也不包含 VTS 后处理和物理结果。

| ID | 显示名 | 起始值 | 末帧值 | 曲线最小值 | 曲线最大值 |
| --- | --- | --- | --- | --- | --- |
| Movement3 | 3. 竖食指 | 1 | 0 | 0 | 1 |
| Param56 | 光2 | 1 | 1 | 1 | 1 |
| Param57 | 光4 | 0 | 0 | 0 | 0 |
| Param40 | 竖手指 大臂无缝用 | 1 | 0 | 0 | 1 |
| Param36 | R大臂z | 0 | 0 | 0 | 0 |
| Param39 | 大臂透视 | 0.32 | 0 | 0 | 0.32 |
| Param41 | R小臂 Z | 0.7 | 0 | -0.008 | 0.762 |
| Param42 | R手腕 Z | 0 | 0 | -0.102 | 0.136 |
| Param43 | R 食指 | 0 | 0 | -0.14 | 0 |

### 脱捕.motion3.json 的全部曲线

范围由线性/阶跃端点及三次贝塞尔极值计算，属于动画文件数值，不是模型真实参数限制，也不包含 VTS 后处理和物理结果。

| ID | 显示名 | 起始值 | 末帧值 | 曲线最小值 | 曲线最大值 |
| --- | --- | --- | --- | --- | --- |
| key3 | 3. 圈圈眼 | 0 | 0 | 0 | 1 |
| key8 | 8. 加载 | 0 | 0 | 0 | 1 |
| Movement1 | 1. 狗尾草 | 0 | 0 | 0 | 1 |
| AngleX | OX | 0 | 0 | -17.611 | 14.277 |
| AngleY | OY | 0 | 0 | -23.6 | 5.68144 |
| AngleZ | OZ | 0 | 0 | 0 | 23.2664 |
| PositionX | OPX | 0 | 0 | -17.611 | 14.277 |
| PositionY | OPY | 0 | 0 | -6.72 | 5.68 |
| PositionZ | OPYZ | 0 | 0 | -10.2201 | 7.42 |
| ParamEyeROpen | 右眼  开闭 | 1 | 1 | 0 | 1 |
| ParamEyeLOpen | 左眼　开闭 | 1 | 1 | 0 | 1 |
| ParamMouthForm | 嘴　变形 | 0 | -1 | -1 | 1 |
| ParamMouthOpenY | 嘴　张开和闭合 | 0 | 0 | 0 | 0.6 |
| JawOpen | 下巴开闭 | 0 | 1 | 0 | 1 |
| Param11 | 呆滞 | 0 | 8 | 0 | 8 |
| Param55 | 光1 | 0 | 1 | 0 | 1 |
| Param56 | 光2 | 0.44 | 0.44 | 0 | 1 |
| Param58 | 光3 | 0 | 1 | 0 | 1 |
| Param57 | 光4 | 0.26 | 0.26 | 0 | 1 |
| Param36 | R大臂z | 0 | 0 | 0 | 0.096 |
| Param39 | 大臂透视 | 0 | 0 | -0.5 | 0.214 |
| Param41 | R小臂 Z | 0 | 0 | -0.906 | 0.007 |
| Param42 | R手腕 Z | 0 | 0 | -0.586 | 0.268 |
| Param43 | R 食指 | 0 | 0 | 0 | 0 |

### 默认手切举手.motion3.json 的全部曲线

范围由线性/阶跃端点及三次贝塞尔极值计算，属于动画文件数值，不是模型真实参数限制，也不包含 VTS 后处理和物理结果。

| ID | 显示名 | 起始值 | 末帧值 | 曲线最小值 | 曲线最大值 |
| --- | --- | --- | --- | --- | --- |
| Movement2 | 2. 抚胸 | 0 | 1 | 0 | 1 |
| Param56 | 光2 | 1 | 1 | 1 | 1 |
| Param57 | 光4 | 0 | 0 | 0 | 0 |
| Param62 | L 大臂z | 0 | 0.034 | 0 | 0.034 |
| Param59 | 大臂透视 | 0 | 0.476 | 0 | 0.516 |
| Param60 | L小臂 Z | 0 | 0.86 | 0 | 0.88 |
| Param61 | L手腕 Z | 0 | 0.002 | 0 | 0.2 |

## 6. 物理与细节联动

物理组覆盖头/身体控制转换、重心、肩膀、骨盆和双腿；前发、侧发、后发和短马尾；瞳孔、眼眶、睫毛、眉毛和眼光；脸颊、嘴唇、舌头；左右手臂和手指、袖子和飘带；胸部、裙摆分层、上衣花边；兽耳、耳环、蝴蝶结、帽子蕾丝；宝石反光/高光；尾巴和狗尾草。部分组主要负责控制映射或平滑，131 组不能理解成 131 个独立摆动物体。

VTS 设置：Use=true，UseLegacyPhysics=false，PhysicsStrength=50，WindStrength=0，DraggingPhysicsStrength=0。Live2DPhysicsFPS 保存值为枚举数 3，不能解释为每秒 3 帧；physics3.Meta.Fps 才是文件声明的 60。

控制链示例：`FaceAngleX → AngleX → ParamAngleX → 头发/帽子/耳环`；`FaceAngleX → PositionX → ParamBodyAngleX → 胸部/裙子/手臂/尾巴`；`Brows → ParamBrowLY/RY → 兽耳控制/惊讶/情绪过渡`；`Movement1/2/3 → Param35` 控制手臂过渡。

### 全部 131 组输入输出

| 组 | 名称 | 输入参数 | 输出参数 | 顶点数 |
| --- | --- | --- | --- | --- |
| PhysicsSetting1 | OX | AngleX | ParamAngleX | 2 |
| PhysicsSetting2 | OY | AngleY | ParamAngleY | 2 |
| PhysicsSetting3 | OZ | AngleZ | ParamAngleZ | 2 |
| PhysicsSetting4 | 身体X | PositionX | ParamBodyAngleX | 2 |
| PhysicsSetting5 | Positon | PositionX, PositionZ | ParamBodyAngleRX | 2 |
| PhysicsSetting6 | Lean input | LeanInput | Param50 | 2 |
| PhysicsSetting7 | Lean input Shadow | LeanInput | Param53 | 2 |
| PhysicsSetting8 | 身体Y | PositionY, ParamBreath, LeanInput | ParamBodyAngleY | 2 |
| PhysicsSetting9 | 身体Z | PositionZ, PositionX | ParamBodyAngleZ | 2 |
| PhysicsSetting10 | 肩膀Y | PositionY, LeanInput | ShoulderY | 2 |
| PhysicsSetting11 | 肩膀Z | ParamBodyAngleZ, ParamBodyAngleX | ShoulderZ | 2 |
| PhysicsSetting12 | 盆骨X | PositionX, PositionZ | HipAngleX | 2 |
| PhysicsSetting13 | 盆骨X 缓动 | ParamBodyAngleX, PositionY, PositionZ | HipAngleX2 | 2 |
| PhysicsSetting14 | 盆骨Y | PositionY, LeanInput, ParamBreath | HipAngleY | 2 |
| PhysicsSetting15 | 盆骨Z | ParamBodyAngleX, PositionY, ParamBodyAngleZ | HipAngleZ | 2 |
| PhysicsSetting16 | 盆骨Z(2) | ParamBodyAngleX, PositionY, ParamBodyAngleZ | ParamHipAngleZ2 | 2 |
| PhysicsSetting17 | 双腿 Z | HipAngleX, PositionZ | LEGAngleZ2 | 2 |
| PhysicsSetting18 | 盆骨Z缓动 | PositionX, PositionY, HipAngleZ, LeanInput | ParamHipAngleZ | 2 |
| PhysicsSetting19 | 盆骨Z 1 | HipAngleZ | HipZ1 | 3 |
| PhysicsSetting20 | 盆骨Z 2 | ParamBodyAngleZ, ParamBodyAngleX | HipZ2 | 2 |
| PhysicsSetting21 | 身体X左右缓动 | ParamBodyAngleX, ParamBodyAngleZ | ParamBodyAngleX2 | 2 |
| PhysicsSetting22 | 身体X上下缓动 | PositionX, PositionY | HipAngleYDOWN, HipAngleYUP | 2 |
| PhysicsSetting23 | 身体Y缓动 | PositionY, PositionZ, LeanInput | ParamBodyAngleY2 | 2 |
| PhysicsSetting24 | <眼珠 | ParamEyeROpen | REyeball1, REyeball2 | 5 |
| PhysicsSetting25 | >眼珠 | ParamEyeLOpen | LEyeball1, LEyeball2 | 3 |
| PhysicsSetting26 | EYE透视Y | ParamEyeBallY | PupilY | 2 |
| PhysicsSetting27 | EYE透视X | ParamAngleX | PupilX | 2 |
| PhysicsSetting28 | <眼眶 | ParamEyeROpen, EyeSmile | REyes1, REyes2 | 3 |
| PhysicsSetting29 | >眼眶 | ParamEyeLOpen, EyeSmile | LEyes1, LEyes2 | 3 |
| PhysicsSetting30 | <睫毛 | ParamEyeROpen, EyeSmile | REyeLashX1, REyeLashX2 | 3 |
| PhysicsSetting31 | >睫毛 | ParamEyeLOpen, EyeSmile | LEyeLashX1, LEyeLashX2 | 3 |
| PhysicsSetting32 | > 眼球缩放 | ParamEyeLOpen | LEyeball3 | 2 |
| PhysicsSetting33 | < 眼球缩放 | ParamEyeROpen | REyeball3 | 2 |
| PhysicsSetting34 | >  眉毛上下link | ParamBrowLY | ParamBrowLY3 | 2 |
| PhysicsSetting35 | <  眉毛上下link | ParamBrowRY | ParamBrowRY3 | 2 |
| PhysicsSetting36 | <  眉毛上下 缓动 | ParamBrowRY, BrowInnerUp, REyeSquint | ParamBrowRY2 | 2 |
| PhysicsSetting37 | >  眉毛上下 缓动 | ParamBrowLY, BrowInnerUp, LEyeSquint | ParamBrowLY2 | 2 |
| PhysicsSetting38 | BrowAngle <<input | ParamBrowRY, ParamMouthForm | ParamBrowRAngleSmoothing | 2 |
| PhysicsSetting39 | BrowAngle <<output | ParamBrowRAngleSmoothing | ParamBrowRAngle | 2 |
| PhysicsSetting40 | BrowAngle >> | ParamBrowLY, ParamMouthForm | ParamBrowLAngleSmoothing | 2 |
| PhysicsSetting41 | BrowAngle >>output | ParamBrowLAngleSmoothing | ParamBrowLAngle | 2 |
| PhysicsSetting42 | <  Shock R | ParamBrowRY, ParamBrowRAngle | ShockR | 2 |
| PhysicsSetting43 | <  Shock L | ParamBrowLY, ParamBrowLAngle | ShockL | 2 |
| PhysicsSetting44 | L-高光特效 | ParamEyeLOpen, ShockL | LHighLight1, LHighLight2, LHighLight3 | 4 |
| PhysicsSetting45 | R-高光特效 | ParamEyeROpen, ShockR | RHighLight1, RHighLight2, RHighLight3 | 4 |
| PhysicsSetting46 | 情绪联动 | ParamBrowLY, ParamBrowRY, Paramshuiyin7 | Press | 2 |
| PhysicsSetting47 | 脸颊抖动 X | ParamMouthForm, CheeckPuff | CheeksWiggleXL, CheeksWiggleXR | 2 |
| PhysicsSetting48 | 脸颊抖动 Y | JawOpen, Mouthpucker, ParamMouthOpenY | CheeksWiggleY | 2 |
| PhysicsSetting49 | 脸颊抖动 XX | MouthX | CheeksWiggleX | 2 |
| PhysicsSetting50 | 前发X | ParamAngleX, ParamAngleZ | FrontHairX1, FrontHairX2, FrontHairX3, FrontHairX4 | 5 |
| PhysicsSetting51 | 前发Y | ParamBreath, ParamAngleY, Clothes2, LeanInput | FrontHairY1, FrontHairY2, FrontHairY3, FrontHairY4 | 5 |
| PhysicsSetting52 | 侧发R | ParamBreath, AngleX, AngleY, AngleZ | SideHairRX1, SideHairRX2, SideHairRX3, SideHairRBS | 5 |
| PhysicsSetting53 | 侧发L | ParamBodyAngleRX, ParamBreath | SideHairLX1, SideHairLX2, SideHairLX3, SideHairLBS | 4 |
| PhysicsSetting54 | 侧发X | ParamAngleX, ParamAngleZ | SideHairX1, SideHairX2, SideHairX3, SideHairX4 | 5 |
| PhysicsSetting55 | 侧发Y | ParamBreath, AngleY, Clothes2, LeanInput | SideHairY1, SideHairY2, SideHairY3, SideHairY4 | 5 |
| PhysicsSetting56 | 后侧发R | ParamBreath, AngleX, AngleY, AngleZ | LateSideHairY1, LateSideHairY2, LateSideHairY3, LateSideHairY4, LateSideHairY5 | 7 |
| PhysicsSetting57 | 后侧发L | ParamBreath, AngleX, AngleY, AngleZ | LateSideHairX1, LateSideHairX2, LateSideHairX3, LateSideHairX4, LateSideHairX5 | 6 |
| PhysicsSetting58 | 后发 Z | ParamAngleZ | LateHairZ | 2 |
| PhysicsSetting59 | 后发X | ParamAngleX, ParamAngleZ | LateHairX1, LateHairX2, LateHairX3, LateHairX4, LateHairX5 | 6 |
| PhysicsSetting60 | 短后发X | AngleX, AngleZ | ShortPonytailX1, ShortPonytailX2, ShortPonytailXBS, ShortPonytailXBS2 | 5 |
| PhysicsSetting61 | 后发Y | ParamBreath, AngleY, Clothes2, LeanInput | LateHairY1, LateHairY2, LateHairY3, LateHairY4, LateHairY5 | 6 |
| PhysicsSetting62 | 短后发Y | ParamBreath, AngleY, Clothes1 | ShortPonytailY, ShortPonytailY2, ShortPonytailYBS, ShortPonytailYBS2 | 5 |
| PhysicsSetting63 | 闪光 | ParamBreath | Shine, ShineX, ShineBIG | 4 |
| PhysicsSetting64 | 胸X | ParamBodyAngleX, ParamBodyAngleZ | ChestX1, ChestX2, ChestX3, ChestXBS | 5 |
| PhysicsSetting65 | 胸Y | ParamBreath, PositionY, ParamBodyAngleZ, LeanInput | ChestY1, ChestY2, ChestY3 | 5 |
| PhysicsSetting66 | 胸Y ↓ | ParamBreath, PositionY, LeanInput | ChestY4 | 2 |
| PhysicsSetting67 | 裙子X 摆动 | HipAngleX, ParamBodyAngleZ | SkirtX1, SkirtX2, SkirtX3, SkirtX4, SkirtSpecial, SkirtSpecial2 | 5 |
| PhysicsSetting68 | 裙子Y | PositionY, ParamBreath, LeanInput, Clothes1 | SkirtY, SkirtY2, SkirtY3, SkirtYBS, SkirtY4, SkirtY5 | 5 |
| PhysicsSetting69 | 裙子Y(2) | PositionY, ParamBreath, LeanInput, Clothes1 | SkirtY6, SkirtY7, SkirtY9, SkirtY8 | 5 |
| PhysicsSetting70 | 裙子层级 X | HipAngleZ, HipAngleX | SkirtLayerX1, SkirtLayerX2, SkirtLayerX3, SkirtLayerX4, SkirtLayerX5, SkirtLayerX6 | 7 |
| PhysicsSetting71 | 裙子层级 Y | HipAngleY | SkirtLayerY1, SkirtLayerY2, SkirtLayerY3, SkirtLayerY4, SkirtLayerY5 | 6 |
| PhysicsSetting72 | 左臂 | PositionY, ParamBreath, ParamBodyAngleX, ParamBodyAngleZ | LArm, LForearm, LWrist | 4 |
| PhysicsSetting73 | 右臂 | PositionY, ParamBreath, ParamBodyAngleX, ParamBodyAngleZ | RArm, RForearm, RWrist | 4 |
| PhysicsSetting74 | 左手 | PositionX, PositionY, PositionZ | LHand, LHand2 | 4 |
| PhysicsSetting75 | 右手 | PositionX, PositionY, PositionZ | RHand, RHand2 | 4 |
| PhysicsSetting76 | 左袖子 X | ParamBreath, ParamBodyAngleX, ParamBodyAngleZ | LSleeveX1, LSleeveX2, LSleeveX3 | 5 |
| PhysicsSetting77 | 左袖子 Y | ParamBreath, PositionY | LSleeveY, LSleeveY2, LSleeveY3 | 4 |
| PhysicsSetting78 | 右袖子 X | ParamBreath, ParamBodyAngleX, ParamBodyAngleZ | RSleeveX1, RSleeveX2, RSleeveX3 | 5 |
| PhysicsSetting79 | 右袖子 Y | ParamBreath, ParamBodyAngleY | RSleeveY1, RSleeveY2, RSleeveY3 | 4 |
| PhysicsSetting80 | 右飘带 | ParamBodyAngleX, PositionY, PositionZ | RRibbonX1, RRibbonX2, RRibbonX3, RRibbonX4 | 5 |
| PhysicsSetting81 | 左飘带 | ParamBodyAngleX, PositionY, PositionZ | LRibbonX1, LRibbonX2, LRibbonX3, LRibbonX4 | 5 |
| PhysicsSetting82 | <-兽耳Conrol OUT | ParamBrowRY | LControl | 2 |
| PhysicsSetting83 | <-兽耳 PH | LControl, AngleX, AngleY, AngleZ, ParamBreath, ParamEyeROpen | LEar1, LEar2, LEar3 | 4 |
| PhysicsSetting84 | >-兽耳Conrol OUT | ParamBrowLY | RControl | 2 |
| PhysicsSetting85 | >-兽耳 PH | RControl, AngleX, AngleY, AngleZ, ParamBreath, ParamEyeLOpen | REar1, REar2, REar3 | 4 |
| PhysicsSetting86 | < 兽耳 Flip a | LControl, ParamAngleX | RFlip | 2 |
| PhysicsSetting87 | > 兽耳 Flip a | RControl, ParamAngleX | LFlip | 2 |
| PhysicsSetting88 | < 兽耳 Flip b | ParamAngleY, LControl | RFlip2 | 2 |
| PhysicsSetting89 | > 兽耳 Flip b | ParamAngleY, RControl | LFlip2 | 2 |
| PhysicsSetting90 | Lip PH | ParamMouthForm, ParamMouthOpenY | LipPhysics1, LipPhysics2, LipPhysics3 | 4 |
| PhysicsSetting91 | 鼓脸 | CheeckPuff | CheeckPuffR, CheeckPuffL | 2 |
| PhysicsSetting92 | 鼓脸-附带效果 | CheeckPuff | CheeckPuff2 | 2 |
| PhysicsSetting93 | 花边 < | ParamBodyAngleX, PositionY, ParamBodyAngleZ, LeanInput | LaceRX, LaceRX2, LaceRX3 | 5 |
| PhysicsSetting94 | 花边 > | ParamBodyAngleX, PositionY, ParamBodyAngleZ, LeanInput | LaceLX1, LaceLX2, LaceLX3 | 5 |
| PhysicsSetting95 | < 头配饰 | ParamBreath, ParamAngleX, ParamAngleY, ParamAngleZ | RBowX1, RBowX2, RBowX3, RBowX4 | 5 |
| PhysicsSetting96 | < 头配饰 长 | ParamBreath, ParamAngleX, ParamAngleY, ParamAngleZ | RBowX8, RBowX5, RBowX6, RBowX7 | 5 |
| PhysicsSetting97 | > 头配饰 | ParamBreath, ParamAngleX, ParamAngleY, ParamAngleZ | LBowX1, LowX2, LBowX3, LBowX4 | 5 |
| PhysicsSetting98 | XBS | AngleX | AngleXbs, PoutOffsetXL, PoutOffsetXR | 2 |
| PhysicsSetting99 | YBS | AngleY | AngleYbs | 2 |
| PhysicsSetting100 | Emotion 过渡 | ParamBrowRY, ParamBrowLY, ParamMouthForm | Emotion2 | 2 |
| PhysicsSetting101 | Emotion | Emotion2 | Emotion | 2 |
| PhysicsSetting102 | 光效A-眨眼 | ParamEyeROpen | RParamGlowA | 2 |
| PhysicsSetting103 | 光效A-眨眼 L | ParamEyeLOpen | LParamGlowA | 2 |
| PhysicsSetting104 | 光效B-X | AngleY, ParamEyeBallX, ParamEyeBallY | RParamGlowB, LParamGlowB | 2 |
| PhysicsSetting105 | 光效C-y | AngleY, ParamEyeBallY | RParamGlowC | 2 |
| PhysicsSetting106 | 舌头-开闭 | ParamMouthOpenY | ParamTongueUpDown | 2 |
| PhysicsSetting107 | 舌头-开闭(2) | ParamMouthOpenY, ParamMouthForm | ParamTongueWidth | 2 |
| PhysicsSetting108 | 闪光 1 | ParamBreath, ParamAngleX, ParamAngleY, ParamAngleZ | KiraA, KiraB | 4 |
| PhysicsSetting109 | 闪光 2 | ParamBreath, ParamAngleX, ParamAngleY, ParamAngleZ | KiraC, KiraD | 3 |
| PhysicsSetting110 | 耳环> | ParamAngleX, ParamAngleY, ParamAngleZ | LJewelry1, LJewelry2, LJewelry3 | 4 |
| PhysicsSetting111 | 耳环< | ParamAngleX, ParamAngleY, ParamAngleZ | RJewelry1, RJewelry2, RJewelry3 | 4 |
| PhysicsSetting112 | 宝石反光-闪烁 | ParamBodyAngleX, ParamBodyAngleY, ParamBodyAngleZ | GemReflection | 2 |
| PhysicsSetting113 | 宝石高光-追踪 X | ParamBodyAngleX | GemHighlightx | 2 |
| PhysicsSetting114 | 宝石高光-追踪 Y | ParamBodyAngleY | GemHighlighty | 2 |
| PhysicsSetting115 | 头缎带 x | ParamAngleX, ParamAngleZ | ribbonX1, ribbonX2, ribbonX3, ribbonX4 | 5 |
| PhysicsSetting116 | 头缎带 Y | ParamAngleY, ParamBreath | ribbonY1, ribbonY2, ribbonY3, ribbonY4 | 5 |
| PhysicsSetting117 | 帽子 X | ParamAngleX, ParamAngleZ | Hat_XA, Hat_XB, Hat_XC | 5 |
| PhysicsSetting118 | 帽子 Y | ParamAngleY, Clothes2, LeanInput | Hat_YA, Hat_YB, Hat_YC | 5 |
| PhysicsSetting119 | 帽子蕾丝边 X | ParamAngleX, ParamAngleZ | ribbonX5, ribbonX7, ribbonX6 | 4 |
| PhysicsSetting120 | 帽子蕾丝边 Y | ParamAngleY | ribbonY5, ribbonY6, ribbonY7 | 4 |
| PhysicsSetting121 | 帽子尖 ph | ParamAngleX, ParamAngleY, ParamAngleZ | Hat2pha, Hat2phB, Hat2phC, Hat2phD | 5 |
| PhysicsSetting122 | 外套花边XZ | ParamBodyAngleX, ParamBodyAngleZ | LaceX1, LaceX2, LaceX3 | 5 |
| PhysicsSetting123 | 外套花边Y | ParamBodyAngleY | LaceY1, LaceY2, LaceY3 | 5 |
| PhysicsSetting124 | 动作手 Z | ParamBodyAngleZ | Param25 | 2 |
| PhysicsSetting125 | Lean 缓动 | LeanInput | Param54 | 2 |
| PhysicsSetting126 | 并腿 | HipAngleX | Param33 | 2 |
| PhysicsSetting127 | 大小变透明参数 | Clothes2 | Param34 | 2 |
| PhysicsSetting128 | 手臂开关物理 | Movement1, Movement2, Movement3 | Param35 | 2 |
| PhysicsSetting129 | 左臂z | ParamBodyAngleZ | Param44 | 2 |
| PhysicsSetting130 | 尾巴 | ParamBreath, ParamBodyAngleX, ParamBodyAngleZ, LeanInput, Clothes2 | Param_Angle_Rotation84, Param_Angle_Rotation85, Param_Angle_Rotation86, Param_Angle_Rotation87, Param_Angle_Rotation88, Param52, Param_Angle_Rotation89 | 11 |
| PhysicsSetting131 | 狗尾巴物理 | Param42, ParamBodyAngleX, ParamBodyAngleY, ParamBodyAngleZ | Param45, Param46, Param47, Param48, Param49 | 6 |

## 7. 已有名称但未确认可用的内容

509 条参数名称里还包括翅膀开合、羽毛、飘花、生气符号、钱、话筒光、炸毛、身体抖动等。外部配置总计有 127 条参数记录未被 VTS 映射、表情、动画或物理输入输出引用，其中也包含分隔和辅助参数。没有找到这些名称对应的完整独立动作/触发链，因此不能把它们列为已配置可直接使用的特效。

全部 509 个参数 ID 都能在 moc3 的 ASCII 字符串中找到，说明名称并非仅存在于 cdi3；这仍不能证明每个参数都绑定可见图层或有有效关键形变。是否为残留参数、隐藏功能或可自行补动画的控制项，需要通过 Cubism Core 读取并渲染检查。

没有配置或未提供的内容：HitAreas 点击区域、鼠标跟随映射、手势识别触发、全身/双手实时追踪映射、热键音效、Twitch 触发、外部挂件、聊天/ASR/TTS/自主动作程序。items_pinned_to_model.json 的 Items 为空。没有 pose3 文件不代表没有姿态，现有姿态主要由参数和 motion3 控制。

## 8. 移植与使用要点

1. `model3.FileReferences` 只登记 moc3、5 张贴图、physics3、cdi3，没有 Expressions 或 Motions。按这个入口自动加载的普通 SDK 宿主不会仅凭该入口知道那 23 个表情和 8 个动作，需补清单或自行加载。VTS 用 vtube 配置中的文件名另行引用它们。
2. EyeBlink 组含 ParamEyeROpen/LOpen，但 VTS 的两条开眼映射均 UseBlinking=false，当前主要跟随眼部追踪；自动眨眼是宿主需决定的行为。
3. LipSync 组的 Ids 为空，不等于嘴型缺失；VTS 的面捕嘴和 5 元音通道完整。普通 SDK 的默认 LipSync 分组逻辑需补绑定，或直接驱动现有参数。
4. 自定义输入大小写要保持原样，例如 mouthSmileL、mouthSmileR、nosesNEER；模型中的 CheeckPuff、Mouthpucker 等也有非标准拼写。
5. ParamBrowLAngle/RAngle 同时受 VTS 输入和物理输出写入；ShockL/R 同时受待机曲线和物理影响。实现宿主更新顺序时应验证最终输出，不能只写参数后跳过物理。
6. 与 AI 对接所需的情绪决策、说话音频、嘴型提取、状态互斥和动作调度均由外部程序承担；本包只提供角色呈现资源。

## 9. 文件核验与验证边界

| 检查 | 结果 |
| --- | --- |
| 全部 JSON 可解析 | 36 / 36 |
| 入口及 VTS 文件引用 | 39 个引用均有唯一对应文件 |
| 所有被引用参数 ID | 均能在 cdi3 找到 |
| 物理统计与文件 Meta | 一致 |
| 动画分段/点数与文件 Meta | 全部一致 |
| 509 个参数 ID 的 moc3 字符串核对 | 全部存在 |
| moc3 SHA-256 | b708e7953db9deeb5bf783643255dee1f3bf20d24786bc287e72d07e1b1052e6 |
| 未执行 | Cubism 模型一致性校验、参数真实上下限读取、渲染、全部组合效果、实时面捕/麦克风/VBridger 连通性和帧率测量 |

未取得可用 Cubism Core 运行时，因此未把字符串/JSON 检查描述为加载或渲染通过。模型目录所有文件的 SHA-256、动画曲线解码结果和完整配置摘录已写入同目录 model-audit.json。

## 10. 包内使用规范

`live2d/DeepSeek/psd/默认已知｜大肥鱼免费模型 PSD 使用规范.txt` 允许建模学习、展示、衍生视频和展示自己实际完成的建模成果，并要求公开内容注明“原画：神宫凉子”。文件禁止冒认原画或官方完整模型为自己制作，以及擅自重新分发、转售原始 PSD 等行为。该文主要围绕 PSD 和衍生制作；未明确用途按原文件联系作者确认，不能由“免费”推导无限制授权。VTS 配置另有 WorkshopSharingForbidden=true。

## 附录 A：全部 509 条参数

“外部引用”指本次审计看到的文件引用；“未见”不代表 moc3 内部没有形变，也不代表参数无效。

### 开关（25 条）

| ID | 名称 | 外部引用 |
| --- | --- | --- |
| Paramshuiyin7 | -----下面是按键----- | physics_input |
| key1 | 1. 黑脸 | expression |
| key2 | 2. 落泪 | expression |
| key3 | 3. 圈圈眼 | expression, motion |
| key4 | 4. 爱心眼 | expression |
| key5 | 5. > <眼 | expression |
| key6 | 6. 屑屑眼 | expression |
| key7 | 7. 脸红 | expression |
| key8 | 8. 加载 | expression, motion |
| key9 | 9. 大牙 | expression |
| key10 | 10. 大钢盆 | expression |
| key11 | 11. 黑框眼镜 | expression |
| key12 | 12. 单片眼镜 | expression |
| key13 | 13. 流冷汗 | expression |
| Divider1 | ■■■■■■■■■■■■■ | 未见 |
| Movement1 | 1. 狗尾草 | physics_input, expression, motion |
| Movement2 | 2. 抚胸 | physics_input, motion |
| Movement3 | 3. 竖食指 | physics_input, expression, motion |
| Divider3 | ■■■■■■■■■■■■■ | 未见 |
| Clothes1 | 1. 长短裙切换 | physics_input, expression |
| Clothes2 | 2. 大小变 | physics_input, expression |
| Clothes3 | 3. 胸口衣服 | expression |
| Clothes4 | 4. 鞋子 | expression |
| Clothes5 | 5. 尾巴 | expression |
| Paramshuiyin8 | -----按键到此结束----- | 未见 |

### 身体轴（40 条）

| ID | 名称 | 外部引用 |
| --- | --- | --- |
| Param2 | 辅助参数 | 未见 |
| Param34 | 大小变透明参数 | physics_output |
| Param | 大小变位置 | 未见 |
| ParamAngleX | AngleX | physics_input, physics_output |
| ParamAngleY | AngleY | physics_input, physics_output |
| ParamAngleZ | AngleZ | physics_input, physics_output |
| AngleXbs | 角度 Xbs | physics_output |
| AngleYbs | 角度 Ybs | physics_output |
| AngleXbs3 | 角度 Xbs +15 | 未见 |
| AngleXbs2 | 角度 Xbs -15 | 未见 |
| AngleYbs2 | 角度 Ybs | 未见 |
| ParamBodyAngleX | 胸腔　X | physics_input, physics_output |
| ParamBodyAngleY | 胸腔　Y | physics_input, physics_output |
| Param50 | Lean Y | physics_output |
| Param53 | Lean Y 2 | physics_output |
| Param54 | Lean Y 3 | physics_output |
| ParamBodyAngleZ | 胸腔　Z | physics_input, physics_output |
| HipAngleZ | 盆骨Z | physics_input, physics_output |
| LEGAngleZ2 | 双腿 Z | physics_output |
| HipAngleX | 盆骨X | physics_input, physics_output |
| HipAngleY | 盆骨Y | physics_input, physics_output |
| ShoulderY | 肩膀Y | physics_output |
| ShoulderZ | 肩膀Z | physics_output |
| ShoulderX | 肩膀X | 未见 |
| ShoulderYy | 肩头Y | 未见 |
| Divider19 | ■■■■■身体物理■■■■ | 未见 |
| HipZ1 | 盆骨 Z1 | physics_output |
| HipZ2 | 盆骨 Z2 | physics_output |
| ParamBodyAngleX2 | □胸腔　X | physics_output |
| ParamBodyAngleY2 | □胸腔　Y | physics_output |
| HipAngleX2 | □盆骨  X | physics_output |
| ParamHipAngleZ | □ 盆骨  Z | physics_output |
| ParamHipAngleZ2 | □ 盆骨  Z 2 | physics_output |
| HipAngleYUP | □盆骨Yup | physics_output |
| HipAngleYDOWN | □盆骨Ydown | physics_output |
| HipAngleXq | 盆骨Xq | 未见 |
| Param33 | 并腿 | physics_output |
| ParamBodyAngleRX | 身体位移RX | physics_input, physics_output |
| ParamBodyAngleRY | 身体位移RY | 未见 |
| ParamBodyAngleRZ | 身体位移RZ | 未见 |

### 控制器（10 条）

| ID | 名称 | 外部引用 |
| --- | --- | --- |
| AngleX | OX | physics_input, vts_output, motion |
| AngleY | OY | physics_input, vts_output, motion |
| AngleZ | OZ | physics_input, vts_output, motion |
| PositionX | OPX | physics_input, vts_output, motion |
| PositionY | OPY | physics_input, vts_output, motion |
| PositionZ | OPYZ | physics_input, vts_output, motion |
| LeanInput | Lean Input | physics_input, expression |
| Emotion | Emotion | physics_output |
| Emotion2 | Emotion 过渡 | physics_input, physics_output |
| IDLE | IDLE | 未见 |

### 眼睛（30 条）

| ID | 名称 | 外部引用 |
| --- | --- | --- |
| EyeSmile | 微笑 | physics_input, vts_output |
| ParamEyeBallX | 眼珠 X | physics_input, vts_output |
| ParamEyeBallY | 眼珠 Y | physics_input, vts_output |
| PupilX | 瞳孔透视X | physics_output |
| PupilY | 瞳孔透视Y | physics_output |
| BrowInnerUp | BrowInnerUp | physics_input, vts_output |
| Divider4 | ■■■■■■■■右眼■■■■■■ | 未见 |
| RParamGlowA | <光效A | physics_output |
| RParamGlowB | <光效B | physics_output |
| RParamGlowC | <光效C | physics_output |
| ParamEyeROpen | 右眼  开闭 | physics_input, vts_output, motion |
| ParamBrowRY | 右眉上下 | physics_input, vts_output |
| ParamBrowRAngleSmoothing | 右眉 角度 过渡 | physics_input, physics_output |
| ParamBrowRAngle | 右眉　角度 | physics_input, physics_output, vts_output |
| ParamBrowRY2 | 右眉上下缓动 | physics_output |
| ParamBrowRY3 | 右眉联动 x | physics_output |
| ShockR | Shock R | physics_input, physics_output, motion |
| REyeSquint | R-Eye Squint | physics_input, vts_output |
| Divider5 | ■■■■■■■■左眼■■■■■■ | 未见 |
| LParamGlowA | >光效A | physics_output |
| LParamGlowB | >光效B | physics_output |
| LParamGlowC | >光效C | 未见 |
| ParamEyeLOpen | 左眼　开闭 | physics_input, vts_output, motion |
| ParamBrowLY | 左眉上下 | physics_input, vts_output |
| ParamBrowLAngleSmoothing | 左眉 角度 过渡 | physics_input, physics_output |
| ParamBrowLAngle | 左眉　角度 | physics_input, physics_output, vts_output |
| ParamBrowLY2 | 左眉上下缓动 | physics_output |
| ParamBrowLY3 | 左眉联动 x | physics_output |
| ShockL | Shock L | physics_input, physics_output, motion |
| LEyeSquint | L-Eye Squint | physics_input, vts_output |

### 嘴（5 条）

| ID | 名称 | 外部引用 |
| --- | --- | --- |
| Divider8 | ■■■■■■■■嘴■■■■■■ | 未见 |
| ParamMouthForm | 嘴　变形 | physics_input, vts_output, motion |
| ParamMouthOpenY | 嘴　张开和闭合 | physics_input, vts_output, motion |
| JawOpen | 下巴开闭 | physics_input, vts_output, motion |
| TongueOut | 伸舌头 | vts_output |

### VB（24 条）

| ID | 名称 | 外部引用 |
| --- | --- | --- |
| Divider31 | ■■■■■■■■VB■■■■ | 未见 |
| MouthX | MouthX | physics_input, vts_output |
| MouthSmile_L | MouthSmile_L | vts_output |
| MouthSmile_R | MouthSmile_R | vts_output |
| Press | 用力 | physics_output |
| Mouthpucker | 撅嘴 | physics_input, vts_output |
| MouthFunnel | 漏斗嘴 | vts_output |
| MouthPuckerWiden | 嘴宽窄 | vts_output |
| CheeckPuff | 鼓脸 | physics_input, vts_output |
| CheeckPuff2 | 鼓脸-变化 | physics_output |
| CheeckPuffR | < 鼓脸 | physics_output |
| CheeckPuffL | > 鼓脸 | physics_output |
| MouthPressLipOpen | MouthPressLipOpen | vts_output |
| MouthRollUpper | MouthRollUpper | vts_output |
| MouthRollLower | MouthRollLower | vts_output |
| NoseNeer | NosePositionY | vts_output |
| PoutOffsetXL | 努嘴位移 X>> | physics_output |
| PoutOffsetXR | 努嘴位移 X<< | physics_output |
| ParamSilence | ParamSilence | vts_output |
| ParamA | A | vts_output |
| ParamI | I | vts_output |
| ParamU | U | vts_output |
| ParamE | E | vts_output |
| ParamO | O | vts_output |

### 五官物理（34 条）

| ID | 名称 | 外部引用 |
| --- | --- | --- |
| Divider6 | <<<<<<物理■■■■■■ | 未见 |
| RShiftbuffer | <变化缓冲 | 未见 |
| RColorshift | <眼睛颜色 | 未见 |
| REyeball1 | <眼珠 1 | physics_output |
| REyeball2 | <眼珠 2 | physics_output |
| REyeball3 | <眼珠 3 | physics_output |
| REyeLashX1 | 右眼睫毛X1 | physics_output |
| REyeLashX2 | 右眼睫毛X2 | physics_output |
| REyes1 | 眼眶1 | physics_output |
| REyes2 | 眼眶2 | physics_output |
| RHighLight1 | 右眼高光1 | physics_output |
| RHighLight2 | 右眼高光2 | physics_output |
| RHighLight3 | 右眼高光3 | physics_output |
| Divider7 | ■■■■■■物理>>>>>> | 未见 |
| LEyeball1 | >眼珠 1 | physics_output |
| LEyeball2 | >眼珠 2 | physics_output |
| LEyeball3 | >眼珠 3 | physics_output |
| LEyes1 | 眼眶1 | physics_output |
| LEyes2 | 眼眶2 | physics_output |
| LEyeLashX1 | 左眼睫毛X1 | physics_output |
| LEyeLashX2 | 左眼睫毛X2 | physics_output |
| LHighLight1 | 左眼高光1 | physics_output |
| LHighLight2 | 左眼高光2 | physics_output |
| LHighLight3 | 左眼高光3 | physics_output |
| Divider15 | ■■■ 口物理 ■■■ | 未见 |
| CheeksWiggleX | 脸盘抖动X | physics_output |
| CheeksWiggleXR | 脸盘抖动X< | physics_output |
| CheeksWiggleXL | 脸盘抖动X> | physics_output |
| CheeksWiggleY | 脸盘抖动Y | physics_output |
| LipPhysics1 | 嘴唇物理1 | physics_output |
| LipPhysics2 | 嘴唇物理2 | physics_output |
| LipPhysics3 | 嘴唇物理3 | physics_output |
| ParamTongueUpDown | 舌头上下 | physics_output |
| ParamTongueWidth | 舌头宽窄 | physics_output |

### 前发物理（10 条）

| ID | 名称 | 外部引用 |
| --- | --- | --- |
| Divider11 | ■■■■■■■■头发物理■■■ | 未见 |
| FrontHairZ | 前发Z | 未见 |
| FrontHairX1 | 前发X1 | physics_output |
| FrontHairX2 | 前发X2 | physics_output |
| FrontHairX3 | 前发X3 | physics_output |
| FrontHairX4 | 前发X4 | physics_output |
| FrontHairY1 | 前发Y1 | physics_output |
| FrontHairY2 | 前发Y2 | physics_output |
| FrontHairY3 | 前发Y3 | physics_output |
| FrontHairY4 | 前发Y4 | physics_output |

### 侧发物理（16 条）

| ID | 名称 | 外部引用 |
| --- | --- | --- |
| SideHairX1 | 侧发X1 | physics_output |
| SideHairX2 | 侧发X2 | physics_output |
| SideHairX3 | 侧发X3 | physics_output |
| SideHairX4 | 侧发X4 | physics_output |
| SideHairY1 | 侧发Y1 | physics_output |
| SideHairY2 | 侧发Y2 | physics_output |
| SideHairY3 | 侧发Y3 | physics_output |
| SideHairY4 | 侧发Y4 | physics_output |
| SideHairLX1 | 侧发LX1 | physics_output |
| SideHairRX1 | 侧发RX1 | physics_output |
| SideHairRX2 | 侧发RX2 | physics_output |
| SideHairRX3 | 侧发RX3 | physics_output |
| SideHairRBS | 侧发RBS | physics_output |
| SideHairLX2 | 侧发LX2 | physics_output |
| SideHairLX3 | 侧发LX3 | physics_output |
| SideHairLBS | 侧发LBS | physics_output |

### 后发物理（31 条）

| ID | 名称 | 外部引用 |
| --- | --- | --- |
| LateSideHairX1 | 后侧发X1 | physics_output |
| LateSideHairX2 | 后侧发X2 | physics_output |
| LateSideHairX3 | 后侧发X3 | physics_output |
| LateSideHairX4 | 后侧发X4 | physics_output |
| LateSideHairX5 | 后侧发X5 | physics_output |
| LateSideHairXBS | 后侧发XBS | 未见 |
| LateSideHairY1 | 后侧发Y1 | physics_output |
| LateSideHairY2 | 后侧发Y2 | physics_output |
| LateSideHairY3 | 后侧发Y3 | physics_output |
| LateSideHairY4 | 后侧发Y4 | physics_output |
| LateSideHairY5 | 后侧发Y5 | physics_output |
| LateSideHairYbs | 后侧发Ybs | 未见 |
| LateHairZ | 后发 Z | physics_output |
| LateHairX1 | 后发X1 | physics_output |
| LateHairX2 | 后发X2 | physics_output |
| LateHairX3 | 后发X3 | physics_output |
| LateHairX4 | 后发X4 | physics_output |
| LateHairX5 | 后发X5 | physics_output |
| LateHairY1 | 后发Y1 | physics_output |
| LateHairY2 | 后发Y2 | physics_output |
| LateHairY3 | 后发Y3 | physics_output |
| LateHairY4 | 后发Y4 | physics_output |
| LateHairY5 | 后发Y5 | physics_output |
| ShortPonytailX1 | 短马尾X1 | physics_output |
| ShortPonytailX2 | 短马尾X2 | physics_output |
| ShortPonytailXBS | 短马尾XBS | physics_output |
| ShortPonytailXBS2 | 短马尾XBS2 | physics_output |
| ShortPonytailY | 短马尾Y | physics_output |
| ShortPonytailY2 | 短马尾Y2 | physics_output |
| ShortPonytailYBS | 短马尾YBS | physics_output |
| ShortPonytailYBS2 | 短马尾YBS2 | physics_output |

### 手臂（44 条）

| ID | 名称 | 外部引用 |
| --- | --- | --- |
| Divider9 | ■■■■■■■■左手臂■■■■ | 未见 |
| Param35 | 手臂开关物理 | physics_output |
| Param44 | 左臂Z | physics_output |
| LArm | 左大臂 | physics_output |
| LForearm | 左小臂 | physics_output |
| LWrist | 左手腕 | physics_output |
| LHand | 左手指 | physics_output |
| LHand2 | 左手指 | physics_output |
| LSleeveX1 | 左袖子X1 | physics_output |
| LSleeveX2 | 左袖子X2 | physics_output |
| LSleeveX3 | 左袖子X3 | physics_output |
| LSleeveY | 左袖子Y1 | physics_output |
| LSleeveY2 | 左袖子Y2 | physics_output |
| LSleeveY3 | 左袖子Y3 | physics_output |
| LRibbonX1 | 左飘带X1 | physics_output |
| LRibbonX2 | 左飘带X2 | physics_output |
| LRibbonX3 | 左飘带X3 | physics_output |
| LRibbonX4 | 左飘带X4 | physics_output |
| LRibbonY1 | 左飘带Y1 | 未见 |
| LRibbonY2 | 左飘带Y2 | 未见 |
| LRibbonY3 | 左飘带Y3 | 未见 |
| LRibbonY4 | 左飘带Y4 | 未见 |
| Divider10 | ■■■■■■■■右手臂■■■■ | 未见 |
| Param25 | 右手Z | physics_output |
| RArm | 右大臂 | physics_output |
| RForearm | 右小臂 | physics_output |
| RWrist | 右手腕 | physics_output |
| RHand | 右手指 | physics_output |
| RHand2 | 右手指 | physics_output |
| RSleeveX1 | 右袖子X1 | physics_output |
| RSleeveX2 | 右袖子X2 | physics_output |
| RSleeveX3 | 右袖子X3 | physics_output |
| RSleeveX4 | 右袖子X4 | 未见 |
| RSleeveY1 | 右袖子Y1 | physics_output |
| RSleeveY2 | 右袖子Y2 | physics_output |
| RSleeveY3 | 右袖子Y3 | physics_output |
| RRibbonX1 | 右飘带X1 | physics_output |
| RRibbonX2 | 右飘带X2 | physics_output |
| RRibbonX3 | 右飘带X3 | physics_output |
| RRibbonX4 | 右飘带X4 | physics_output |
| RRibbonY1 | 右飘带Y1 | 未见 |
| RRibbonY2 | 右飘带Y2 | 未见 |
| RRibbonY3 | 右飘带Y3 | 未见 |
| RRibbonY4 | 右飘带Y4 | 未见 |

### 胸（9 条）

| ID | 名称 | 外部引用 |
| --- | --- | --- |
| Divider18 | ■■■■■■■■胸■■■■ | 未见 |
| ChestX1 | 胸X1 | physics_output |
| ChestX2 | 胸X2 | physics_output |
| ChestX3 | 胸X3 | physics_output |
| ChestXBS | 胸XBS | physics_output |
| ChestY1 | 胸Y1 | physics_output |
| ChestY2 | 胸Y2 | physics_output |
| ChestY3 | 胸Y3 | physics_output |
| ChestY4 | 胸↓ | physics_output |

### 头配饰（47 条）

| ID | 名称 | 外部引用 |
| --- | --- | --- |
| Divider12 | ■■■■■■■■头配饰■■■■ | 未见 |
| Shine | 闪光 | physics_output |
| ShineX | 闪光旋转 | physics_output |
| ShineBIG | 闪光大小 | physics_output |
| Hat_XA | 帽子 XA | physics_output |
| Hat_XB | 帽子 XB | physics_output |
| Hat_XC | 帽子 XC | physics_output |
| Hat_YA | 帽子 YA | physics_output |
| Hat_YB | 帽子 YB | physics_output |
| Hat_YC | 帽子 YC | physics_output |
| RBowX8 | <-配饰X1 | physics_output |
| RBowX5 | <-配饰X2 | physics_output |
| RBowX6 | <-配饰X3 | physics_output |
| RBowX7 | <-配饰X4 | physics_output |
| RBowX1 | <-配饰X1 | physics_output |
| RBowX2 | <-配饰X2 | physics_output |
| RBowX3 | <-配饰X3 | physics_output |
| RBowX4 | <-配饰X4 | physics_output |
| LBowX1 | >-配饰X1 | physics_output |
| LowX2 | >-配饰X2 | physics_output |
| LBowX3 | >-配饰X3 | physics_output |
| LBowX4 | >-配饰X4 | physics_output |
| RJewelry1 | < 耳环 A | physics_output |
| RJewelry2 | < 耳环 B | physics_output |
| RJewelry3 | < 耳环 C | physics_output |
| LJewelry1 | > 耳环 A | physics_output |
| LJewelry2 | > 耳环 B | physics_output |
| LJewelry3 | > 耳环 C | physics_output |
| Divider23 | ■■■■■■■■■■■■ | 未见 |
| ribbonX1 | 缎带X1 | physics_output |
| ribbonX2 | 缎带X2 | physics_output |
| ribbonX3 | 缎带X3 | physics_output |
| ribbonX4 | 缎带X4 | physics_output |
| ribbonY1 | 缎带Y1 | physics_output |
| ribbonY2 | 缎带Y2 | physics_output |
| ribbonY3 | 缎带Y3 | physics_output |
| ribbonY4 | 缎带Y4 | physics_output |
| ribbonX5 | 缎带X1 | physics_output |
| ribbonX7 | 缎带X2 | physics_output |
| ribbonX6 | 缎带X3 | physics_output |
| ribbonY5 | 缎带Y1 | physics_output |
| ribbonY6 | 缎带Y2 | physics_output |
| ribbonY7 | 缎带Y3 | physics_output |
| Hat2pha | 帽子尖 PHA | physics_output |
| Hat2phB | 帽子尖 PHB | physics_output |
| Hat2phC | 帽子尖 PHC | physics_output |
| Hat2phD | 帽子尖 PHD | physics_output |

### 裙子（29 条）

| ID | 名称 | 外部引用 |
| --- | --- | --- |
| Divider20 | ■■■■■■■■裙子■■■■ | 未见 |
| SkirtX1 | 裙X1 | physics_output |
| SkirtX2 | 裙X2 | physics_output |
| SkirtX3 | 裙X3 | physics_output |
| SkirtX4 | 裙X4 | physics_output |
| SkirtSpecial | 裙X特殊 | physics_output |
| SkirtSpecial2 | 裙X特殊2 | physics_output |
| SkirtY | 裙Y | physics_output |
| SkirtY2 | 裙Y2 | physics_output |
| SkirtY3 | 裙Y3 | physics_output |
| SkirtY4 | 裙Y4 | physics_output |
| SkirtY5 | 裙Y5 | physics_output |
| SkirtYBS | 裙YBS | physics_output |
| SkirtY6 | 裙Y | physics_output |
| SkirtY7 | 裙Y2 | physics_output |
| SkirtY9 | 裙Y3 | physics_output |
| SkirtY8 | 裙Y4 | physics_output |
| SkirtLayerX1 | 裙子层级X1 | physics_output |
| SkirtLayerX2 | 裙子层级X2 | physics_output |
| SkirtLayerX3 | 裙子层级X3 | physics_output |
| SkirtLayerX4 | 裙子层级X4 | physics_output |
| SkirtLayerX5 | 裙子层级X5 | physics_output |
| SkirtLayerX6 | 裙子层级X6 | physics_output |
| SkirtLayerY1 | 裙子层级Y1 | physics_output |
| SkirtLayerY2 | 裙子层级Y2 | physics_output |
| SkirtLayerY3 | 裙子层级Y3 | physics_output |
| SkirtLayerY4 | 裙子层级Y4 | physics_output |
| SkirtLayerY5 | 裙子层级Y5 | physics_output |
| SkirtLayerY6 | 裙子层级Y6 | 未见 |

### 上衣（13 条）

| ID | 名称 | 外部引用 |
| --- | --- | --- |
| Divider14 | ■■■■■■■■上衣■■■■ | 未见 |
| LaceRX | < 花边X1 | physics_output |
| LaceRX2 | < 花边X2 | physics_output |
| LaceRX3 | < 花边X3 | physics_output |
| LaceLX1 | > 花边X1 | physics_output |
| LaceLX2 | > 花边LX2 | physics_output |
| LaceLX3 | > 花边LX3 | physics_output |
| LaceX1 | 缎带X1 | physics_output |
| LaceX2 | 缎带X2 | physics_output |
| LaceX3 | 缎带X3 | physics_output |
| LaceY1 | 缎带Y1 | physics_output |
| LaceY2 | 缎带Y2 | physics_output |
| LaceY3 | 缎带Y3 | physics_output |

### 兽耳（13 条）

| ID | 名称 | 外部引用 |
| --- | --- | --- |
| Divider13 | ■■■■■■■■兽耳■■■■ | 未见 |
| LControl | < Control | physics_input, physics_output |
| RFlip | < Flip x | physics_output |
| RFlip2 | < Flip y | physics_output |
| LEar1 | <兽耳PHA | physics_output |
| LEar2 | <兽耳PHB | physics_output |
| LEar3 | <兽耳PHC | physics_output |
| RControl | > Control | physics_input, physics_output |
| LFlip | > Flip x | physics_output |
| LFlip2 | > Flip y | physics_output |
| REar1 | >兽耳PHA | physics_output |
| REar2 | >兽耳PHB | physics_output |
| REar3 | >兽耳PHC | physics_output |

### 待机动画（76 条）

| ID | 名称 | 外部引用 |
| --- | --- | --- |
| Divider33 | ■■■■■■■■动画■■■■ | 未见 |
| Param11 | 呆滞 | motion |
| MicroGlows | 话筒光 | 未见 |
| SweatBurst1 | 冒汗1 | motion |
| SweatBurst2 | 冒汗1 开关 | motion |
| SweatBurst3 | 冒汗2 | motion |
| SweatBurst4 | 冒汗2 开关 | motion |
| SweatBurst5 | 冒汗3 | 未见 |
| SweatBurst6 | 冒汗3 开关 | 未见 |
| Sweat1 | 流汗1 | 未见 |
| Sweat2 | 流汗2 | 未见 |
| WingOpenClose | 翅膀开合 | 未见 |
| WingSpread | 翅膀舒展 | 未见 |
| FeatherPhysics1 | 羽毛物理1 | 未见 |
| FeatherPhysics2 | 羽毛物理2 | 未见 |
| WingRotation | 翅膀旋转 | 未见 |
| WingOpenClose2 | 翅膀开合 | 未见 |
| WingSpread2 | 翅膀舒展 | 未见 |
| FeatherPhysics3 | 羽毛物理1 | 未见 |
| FeatherPhysics4 | 羽毛物理2 | 未见 |
| WingRotation2 | 翅膀旋转 | 未见 |
| Param140 | 加载 | 未见 |
| Param137 | 炸毛 | 未见 |
| Param139 | 炸毛移动 | 未见 |
| Param138 | 身体抖动 | 未见 |
| SHOCKEYE | SHOCK EYE | 未见 |
| Param135 | 爱心UD | 未见 |
| Param6 | 爱心弹1 | 未见 |
| Param7 | 爱心弹2 | 未见 |
| Param132 | 泪花 A | 未见 |
| Param133 | 泪花 B | 未见 |
| Angry | 生气 | 未见 |
| Param136 | 钱 | 未见 |
| Angry2 | 生气 | 未见 |
| Angry3 | 生气 | 未见 |
| AniEyerolling | 蚊香眼 | 未见 |
| Ani1 | 动画1 | 未见 |
| SWITCHA | 开关A | 未见 |
| Ani2 | 动画2 | 未见 |
| Param141 | 闪光 1 | 未见 |
| Param142 | 闪光 2 | 未见 |
| Divider24 | ■■■■■■逸散的光点■■■■ | 未见 |
| F1Anikey | 花1动画开关 | 未见 |
| F2Anikey | 花2动画开关 | 未见 |
| F3Anikey | 花3动画开关 | 未见 |
| Colorflicker5 | 1眼光显隐 | 未见 |
| Glintshift5 | 1眼光移动 | 未见 |
| Colorflicker6 | 2眼光显隐 | 未见 |
| Glintshift6 | 2眼光移动 | 未见 |
| Colorflicker7 | 3眼光显隐 | 未见 |
| Glintshift8 | 3眼光移动 | 未见 |
| Colorflicker8 | 4眼光显隐 | 未见 |
| Glintshift7 | 4眼光移动 | 未见 |
| Divider25 | ■■■■■■飘花特效■■■■ | 未见 |
| LittleFlower1 | 小花飘落1 | 未见 |
| LittleFlower2 | 小花显隐1 | 未见 |
| LittleFlower9 | 小花左右 | 未见 |
| LittleFlower3 | 小花飘落2 | 未见 |
| LittleFlower4 | 小花显隐2 | 未见 |
| LittleFlower10 | 小花左右 | 未见 |
| LittleFlower5 | 小花飘落3 | 未见 |
| LittleFlower6 | 小花显隐3 | 未见 |
| LittleFlower11 | 花形变 | 未见 |
| LittleFlower13 | 花旋转 | 未见 |
| LittleFlower12 | 花左右 | 未见 |
| Divider28 | ■■■■■■生气■■■■ | 未见 |
| Param12 | 生气1 | 未见 |
| Param13 | 生气2 | 未见 |
| AngryMove | 生气移动 | 未见 |
| AngryMove3 | 生气显隐 | 未见 |
| AngryMove2 | 生气伸缩 | 未见 |
| AngryMove4 | 生气伸缩2 | 未见 |
| AngryMove5 | 生气移动 | 未见 |
| AngryMove8 | 生气显隐 | 未见 |
| AngryMove6 | 生气伸缩 | 未见 |
| AngryMove7 | 生气伸缩2 | 未见 |

### 眼睛动画（16 条）

| ID | 名称 | 外部引用 |
| --- | --- | --- |
| Divider16 | ■■■■■■■■眼睛动画■■■■■■ | 未见 |
| Divider22 | ■■■■■■■■动画■■■■ | motion |
| Param31 | 泪花闪烁 | motion |
| Param32 | 高光闪烁 | motion |
| Param27 | < 流泪-膨胀 | motion |
| Param28 | < 流泪-滴下1 | motion |
| RCry | <落泪 | motion |
| RCryKey | <落泪开关 | 未见 |
| RCry2 | <落泪 涌出 | 未见 |
| Param29 | > 流泪-膨胀 | motion |
| Param30 | > 流泪-滴下1 | motion |
| LCry | >落泪 | motion |
| LCryKey | >落泪开关 | 未见 |
| LCry3 | >落泪 涌出 | 未见 |
| Startwinkle | 星星闪烁 | motion |
| Startwinkle2 | 星星闪烁2 | 未见 |

### 尾巴（11 条）

| ID | 名称 | 外部引用 |
| --- | --- | --- |
| Param55 | 光1 | motion |
| Param56 | 光2 | motion |
| Param58 | 光3 | motion |
| Param57 | 光4 | motion |
| Param52 | 尾巴翻面 | physics_output |
| Param_Angle_Rotation84 | [0]尾巴 | physics_output |
| Param_Angle_Rotation85 | [1]尾巴 | physics_output |
| Param_Angle_Rotation86 | [2]尾巴 | physics_output |
| Param_Angle_Rotation87 | [3]尾巴 | physics_output |
| Param_Angle_Rotation88 | [4]尾巴 | physics_output |
| Param_Angle_Rotation89 | [5]尾巴 | physics_output |

### 动画参数（18 条）

| ID | 名称 | 外部引用 |
| --- | --- | --- |
| Param51 | 草放大 | 未见 |
| Param45 | 草物理1 | physics_output |
| Param46 | 草物理2 | physics_output |
| Param47 | 草物理3 | physics_output |
| Param48 | 草物理4 | physics_output |
| Param49 | 草物理5 | physics_output |
| Param37 | 动画开关 | 未见 |
| Param38 | 动画 双手开关 | 未见 |
| Param40 | 竖手指 大臂无缝用 | motion |
| Param36 | R大臂z | motion |
| Param39 | 大臂透视 | motion |
| Param41 | R小臂 Z | motion |
| Param42 | R手腕 Z | physics_input, motion |
| Param43 | R 食指 | motion |
| Param62 | L 大臂z | motion |
| Param59 | 大臂透视 | motion |
| Param60 | L小臂 Z | motion |
| Param61 | L手腕 Z | motion |

### 闪光（7 条）

| ID | 名称 | 外部引用 |
| --- | --- | --- |
| GemReflection | 宝石反光 | physics_output |
| GemHighlightx | 宝石高光 x | physics_output |
| GemHighlighty | 宝石高光 y | physics_output |
| KiraA | 闪光 A | physics_output |
| KiraB | 闪光 B | physics_output |
| KiraC | 闪光 C | physics_output |
| KiraD | 闪光 D | physics_output |

### 未分组（1 条）

| ID | 名称 | 外部引用 |
| --- | --- | --- |
| ParamBreath | 呼吸 | physics_input, vts_output |

## 附录 B：全部 148 条部件显示记录

这是 cdi3.Parts 显示名称清单，不能直接当作网格计数或可点击区域。

| ID | 名称 |
| --- | --- |
| Part67 | 359大肥鱼公皮补拆-导入2.psd |
| Part137 | 359大肥鱼公皮补拆-导入.psd |
| Part116 | 新建画布359大肥鱼公皮2.psd |
| Part99 | 头 |
| Part64 | 脸黑 |
| Part66 | 脸红 |
| Part10 | 鼻子 |
| Part8 | 阴影 |
| Part47 | 厚度头发 |
| Part81 | 身体 |
| Part162 | 后发 |
| Part26 | 按键 |
| Part19 | 按键 |
| Part77 | 眼镜 |
| Part45 | 渐变圆.png |
| Part | 发饰 |
| Part46 | 鼻子 |
| Part2 | 前发 |
| Part9 | 五官 |
| Part15 | 脸 |
| Part111 | 五官 |
| Part154 | 脸 |
| Part155 | 厚度头发 |
| Part82 | 领子 |
| Part117 | 肩膀花边-变q |
| Part85 | 胸衣 |
| Part88 | 胸 |
| Part54 | 竖食指 |
| Part156 | 耳朵 |
| Part161 | 女仆发饰 |
| Part89 | 腰部衣服 |
| Part96 | 脖子 |
| Part97 | 短裙 |
| Part107 | 长裙 |
| Part113 | 上身 |
| Part114 | 腿 |
| Part125 | 短裙后 |
| Part126 | 长裙后 |
| Part127 | 手臂 |
| Part135 | 身后蝴蝶结 |
| Part136 | 尾巴 |
| Part163 | 组 9 |
| Part32 | 组 10 |
| Part33 | 组 11 |
| Part34 | 后脑勺 |
| Part27 | 表情 |
| Part80 | 大钢盆 |
| Part42 | 动作 |
| Part57 | 表情 |
| Part73 | 黑矿眼镜 |
| Part74 | 加载 |
| Part75 | 大牙 |
| Part3 | 呆毛 |
| Part4 | 前发1 |
| Part5 | 侧发 |
| Part6 | 前发3 |
| Part7 | 前发4 |
| Part109 | 阴影 |
| Part40 | 左眼 |
| Part11 | 左眼 |
| Part147 | 下侧发 |
| Part12 | 嘴 |
| Part115 | 左眼 |
| Part142 | 左眼 |
| Part149 | 嘴 |
| Part83 | 组 2 |
| Part84 | 组 15 |
| Part86 | 胸 |
| Part87 | 花边 |
| Part55 | 组 21 |
| Part56 | 组 9 2 |
| Part157 | 耳朵→ |
| Part159 | 耳朵← |
| Part90 | 钢笔 |
| Part91 | 组 16 |
| Part92 | 文件夹1 |
| Part93 | 肩膀花边 |
| Part94 | 大臂袖子 |
| Part68 | 大臂袖子 |
| Part95 | 文件夹2 |
| Part98 | 组 12 2 |
| Part100 | 文件夹4(2) |
| Part101 | 文件夹4 |
| Part102 | 文件夹6(2) |
| Part104 | 文件夹6 |
| Part106 | 组 18 |
| Part108 | 长裙蝴蝶结 |
| Part110 | 文件夹7 |
| Part112 | 文件夹8 |
| Part30 | 左腿 |
| Part18 | 右腿 |
| Part129 | 手臂→ |
| Part128 | 手臂→ |
| ArtMesh668_Skinning | 图层 124(蒙皮) |
| ArtMesh669_Skinning | 边缘反光(蒙皮) |
| ArtMesh670_Skinning | 图层 137(蒙皮) |
| ArtMesh675_Skinning | 图层 319(蒙皮) |
| ArtMesh678_Skinning | 图层 136(蒙皮) |
| Part29 | > <眼 |
| Part78 | 圈圈眼 |
| Part44 | 狗尾草 |
| Part52 | 举手 |
| Part58 | 流泪 |
| Part65 | 爱心眼 |
| Part70 | 屑屑眼 |
| Part41 | 眉毛 |
| Part48 | 眼眶 |
| Part43 | 眼球 |
| Part49 | 眼白 |
| Part38 | 眉毛 |
| Part37 | 眼眶 |
| Part35 | 眼球 |
| Part36 | 眼白 |
| Part148 | 组 23 2 |
| Part13 | 嘴线 |
| Part39 | 脸底 |
| Part16 | 嘴皮 |
| Part14 | 口内 |
| Part138 | 眉毛 |
| Part139 | 眼眶 |
| Part140 | 眼球 |
| Part141 | 眼白 |
| Part143 | 眉毛 |
| Part144 | 眼眶 |
| Part145 | 眼球 |
| Part146 | 眼白 |
| Part151 | 脸底 |
| Part152 | 嘴皮 |
| Part153 | 口内 |
| Part158 | 组 1 2 |
| Part160 | 组 1 |
| Part103 | 文件夹5 |
| Part105 | 文件夹5 |
| Part131 | 手 |
| Part130 | 手 |
| Part79 | 汗 |
| Part50 | 组 21 2 |
| Part51 | 组 38 2 |
| Part53 | 组 21 3 |
| Part28 | 流泪 |
| Part59 | 图层组18(3) |
| Part60 | 图层组18(2) |
| Part61 | 图层组18 |
| Part62 | 图层组19(2) |
| Part63 | 图层组19 |
| Part71 | 组 22 2 |
| Part72 | 组 22 |
| Part69 | 流泪 |

## 附录 C：全部资源文件

| 路径 | 字节 |
| --- | --- |
| live2d\DeepSeek\DeepSeek\AdvancedARKitSettings.vbridger | 18664 |
| live2d\DeepSeek\DeepSeek\Animation\IDLE.motion3.json | 35673 |
| live2d\DeepSeek\DeepSeek\Animation\举手切默认手.motion3.json | 1668 |
| live2d\DeepSeek\DeepSeek\Animation\狗尾草切回默认手.motion3.json | 2183 |
| live2d\DeepSeek\DeepSeek\Animation\狗尾草切换出来.motion3.json | 2479 |
| live2d\DeepSeek\DeepSeek\Animation\竖手指切出来动画.motion3.json | 2601 |
| live2d\DeepSeek\DeepSeek\Animation\竖手指切回默认.motion3.json | 2257 |
| live2d\DeepSeek\DeepSeek\Animation\脱捕.motion3.json | 17616 |
| live2d\DeepSeek\DeepSeek\Animation\默认手切举手.motion3.json | 1881 |
| live2d\DeepSeek\DeepSeek\Exp3\体型1.exp3.json | 225 |
| live2d\DeepSeek\DeepSeek\Exp3\体型2.exp3.json | 210 |
| live2d\DeepSeek\DeepSeek\Exp3\兔牙.exp3.json | 206 |
| live2d\DeepSeek\DeepSeek\Exp3\前倾.exp3.json | 213 |
| live2d\DeepSeek\DeepSeek\Exp3\加载.exp3.json | 206 |
| live2d\DeepSeek\DeepSeek\Exp3\单片眼镜.exp3.json | 207 |
| live2d\DeepSeek\DeepSeek\Exp3\圈圈眼.exp3.json | 506 |
| live2d\DeepSeek\DeepSeek\Exp3\尾巴开关.exp3.json | 211 |
| live2d\DeepSeek\DeepSeek\Exp3\屑屑眼.exp3.json | 406 |
| live2d\DeepSeek\DeepSeek\Exp3\流冷汗.exp3.json | 207 |
| live2d\DeepSeek\DeepSeek\Exp3\流泪.exp3.json | 206 |
| live2d\DeepSeek\DeepSeek\Exp3\爱心眼.exp3.json | 206 |
| live2d\DeepSeek\DeepSeek\Exp3\竖食指关.exp3.json | 211 |
| live2d\DeepSeek\DeepSeek\Exp3\竖食指开.exp3.json | 316 |
| live2d\DeepSeek\DeepSeek\Exp3\胸口衣服.exp3.json | 210 |
| live2d\DeepSeek\DeepSeek\Exp3\脱鞋.exp3.json | 210 |
| live2d\DeepSeek\DeepSeek\Exp3\脸红.exp3.json | 206 |
| live2d\DeepSeek\DeepSeek\Exp3\裙子切换.exp3.json | 211 |
| live2d\DeepSeek\DeepSeek\Exp3\钢盆.exp3.json | 207 |
| live2d\DeepSeek\DeepSeek\Exp3\黑框眼镜.exp3.json | 207 |
| live2d\DeepSeek\DeepSeek\Exp3\黑脸.exp3.json | 206 |
| live2d\DeepSeek\DeepSeek\Exp3\默认体型.exp3.json | 210 |
| live2d\DeepSeek\DeepSeek\Exp3\＞＜.exp3.json | 506 |
| live2d\DeepSeek\DeepSeek\items_pinned_to_model.json | 454 |
| live2d\DeepSeek\DeepSeek\大肥鱼.4096\texture_00.png | 10462576 |
| live2d\DeepSeek\DeepSeek\大肥鱼.4096\texture_01.png | 13210527 |
| live2d\DeepSeek\DeepSeek\大肥鱼.4096\texture_02.png | 2264052 |
| live2d\DeepSeek\DeepSeek\大肥鱼.4096\texture_03.png | 18625369 |
| live2d\DeepSeek\DeepSeek\大肥鱼.4096\texture_04.png | 1148818 |
| live2d\DeepSeek\DeepSeek\大肥鱼.cdi3.json | 53272 |
| live2d\DeepSeek\DeepSeek\大肥鱼.moc3 | 16498560 |
| live2d\DeepSeek\DeepSeek\大肥鱼.model3.json | 550 |
| live2d\DeepSeek\DeepSeek\大肥鱼.physics3.json | 217421 |
| live2d\DeepSeek\DeepSeek\大肥鱼.png | 682204 |
| live2d\DeepSeek\DeepSeek\大肥鱼.vtube.json | 142608 |
| live2d\DeepSeek\psd\大肥鱼公皮分享拆分.psd | 131737107 |
| live2d\DeepSeek\psd\默认已知｜大肥鱼免费模型 PSD 使用规范.txt | 3945 |
