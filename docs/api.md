# 本地接口

地址 `http://127.0.0.1:8765`。实际动作执行需要一个已加载完成的角色页面；未连接时返回 503。所有命令通过同一浏览器 Cubism 执行器。

## 语言到连续动作

```python
import json
import urllib.request

base = 'http://127.0.0.1:8765'
def post(path, data):
    request = urllib.request.Request(base + path, json.dumps(data).encode(),
                                     {'Content-Type': 'application/json'})
    with urllib.request.urlopen(request) as response:
        return json.load(response)

p = post('/api/latent/predict', {
    'text': '我理解你的意思了。', 'context': '回应对方的解释',
    'kind': 'regression', 'style': 'natural', 'seed': 41,
})
print(p['values'], p['timing'], p['constraints'])
post('/api/latent/execute', {'prediction_id': p['prediction_id']})
```

`kind` 为 `regression` 或 `flow`；风格为 `natural` / `restrained` / `lively`。台词最多 1500 字，语境最多 2000 字，编码后最多 512 token。当前服务同时只处理一个推理请求。

当前返回 64×16 物理单位控制量、每步左右手状态、64×17 的 `expression_probabilities`、`expression_names`、体型索引序列 `appearance`、`native_motion`、`execution_mode`、`trajectory.play` 命令与延迟/约束统计。连续量顺序以 `GET /api/profile` 的 channels 为准。Flow 越界经显式限幅后执行，values 为限幅后轨迹。

表情由学习到的概率头预测，按 profile 阈值（脸红 0.82、黑脸 0.7、其他 0.65）筛选，做短闪烁抑制、眼型互斥和黑脸冲突消解，再调用原始 expressions.set。脸红强度 0.4，黑脸 0.85。体型调用 appearance.set；完整脱捕经分类头选择后播放 13.8 秒原始动画，execution_mode=native_motion，此时不执行生成的连续轨迹。数据回放入口为 `/dataset/vtuber-v3/review/index.html`。

预测 ID 有效期 5 分钟、最多保留 20 份，每份只执行一次。执行恢复默认动作姿态并保留背景时钟，呼吸、眨眼、待机与物理全部开启；可传 `paused:true` 便于确定性检查。正在录制时拒绝便捷执行。`GET /api/latent/status` 返回动作专家来源、体型/动画词表与实验边界。

## 语音与嘴部同步

先在角色页面点击一次“启用声音”。默认推荐流式接口，外部 LLM 程序可直接边接收进度边播放：

```python
request = urllib.request.Request(base + '/api/speech/perform', json.dumps({
    'text': '大家晚上好，我是大肥鱼。', 'context': '直播开始，普通问候。',
    'style': 'lively', 'kind': 'regression', 'with_motion': True,
}).encode(), {'Content-Type': 'application/json'})
with urllib.request.urlopen(request, timeout=180) as response:
    for line in response:
        event = json.loads(line)
        if event['type'] == 'error':
            raise RuntimeError(event['error'])
        print(event['type'])  # start / progress / end；音频与动作已送入角色页面
```

响应为 `application/x-ndjson`；progress 包含已缓冲毫秒数与首块延迟，end 包含完整 WAV 地址、哈希、合成耗时与 first_audio_ms（worker 首 PCM 耗时）、first_chunk_ms（服务向角色页面交付首块的耗时）。浏览器另有约 100 ms 的起播缓冲和渲染延迟，这两个值都不等同于听到首个有声音节的时间。断开请求会取消尚未完成的生成并停止该段播放；end 后请求正常结束，角色继续播放缓冲音频。已合成完成的播放可发送 speech.stop。错误在响应开始前使用 HTTP 错误码，流开始后使用 type=error；流无 end 即断开也必须视为失败。整个服务同时只接纳一个流式生成；重复请求返回 429。

需预先检查完整 WAV 时可继续使用：

```python
p = post('/api/speech/prepare', {
    'text': '大家晚上好，我是大肥鱼。',
    'context': '直播开始，普通问候。',
    'style': 'lively', 'kind': 'regression', 'with_motion': True,
})
post('/api/speech/execute', {'speech_id': p['speech_id']})
```

prepare 接受 1～300 字、可选 language（默认 Chinese）、seed、context/style/kind 与 with_motion。返回音频地址、24kHz WAV 哈希、TTS checkpoint 哈希、时长、合成耗时、60Hz mouth 包络及动作来源。成功 execute 后 ID 消耗一次；5 分钟过期。未启用浏览器声音的失败可重试同一 ID。with_motion=false 保留当前表情与姿态，仅叠加音频口型。

