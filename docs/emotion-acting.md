# 原生情绪表现

2026-11-07 当前模型为 `vtuber-v6-acting-feedback-r3c`，运行时 `v6.4.0-acting-feedback`。本页的初版情绪配方已由 [动作反馈训练](acting-feedback-training.md) 修订；当前绑定以契约为准。

## 表情和动作如何分工

28 维快慢曲线通过 14 个面部输入连续改变眼睑、眼部笑意、眉毛、嘴角、偏嘴、撅嘴、鼓腮和视线。所有标签保留独立贡献，混合情绪仍然可叠加。语音独占 `ParamMouthOpenY`；自然眨眼可以继续闭合眼睑；不写入眉毛角度等物理输出。特殊爱心眼等绘制眼型改为显式导演选项，避免遮住真正的眼睑表演。

wink 使用有限的 620 ms 曲线，双眨眼共 500 ms。两者跟随已执行的动作变体或显式导演指令触发，不再仅因某种情绪分数而 wink；暂停和缓冲冻结同一表演时钟。

模型选择实际动作及句内位置，自动播放不再按情绪二次替换动作。情绪试演的通用动作资源见 `contracts/emotion-bindings.json` 的 `action`。

这些是角色配方，并非声称 28 类情绪有 28 套全新动作，或模型已经学会新动作数据。9 种身体原语的 A/B/C 变体搭配 28 套面部形变，先供实际观看与修改；以后需要让网络学习更细的表演选择时，再采集经人工认可的时序样本。

首轮反馈后的眼神、叠图和手势修正，以及待解决的情绪识别问题，见 [人工反馈审阅](review-feedback.md)。当前 wave 因缺少掌心翻转绑定，使用点头倾身招呼。

## 初版表现设计表（当前修订见上述链接）

| 情绪 | 标签 | 面部与身体表现 | 身体变体 |
|---|---|---|---|
| 赞赏 | `admiration` | 抬眼、舒眉，稍向前靠近 | lean / A |
| 觉得有趣 | `amusement` | 双眼眯起偏嘴笑，歪头，不自动 wink | tilt / A |
| 生气 | `anger` | 压眉抿嘴，侧首表达抗拒 | turn / B |
| 不耐烦 | `annoyance` | 半眯眼、鼓腮撅嘴，稍稍侧首 | turn / B |
| 赞同 | `approval` | 柔和眯眼笑，明确点头 | nod / A |
| 关心 | `caring` | 舒眉柔和注视，缓缓前倾 | lean / B |
| 困惑 | `confusion` | 一高一低的眉眼，左右歪头端详 | tilt / C |
| 好奇 | `curiosity` | 睁眼抬眉，歪头探身 | lean / C |
| 期待与渴望 | `desire` | 半眯眼、微微撅嘴，靠近轻扭 | cajole / C |
| 失望 | `disappointment` | 眼睑下垂、嘴角下压，低头一次 | nod / A |
| 不赞同 | `disapproval` | 单侧压眼、偏嘴，侧首停留 | turn / B |
| 厌恶 | `disgust` | 收紧眼睑、歪嘴，转开视线 | turn / A |
| 害羞 | `embarrassment` | 脸红、垂眼，侧首后小幅靠近轻扭 | cajole / B |
| 兴奋 | `excitement` | 笑眯眼，重心左右轻摇 | sway / A |
| 害怕 | `fear` | 睁眼提内眉、冷汗，紧张侧倾 | tilt / A |
| 感谢 | `gratitude` | 柔和眯眼、垂视，深浅两次点头 | nod / B |
| 悲痛 | `grief` | 低垂眼睑、内眉上提，低头停顿 | nod / A |
| 开心 | `joy` | 双眼弯起、嘴角上扬，轻摇后靠近 | sway / C |
| 亲昵 | `love` | 温柔眯眼、微笑脸红，前倾歪头轻扭 | cajole / A |
| 紧张 | `nervousness` | 眉眼稍不对称、轻抿嘴，短暂侧首 | turn / C |
| 乐观 | `optimism` | 抬眼微笑，抬头后点头 | nod / C |
| 得意 | `pride` | 半眯眼、单侧嘴角上扬，歪头并右眼 wink | tilt / B |
| 恍然大悟 | `realization` | 睁眼扬眉、轻噘嘴，抬头点头 | nod / C |
| 释然 | `relief` | 放松眼睑与眉毛，轻摇后回正 | sway / B |
| 懊悔 | `remorse` | 垂眼抿嘴、内眉上提，缓慢低头 | nod / A |
| 难过 | `sadness` | 眼睑低垂、嘴角下压，轻轻侧倾 | tilt / A |
| 惊讶 | `surprise` | 睁大眼睛、扬眉，歪头探身 | lean / C |
| 平静 | `neutral` | 放松眉眼，保持自然呼吸 | 无 |

## 试演与接口

打开主页，展开“语境、风格与试演”，选择情绪后点击“试演”，约 4.8 秒后返回自动状态；“复位”提前释放。说话时不启用试演按钮，常规播放直接使用情绪分类结果。

向 `POST /api/command` 提交：

```json
{"method":"performance.direct","params":{"cue_id":"affection","emotion":"love","intensity":1,"hold_ms":4800}}
```

只看面部可加 `"action_id":"none"`；明确动作会覆盖配方。单独 wink：

```json
{"method":"performance.direct","params":{"cue_id":"wink","expression":"wink_left","intensity":1,"hold_ms":1200}}
```

`expression` 还支持 `wink_right`、`double_blink`、`squint` 和显式绘制眼型。释放使用 `performance.release`，传同一个 `cue_id`。

配置入口为 `contracts/emotion-bindings.json`；形变数值在 `src/emotion-profiles.ts`；短表情时序在 `src/emotion-expression.ts`。新增情绪表现不用改 TTS、不必为每类重做训练数据。

## 验证

`npm test` 检查曲线连续性、wink 单次与冷却、暂停冻结、单一动作所有者、嘴型所有权及背景视线合成。`npm run test:acting` 在独立生产页面渲染 28 种情绪，检查左右 wink、有限撒娇、真实 Qwen 语音和移动界面，结果输出至 `test-results/emotion-acting/`。自然度和人物性格是否合适仍需用户实际观看，不以参数测试代替审美评价。

本轮结果：73 项单元/接口检查通过，TypeScript 与生产构建通过；浏览器报告 `ok=true`，28 种情绪渲染、2 种单眼 wink、有限撒娇与真实口型检查通过。包含逗号与两句话的测试仅产生一个 6.64 秒音频单元。截图 `gallery.png`、`desktop.png`、`mobile.png` 与详细采样一起保存在上述目录。

v6.2 历史回归中，自动说话与当时的三个单臂张掌挥手变体检查通过（该手型经人工反馈已撤下，见上述修订），含暂停、neutral 覆盖、取消与外观保持。见 `test-results/emotion-acting/regression/report.json`；总验收摘要为 `validation.json`。
