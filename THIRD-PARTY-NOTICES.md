# 第三方内容与许可说明 / Third-party notices

本仓库只包含本项目的自研代码、文档与实验产物。下列第三方内容**没有**随仓库分发，或按各自许可单独提供；使用本项目前请自行确认并遵守对应协议。

## Live2D Cubism SDK for Web（未包含）

- 运行时依赖 Live2D Cubism SDK for Web 5 R4（Core 5.1.0），官方下载地址：
  <https://cubism.live2d.com/sdk-web/bin/CubismSdkForWeb-5-r.4.zip>
  （本项目本地记录：`archive_sha256=d78904d908bd232b800219e01732e4ea2f0562b5e9f35a2670742a1c16d22942`）
- Cubism Core 适用 [Live2D Proprietary Software License Agreement](https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html)；Cubism Framework 适用 [Live2D Open Software License](https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html)。商业使用还需按 Live2D 要求取得 Cubism SDK Release License。
- 本仓库不包含 `vendor/cubism/`。请从上述官方地址下载后放到 `vendor/cubism/`，运行时只使用同一官方压缩包里的 Core 与 Framework。

## “大肥鱼”Live2D 角色素材（未包含）

- 原画：**神宫凉子**。模型素材为作者免费提供的 Live2D 建模练习素材，附带使用规范（原始说明文件不在本仓库内）。
- 该规范明确禁止将原始 PSD 重新打包、上传网盘/素材站供他人下载或转售；将官方配布模型冒充为自己作品也被禁止。公开发布衍生内容时须注明“原画：神宫凉子”。
- 本仓库**不包含** `live2d/` 下的模型、贴图与 PSD，仅包含用于说明项目效果的截图（已注明原画作者）。请自行从原作者处获取素材并遵守其规范。
- 截图中的角色仅用于展示本项目的运行效果，不代表原作者认可本项目。

## Qwen3.5-0.8B（未包含）

- 语义编码器基座：[Qwen/Qwen3.5-0.8B](https://huggingface.co/Qwen/Qwen3.5-0.8B)，Apache-2.0，固定 revision `2fc06364715b967f1860aea9cf38778875588b17`，权重 SHA-256 记录在 `latent/encoder-source.json`。
- 本仓库不包含 `models/`。运行 `latent/prepare_encoder.py` 会按上述来源准备权重。

## Qwen3-TTS（未包含）

- 语音合成使用独立项目 Qwen3-TTS 及其训练检查点（da_fei_yu 音色），不在本仓库内，遵循其上游许可与使用条款。
- `speech/config.json` 中的路径是原作者本机路径，使用前需改成你自己的项目/环境路径。

## faster-qwen3-tts 0.3.2（包含固定源码副本，MIT）

- 来源：<https://github.com/andimarafioti/faster-qwen3-tts>，revision `b84dc773b2199a85cb421eb76857e4475e03e8c4`。
- 本仓库在 `vendor/faster-qwen3-tts/` 保留固定源码副本以锁定与 Transformers 4.57.3 的兼容性，MIT 许可证随副本保留（`vendor/faster-qwen3-tts/LICENSE`），来源与文件 SHA-256 见 `SOURCE.json`。

## 数据集与实验产物

- `datasets/` 未包含在本仓库（约 3 GB，含角色运行时录制数据与特征）。数据由程序编排、在真实 Cubism 运行时录制，不包含第三方动捕或真人演示。
- `archive/` 未包含在本仓库（约 5.3 GB 的历史封存快照）。
- `experiments/` 中的报告与训练产物是本项目的实验证据，按本仓库 MIT 许可提供。

## 其他依赖

- Node 依赖（`tsx`、`vite`、`ws`、`playwright` 等）与 Python 依赖（PyTorch、transformers 等）不随源码副本分发，版本由 `package-lock.json` 与 `latent/uv.lock`（如有）锁定；各自遵循其上游许可证。
- 角色页与文档中的商标、角色名称归各自权利人所有。
