# 本地语义表演

状态：2026-11-04 用户反馈效果不好，已停止运行并恢复原来的 v4-default-r1。以下为未采用方案的实验与接入记录，日常启动使用 `python main.py`。

这是一条独立的本地驱动链路：生成式 Qwen3.5-4B 根据完整台词、观众发言和语境输出可检查的语义与表演意图，再由角色表演引擎执行。当前使用本地 llama.cpp CUDA 引擎和从原有权重转换的 Q8_0 模型，未重新训练。它复用本机“大肥鱼”角色、原音色、Cubism、物理和协调动作库，不加载旧版语义分类头或连续动作专家。

## 启动

先在旧启动器终端按 Ctrl+C，或执行 `python main.py --stop`。然后运行：

```powershell
python main.py --semantic
```

打开或刷新 `http://127.0.0.1:8765/?speech=1#performance-panel`，页面标题应为“本地语义表演”。同一时刻只有一个页面控制角色；打开多个页面时，点击当前页“开始语义表演”会切换控制权，并在当前页面启用声音。也可使用右上角“在此窗口控制”或面板内的“启用声音”。旧窗口保留，但不再拥有控制权。停止所有服务仍用 Ctrl+C 或 `python main.py --stop`。

`python main.py` 保留之前的 v4 默认组合；`--legacy` 仍是旧版回退。新入口不改写两个默认模型指针。进程仍由原启动器统一管理，模型和 TTS 在 WSL 运行，网页在 Windows 运行。

## 使用

1. 填写“角色台词”。这些是实际朗读的文字，规划器不会改写台词。
2. 需要语境时填写“观众说了什么”和“语境”。例如同一句“你可真行。”，前文可以分别是对方解决难题、或对方再次忘记保存。
3. 可填“本次导演要求”，如“开头轻轻挥手一次，然后自然收手”或“平静解释，不要挥手”。
4. 点击“开始语义表演”。整段只规划一次、只合成一条连续语音；语义与语音并行准备，计划通过校验后即可开始播放正在生成的音频。页面会显示整段的语义释义。
5. 原有暂停/继续、停止、临时导演指令、独立手势与身体控制、持久外观设置继续使用。显式工具指令优先于自动动作。

一次完整台词最多 300 字，句号、问号、逗号及换行均不会重启规划或语音。较长输入会明确提示缩短。语音开合嘴使用原 RMS 口型，表情层只写眉、微笑、嘴形和视线等兼容通道，不覆盖开合嘴或自动眨眼。特殊眼型沿用原有互斥开关工具。

## 时序与状态

- 语义模型输出交流行为、语气、连续 VAD 与原文锚点。JSON 和动作枚举由本地约束解码器限制；输出仍接受严格校验。
- 原文锚点必须存在，事件按原文顺序执行。必要时最多重新生成一次；仍失败则结束本次会话并显示错误，不把坏计划发送给角色。
- 音频在等待语义时持续缓冲；计划通过校验后立即释放已生成的 PCM，继续流式接收后续音频。若此时尚未生成完毕，先用预计时长，收到最终样本数后只修正尚未触发的事件，不重放已经执行的动作。事件与声音共享 AudioContext 时钟，按字符位置占比近似对齐，没有逐词时间戳。
- 手势和身体使用已验证的协调曲线，保留冷却、入场和收势；普通叙述可以只用表情与注视。脸部状态平滑延续，长停顿后回落。
- 取消会停止声音、撤销待执行事件并中断正在生成的本地计划；迟到的会话输入不会重新启动表演。

语义规划需要自回归生成，等待时间与旧 v4 的特征分类不同；本入口优先验证语义贴合，不承诺旧版的首音延迟。格式约束保证输出结构，不保证模型理解每种语境都正确。

当前总输入预算为 4096 token。2026-11-04 在同机将默认四句台词与旧版对照：旧版从提交到完成约 24.96 秒，新版约 11.87 秒；新版整段首音约 3.12 秒，其余五个短句场景约 1.52～2.35 秒，连续播放无断流。具体重跑结果、版本哈希与边界见 [连续播放记录](../research/live2d-semantic-planner-v1/CONTINUOUS_SPEECH.md)。此前 3.669～6.322 秒的逐句实现属于历史版本，见 [原接入记录](../research/live2d-semantic-planner-v1/INTEGRATION.md)。

本地引擎路径、模型路径和哈希位于 `semantic/native-runtime.json`。当前使用本机 `D:/Workplace/llama.cpp/build-cuda-msvc-dev/bin/llama-server.exe`；其 CUDA DLL 与可执行文件放在同一安装目录。模型由同一源码版本的 `convert_hf_to_gguf.py` 使用本项目 `models/Qwen3.5-4B` 原始权重及 `--outtype q8_0 --no-mtp` 转换得到，不从第三方下载量化权重。引擎只监听 `127.0.0.1:8767`，使用 `--offline`，随 `main.py` 一起启动和关闭。

## 外部程序接入

沿用 `/api/command` 的 `performance.start / append / finish / state / cancel` 接口。启动本入口后，`performance.status` 返回 `semantic_planner: true`。`performance.start` 支持以下额外字段：

```json
{
  "context": "角色在耐心解释，没有反讽。",
  "audience_message": "你是不是生气了？",
  "director_instruction": "平静说明，不要挥手。",
  "motion_backend": "groups",
  "motion_style": "restrained"
}
```

取得 `session_id` 后，通过递增的 `seq` 追加或结束台词。语义模式的 `append` 只缓冲文本，`finish` 或显式 `flush:true` 才提交整段；可以直接在 `finish` 的 `text` 中一次发送全部台词。`performance.state` 的 `semantic` 字段包含语义结果、事件的近似媒体时间，以及动作实际执行或跳过的记录。新链路不会调用旧 `/stream/predict`。

## 实现与检查

- `semantic/planner.py`：本机模型、输出合同与取消生成。
- `semantic/grammar.py`：兼容 Transformers 5 和中文词元的本地格式约束。
- `semantic/serve.py`：回环地址语义服务，审计记录在 `.runtime/semantic/`。
- `semantic/native.py`：本地专用引擎的受约束流式生成与取消；保留 HF 后端用于开发对照。
- `src/semantic-performance.ts`：语义合同、媒体时钟事件与连续表情。
- `server/performance-service.ts`：语义、TTS 与会话生命周期的编排。
- `server/semantic-audio.ts`：等待语义期间的有界 PCM 缓冲与及时释放。

```powershell
npm test
node --import tsx --test tests/semantic-performance.test.ts tests/performance-default.test.ts
python -m unittest tests.test_semantic_runtime tests.test_default_launcher -v
python -m unittest discover -s research/live2d-semantic-planner-v1 -p test_planner.py -v
npm run build
```

`tests/semantic-browser.ts` 在独立本地执行页上测试真实模型、音色与 Cubism，覆盖挥手、否定句、同句不同语境、暂停、取消和恢复。其结果属于开发功能验证，不是盲测自然度或开放域准确率。
