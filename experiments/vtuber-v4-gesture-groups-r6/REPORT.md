# 撒娇动作候选 r6

运行时 `v4.11-cajole`，新增 `body_motion:"cajole"`：保持前倾，小幅扭动躯干、移重心，头部略错峰并反向转动，保留面向观众的感觉。三种编排分别是前倾歪头轻扭两次、侧首靠近后停留、前倾画弧后歪头。动作有限次完成，长时间保持不会无限重复。

参考[撒娇动作教学文稿](https://www.douyin.com/shipin/7589561484787812362)中的侧身轻摆、低下巴和歪头组合，并参考 [Animation Mentor 的身体表演教程](https://www.animationmentor.com/blog/tutorial-animating-emotion-through-body-language/)关于重心、节奏及左右独立设计的方法，针对现有角色参数重新编排。没有导入外部动作权重。

身体层仍只控制 7 个头身输入，原生物理驱动髋部、肩部、袖子和头发；双臂默认自然垂放。可单独调用，也可通过原有 `gesture:"chest"` 与抚胸组合。表情、外观与身体幅度独立控制。示例：

```json
{"method":"performance.direct","params":{"body_motion":"cajole","body_variant":0,"body_strength":0.85,"body_hold_ms":3000},"request_id":"cajole-1"}
```

展示页新增 3 段真实语音示范，台词为“拜托啦，再陪我一会儿，好不好？”。原有 39 段经输入指纹一致性核对后复用，当前共 14 组、42 段；新增“只看新增撒娇”筛选及 `?focus=cajole#motion` 直达链接。原有表情评分和第 14 组 B 保留。

本轮证据位于 `verification/` 和 `validation-summary.json`：41 项单元测试、类型检查与生产构建，新增 3 段实际 Cubism 60 Hz 参数/30 fps 图像记录，真实 PCM 同播的身体层组合、暂停、释放、取消及页面操作，以及展示页媒体/筛选/手机宽度/评分保持检查。参数检查涵盖 42 段（含 39 段复用记录），新增撒娇 3 段共 798 帧，无双臂同时抬起。分时图见 `../../test-results/v4-groups-r6/cajole-variants.png`。

当前为动作工具与编排候选，未增加神经选择器类别或更新权重；v3 默认入口保留。人工动作质量仍待反馈，本轮未重跑十分钟会话及推理延迟基准，未切换默认模型。