`GET /api/speech/status` 返回音色、ready/busy、backend、streaming 与模型/推理源码来源；`GET /api/speech/audio/{speech_id}.wav` 读取已完成语音。CUDA 默认流式；CPU 或 backend=huggingface 使用完整接口。身体生成轨迹按语音长度播放，完整原始脱捕保留原速；音频能量驱动稀疏点头与躯干滞后随动，不增加手势或表情切换。

原始命令包括 speech.unlock（需要页面用户操作）、speech.play（audio_url、speech_id、mouth、可选 trajectory）、speech.stop、speech.status，以及流式传输使用的 speech.stream.begin / append / finish。append 严格校验 speech_id、连续 index/offset_samples、PCM16 样本数与 60 Hz 口型；finish 必须匹配最终 total_samples。通常调用 perform 即可，不需要手动传输分块。

state.get 附加 speech 状态，包含 phase、audio_time_ms、duration_ms、complete、underruns、mouth_open、motion_time_ms、motion_timing、rhythm。phase=buffering 时音频与身体媒体时钟保持；engine.pause 同步暂停/续播。speech.stop 可带 speech_id，只停止匹配会话；省略则停止当前播放。复位、录制开始和录制回放也会取消语音。action_driver 不含语音嘴部及重音叠加，driver 含语音输入、位于物理之前；values 为实际 Cubism 输出。

## 原始角色控制

| 路径 | 作用 |
| --- | --- |
| `GET /api/health` | 服务与角色运行时状态 |
| `GET /api/capabilities` | 真实参数边界、部件、表情、动画和方法清单 |
| `GET /api/manifest` | 原始资源索引、物理与动画数据 |
| `GET /api/state` | 目标/最终参数、活动动作与帧号 |
| `POST /api/command` | `{method, params, request_id?}` 执行命令 |

```json
{"method":"parameters.set","params":{"values":{"AngleX":15,"AngleY":5},"duration_ms":600,"stage":"pre"}}
```

成功 `status=applied` 表示已进入执行帧，动画可能尚未结束。`state.get` 的 `action_driver` 位于自动眨眼和语音叠加之前，`driver` 是合成后物理前输入，`values` 是最终参数；`background_time_ms` 是独立背景时钟。`geometry:true` 可读取网格探针。参数批次原子校验；越界会限幅并列出。最近 512 条 request_id 在当前执行页面连接期间去重。

| 方法 | 关键参数 |
| --- | --- |
| `model.describe` / `state.get` | `{}` / `{"geometry":true}` |
| `parameters.set` | `values`、可选 `duration_ms` 和 `stage:pre/post`；物理输出默认 post |
| `parameters.release` | 可选 `ids`，不填则释放全部参数覆盖 |
| `expressions.set` / `expressions.clear` | `name`、`enabled`、可选 `strength`、`fade_ms` |
| `appearance.set` | `body:default/preset1/preset2` |
| `gesture.set` | right: default/point_index/grass；left: default/chest |
| `motions.play` / `motions.stop` | `name`、可选 `loop`、`hold` |
| `timeline.play` / `timeline.cancel` | `events:[{at_ms,method,params}]`、可选 `duration_ms` |
| `trajectory.play` | 同时间轴，另需 `provenance.source=latent_policy`；自动保留录制来源 |
| `behavior.set` | 部分字段 `idle`、`breath`、`blink`、`physicsEnabled` |
| `physics.configure` | `enabled`、`windX/Y`、`gravityX/Y` |
| `parts.set` | `values:{真实部件ID:透明度}` |
| `engine.reset` / `engine.pause` | 可选 `paused`、`preserve_background` / 必填 `paused` |
| `engine.step` | 暂停后指定 `frames:1..600`，固定 1/60 秒 |
| `recording.start` / `recording.stop` | 从默认状态录制，可选 `paused`、`annotation` / 返回 JSON |
| `recording.replay` | 可传 `recording`、`paused`，默认上次录制 |
| `demo.play` | 固定的 10 秒接口演示，与神经预测独立 |

录制每 10 Hz 保存物理前驱动与最终参数，最多 3000 帧或 2000 指令；从 reset 加日志重建物理历史。页面录制按钮下载 JSON。`engine.reset` 会丢弃未保存录制。

WebSocket：`ws://127.0.0.1:8765/ws`，外部调用者发送 `{"type":"command","method":"state.get","request_id":"example"}`，收到执行结果；不要发送执行页面专用 hello。

最小脚本仍可运行 `python examples/control_demo.py`。原始功能与资产分析见 [模型审计](model-audit.md)。旧 `/api/policy/*`、`/api/dataset*`、`action.play` 已退出当前服务。
