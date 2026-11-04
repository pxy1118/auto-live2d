# 在线接管实验：已暂停，未合入

`candidate/MANIFEST.json` 记录 2026-11-03 暂存的四份源码、原路径和 SHA-256。候选包含未完成的 `PerformanceCoupling`、`performance.configure` 和 `motion_coupling`；服务文件混用 `||` 与 `??`，当时不能编译，没有完成在线验证。

`baseline/` 保存实验前的默认源码，`before.json` 保存原始哈希。生产目录已恢复这些基线；`src/performance-coupling.ts` 仅保存在候选目录，不由默认入口加载。本次收尾重新核对了备份、暂存源码和默认指针，保留该失败记录。

恢复研究时需从独立分支或副本取回候选，先修复编译并验证参数归属、连续性和迟到消息，不将它作为当前交付代码。
