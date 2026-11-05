# 当前会话 API

唯一表演入口为 `POST /api/command`，也支持 `/ws` 的 command 消息。请求结构为 `{method, params, request_id}`。角色页面需保持打开，首次通过页面的“开始说话”启用声音。

## 基本流程

```json
{"method":"performance.start","params":{"context":"和观众聊天","motion_style":"lively"},"request_id":"start-1"}
{"method":"performance.finish","params":{"session_id":"返回的32位ID","seq":0,"text":"大家好呀。今天也一起加油吧！"},"request_id":"finish-1"}
```

`performance.start` 返回 `session_id`。台词来自上游，不由表演模型改写。可选输入为 `context`（最多 800 字）、`motion_style`（lively/natural/restrained，默认 lively）和 `seed`。当前固定使用回归专家与协调动作组；不再提供 Flow 或自由连续手臂模式。

增量文本通过 `performance.append({session_id,seq,text})` 追加；`seq` 从 0 严格递增，单次最多 2000 字，待处理文本最多 12000 字。`performance.finish` 提交余文并结束输入。整段已知台词可直接放在首次 finish 中。当前增量输入在完整句结束、长度上限或 finish 时提交，逗号不提交。已知文本在 240 字以内时，即使包含多个句号也只合成一次。长文在自然句边界附近按 240 字预算分组，并预取下一组；显式 flush 会强制提交当前余文。动作按语义句规划，情感按短语形成观测并由连续曲线连接，两者均不随 TTS 重启。

查询使用 `performance.state`，打断使用 `performance.cancel({session_id})`。重试必须复用同一 request_id 和相同内容。取消后的迟到输入、音频与动作不能恢复播放。

`performance.state.affect` 提供当前多情绪权重、原始短语分数、快速反应、慢速心境、VAD 投影与音频驱动的曲线时钟，用于诊断与可视化。主情绪标签带迟滞，不等于把其他权重清零。暂停冻结曲线，预取不提前改变情绪，显式导演释放后回到当前自动状态。详见 [连续情绪说明](emotion-curves.md)。

## 当前控制能力

| 方法 | 用途 |
| --- | --- |
| performance.start / append / finish / cancel | 会话生命周期与文本输入 |
| performance.state / status | 当前播放、队列与模型状态 |
| performance.direct / release | 显式导演指令及释放 |
| appearance.update / get | 持久外观 |
| capabilities.get | 当前动作、表情、外观与控制范围 |
| state.get / engine.pause | 完整运行状态与同步暂停 |
| speech.unlock | 音频激活；浏览器限制仍要求用户点击 |

导演可以设置 `gesture`、`body_motion`、`emotion` 或 `expression`，并通过 `clause` 绑定指定分句。手势包括 wave/chest/grass/point/thanks/explain/refuse/rest；身体包括 lean/sway/nod/tilt/turn/cajole/rest。变体取 0/1/2。强度、保持时间等具体字段见 [工具 Schema](performance-tools.json)。显式指令优先于自动选择，动作保持进入与退出过程。

外观只接受显式更新；停止发言和换句保持设置。特殊眼型互斥、全开或全关。普通表情强度连续，开合嘴由真实音频驱动。音频播放时钟维护表演进度，眨眼、呼吸及原生物理持续运行。

## 已移除

`/api/latent/*`、`/api/speech/*`、`/api/profile`、历史评分 HTTP 接口及旧低层公开命令不再提供，返回 404。低层参数与原始动画仍作为角色引擎的内部执行能力，不再作为兼容 API 暴露。

客户端见 [`examples/performance_demo.py`](../examples/performance_demo.py)。当前默认使用约 308M 情感分类器与 0.8B 动作模型，不加载 4B；模型权重来源见 [架构说明](architecture.md)。本轮没有接入 DSH，也没有改训音色。
