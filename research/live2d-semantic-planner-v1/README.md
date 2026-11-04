# 本地语义规划原型

后续接入已完成：正式实现已移至 `semantic/`，运行 `python main.py --semantic` 可驱动本机 Live2D。完整使用方式见 [本地语义表演](../../docs/semantic-live2d.md)。本目录的命令保留为兼容入口，下文两条 CPU 记录为接入前的历史试跑。

用户目标：重新设计语义到表演的驱动链路，优先改善现有角色的实际表现。用户已取消在线对照，本目录采用纯本地模型。

`planner.py` 将台词、观众发言、事实语境和导演指令交给完整生成式模型，输出可检查的语义释义、情感主体、交流行为、表达语气、VAD 和带原文锚点的表演意图。它不连接 Live2D，不发送参数，不接管当前角色。完整设计见 [DESIGN.md](DESIGN.md)。

## 当前试跑

2026-11-04 使用本机 Qwen3.5-4B，在 CPU 上运行“你可真行。”的两个不同语境：

| 语境 | 模型判断 | 输出合同 | 生成时间 |
| --- | --- | --- | --- |
| 对方解出难题 | 称赞、温和认可 | 通过 | 50.6 s |
| 对方未保存就关掉文件 | 反讽、调侃 | 通过 | 51.7 s |

第二条释义使用“愚蠢行为”，措辞偏重，并推断发生数据丢失；这些细节仍需审查。两条可区分语境不代表完整语义质量通过。没有给出自然度、准确率或相对 v4 的改善结论。

当时 GPU 显存主要由现有动作与 TTS 服务占用，试跑未停止它们。CPU 使用 float32 与未加速的参考内核，未同时测 TTS；上述数字只描述这次离线 CPU 生成，不能用作 GPU 或端到端性能结论。首条也包含首次生成开销，未做独立预热。

原始记录保存在 `test-results/semantic-planner-v1/local4b-cpu-20261104-r1/`。该次运行源代码已另存 `source-snapshot.py`，它保留了当时尚未使用的在线接口代码；随后根据用户要求删除在线入口。该次实际推理全部在 CPU 本地完成。

## 运行

直接复用现有 WSL 模型环境，不安装新依赖或下载权重。在 Windows 的仓库目录中执行：

```powershell
wsl -d Ubuntu-24.04 -- /home/cola/.local/share/auto-live2d/latent-venv/bin/python /mnt/d/Workplace/auto-live2d/research/live2d-semantic-planner-v1/planner.py --device cpu --limit 2 --output /mnt/d/Workplace/auto-live2d/test-results/semantic-planner-v1/local-smoke-new
```

去掉 `--limit 2` 可运行全部二十条开发诊断。用 `--only 组名/样例名` 选择特定样例；逗号分隔可选多条。`--device cuda` 用于显存可用时的独立 GPU 实验。每次输出目录必须是新目录，已有结果不会被覆盖。

后续若在本机部署量化模型服务，可使用同一输入合同连接回环地址，不需要在线账户：

```powershell
python research/live2d-semantic-planner-v1/planner.py --provider local-api --base-url http://127.0.0.1:8000/v1 --model 本机服务模型名 --output test-results/semantic-planner-v1/local-api-new
```

该命令是接口示例，不表示本机已经部署此服务。只接受回环地址，禁用代理和重定向，不支持云端地址或密钥配置。

## 校验与结果边界

```powershell
python -m unittest discover -s research/live2d-semantic-planner-v1 -p test_planner.py -v
```

样例的 `expected` 字段和样例 ID 不进入模型请求。校验拒绝重复 JSON 字段、未知参数、无穷或布尔数值、原文不存在的锚点、倒序事件以及动作与强度矛盾。格式合法只代表结果可解析。

每次运行保存 `manifest.json` 和逐例 `records.jsonl`，包括原始模型输出与校验错误。Manifest 明确标注语义质量尚未审核；不会自动用字符串匹配填写语义正确率或用户评分。原型尚未实现动作参数编译和实际角色播放。
