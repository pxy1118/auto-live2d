"""Freeze measured research results, including scope limits and failed attempts."""
import gzip
import hashlib
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
STUDY = ROOT / 'research/vtuber-v4-liveliness-r1'
OUT = ROOT / 'test-results/v4-liveliness-r1'
EXP = ROOT / 'experiments/vtuber-v4-liveliness-r1'
PUBLIC = ROOT / 'datasets/vtuber-v4/review'


def read(p): return json.loads(p.read_text('utf-8'))
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def write(p, x): p.write_text(json.dumps(x, ensure_ascii=False, indent=2, allow_nan=False) + '\n', 'utf-8')


def main():
    c, sim, browser, reproduced = [read(OUT / p) for p in ['capture.json', 'simulation.json', 'review-browser.json', 'policy-reproduction.json']]
    assert all(x['ok'] for x in [c, sim, browser, reproduced])
    assert len(c['clips']) == 6 and c['actual_frames'] == 5996 and c['batching_matches_frozen_capture']
    assert reproduced['reproduced_candidate_frames'] == 2998 and reproduced['policy_sha256'] == sha(STUDY / 'policy.ts')
    for p, h in read(STUDY / 'before.json')['protected'].items(): assert sha(ROOT / p) == h, p
    for clip in c['clips']:
        folder = OUT / clip['id']
        assert sha(folder / 'input.json.gz') == clip['input_sha256']
        assert sha(folder / 'actual.json.gz') == clip['actual_sha256']
        assert len(list(folder.glob('*.png'))) == clip['frames']
    for r in browser['pacing']:
        assert r['automatic_time_writes'] == 0 and r['automatic_seeks'] == 0 and r['p95_presentation_ms'] < 40
    def at(clip, second, key):
        d = json.loads(gzip.decompress((OUT / clip / 'actual.json.gz').read_bytes()))
        return d['actual'][round(second * 60)][d['parameter_ids'].index(key)]
    measured = {'anger_at_3s': {'brow': at('anger-state_idle', 3, 'ParamBrowLY'), 'black_face': at('anger-state_idle', 3, 'key1')},
                'shy_at_6s': {'current_blush': at('shy-current', 6, 'key7'), 'candidate_blush': at('shy-state_idle', 6, 'key7')},
                'shy_glance_at_1_5s': at('shy-state_idle', 1.5, 'ParamEyeBallX')}
    assert measured['anger_at_3s']['brow'] == 0 and measured['anger_at_3s']['black_face'] == .7
    assert measured['shy_at_6s']['current_blush'] < .03 and measured['shy_at_6s']['candidate_blush'] > .37
    assert measured['shy_glance_at_1_5s'] > .06
    failures = [
        {'stage': 'initial ownership validation', 'finding': 'ParamBrowLAngle/RAngle are native physics outputs, so the prototype rejected ownership.', 'resolution': 'Use safe brow-height and squint inputs; preserve native physics.'},
        {'stage': 'first capture navigation', 'finding': 'Main server serves production dist, so a research TS page was not available there.', 'resolution': 'Separate Vite-only research server on 8775; no main restart or action workers.'},
        {'stage': 'initial image transfer', 'finding': 'Returning all 1680 PNG frames at once exceeded the Node/CDP string size limit.', 'resolution': '90-frame transfer batches; native physics remains continuous, with 120-frame exact readback equivalence to frozen capture.'}]
    write(STUDY / 'failures.json', failures)
    results = {'schema': 'liveliness-study-results.v1', 'trained': False, 'promoted': False, 'human_quality_accepted': False,
               'default_changed': False, 'production_sources_unchanged': True, 'paused_handover_development_resumed': False,
               'semantic_model_used': False, 'online_integration_tested': False, 'observed_unit_tests': 12,
               'isolated_typecheck_passed': True, 'clips': 6, 'actual_cubism_frames': 5996, 'probe_frames': 120,
               'true_capture_fps': 60, 'batching_matches_frozen_capture': True, 'final_policy_inputs_reproduced': True,
               'actual_parameter_evidence': measured, 'simulations': sim['simulations'], 'browser': browser,
               'clip_diagnostics': c['clips'], 'failures_retained': failures,
               'limitations': ['Fixed research emotion signals, no automatic semantics or generalization result.',
                               'Three rendered scenes; no human naturalness acceptance or comparison winner.',
                               'Slow affect currently biases idle choice; body tone and long-term mood behavior are not implemented.',
                               'Offline ten-minute policy simulations, not full online stability or simultaneous model/TTS latency.',
                               'Per-region and lifecycle prototypes require online integration and more emotion-transition cases before promotion.']}
    write(STUDY / 'results.json', results); write(PUBLIC / 'liveliness-study-report.json', results)
    text = '''# 持续状态与稀疏调度研究 r1

结论：执行机制可行，已经做出可复查的参数时序和实际渲染对照；尚不能认定更自然。保留为独立候选，没有重训、切默认或继续此前暂停的在线接管开发。

## 本轮问题与做法

从 my-neuro 的固定版本 a72ef146e1839a0b4135bceb47b922a7caaebc02 吸收设计思路，在本项目独立编写研究策略，没有移植其执行代码。主要考察：慢情绪是否跨句保存、眉眼与情绪覆盖层是否能分时退出、安静时能否低频小动、说话和导演接管时能否让位。原生手臂、手型、外观、语音开口和物理输出继续保留原归属。

比较“冻结的当前执行器＋固定情绪信号”和“持续状态与稀疏调度”。三个场景共六段视频，实际逐帧 Cubism 更新和图像采集共 5,996 帧，编码为 60 fps。害羞场景复用既有真实 development 音频和原生手臂/躯干轨迹；安静待机与生气保持是无声执行探针。两版的同场景音轨解码后逐字节一致，手臂/手指输入逐值一致。

## 实际结果

- 生气场景第 1.5 秒，眉高 -0.154、眯眼 0.098、黑脸 0.7；第 3 秒眉眼已回到 0，黑脸仍是 0.7。这证明了部位时长可以分开，而不是只生成一个描述。
- 害羞场景第 1.5 秒侧看输入 0.0684。第 6 秒，原执行的脸红为 0.01712，候选为 0.37846；第 8 秒候选已退出到 0。两句之间的开心信号不会立刻抹掉残余脸红。
- 安静场景从非默认头身姿态开始，约第 16.23 秒才发生一次侧看，之后回到原姿态。本片没有展示所有待机种类；歪头、重心变化和慢眨眼目前还只有策略与参数级验证。
- 所有已采集场景均未改变外观或特殊眼型开关；新层没有写入原生物理输出。直接核对发现眉角也是物理输出，实验转而使用眉高与眯眼输入。

这些结果只证明控制机制与具体参数变化。观察到的眉眼幅度较轻，尚无人工自然度、情绪可读性或偏好评分，不指定优胜版本。

## 时钟、连续性与优先级

研究时钟由实际媒体进度驱动说话阶段，重复渲染不重复推进；暂停和断流冻结，安静阶段继续走待机时钟。参数曲线在接管或替换处匹配当前位置、速度。导演只覆盖指定部位，自动状态在后台继续推进，退出时恢复当时的自动结果，不重播被遮住的旧动作。

待机候选间隔 10–18 秒，单动作冷却至少 20 秒，并避开最近两个动作；手臂不进入待机池。说话、等待音频和身体导演接管时，已有待机动作在 300 ms 内退让。新层从原始姿态加有界偏移，不把上帧偏移重新累加。慢情绪在本轮仅影响待机选择倾向，尚未驱动更长期的身体松紧、人格或情绪推理。

## 工程证据与范围

12 项独立检查及严格 TypeScript 检查通过，覆盖曲线接管、部位时长、媒体时钟、非默认姿态、跨句保持、局部导演与自动恢复、暂停、取消和迟到结果、参数归属及 30/60/120 Hz 采样一致性。

两组各 10 分钟的离线策略模拟各评估 36,001 帧。纯待机产生 44 次动作；混合说话/暂停/断流产生 37 次。混合模拟核对了 658 次暂停样本、1,260 帧缓冲和一次迟到结果拒绝，没有越界、改动其他归属参数或在忙碌时新发待机动作。它们不是完整在线 Cubism/TTS/动作模型连续十分钟验收。

冻结的旧渲染器在独立 Vite 服务中运行，不导入此前未完成的接管模块，不注册用户角色 WebSocket。分批采集只分传输，不重置物理；120 帧探针同旧版单次采集的全部实际参数逐值一致。最终策略源码也已重新生成全部 2,998 帧候选输入，与存档逐值一致。

页面使用单路带音轨视频。两版各抽查 7.3 秒，画面呈现间隔 P95 约 16.9 ms，无超过 100 ms 的间隔，也没有播放中的自动跳转。显式切换保留时刻，暂停和“查看反应”按钮通过桌面/移动布局检查。这不是动作模型、TTS 或在线首音延迟报告。

最初发现的物理归属冲突、生产服务不提供研究 TS 路由，以及一次过大的图像传输失败均保存在 failures.json。修复后才形成上述结果。

## 建议的落地顺序

1. 先完成并验证此前暂停的在线接管改动，独立控制“是否启用候选”；当前未验证源码不算通过。
2. 把部位时序、部位优先级和迟到结果保护接到现有语义输出，保留实际音频时钟；先覆盖中性、害羞、生气、明确情绪转折。
3. 待机作为单独可调模块接入，先开放眼神/头部/轻躯干，校准密度与幅度。不能用持续晃动代替注意力变化。
4. 在线功能、稳定性及性能通过后，用少量同语音对照判断画面收益；有明确收益再考虑加入训练标签。当前不需要据此扩大模型。

还未验证任意复杂情绪转折、否定/引用/反讽的自动理解、在线完整会话，以及自然度偏好。这些都需要后续证据。

## 文件与复现

- 页面：/dataset/vtuber-v4/review/liveliness-study.html，无评分表。
- 协议、策略及冻结渲染器：research/vtuber-v4-liveliness-r1/。
- 真实输入、读回、图像、浏览器记录和离线模拟：test-results/v4-liveliness-r1/。
- 实验元数据与新策略源码快照：experiments/vtuber-v4-liveliness-r1/，没有模型权重。

```powershell
python -X utf8 scripts/v4/prepare_liveliness_study.py
npx tsx --test tests/liveliness-study.test.ts
npx tsc -p research/vtuber-v4-liveliness-r1/tsconfig.json
npx tsx scripts/v4/simulate_liveliness_study.ts
# 独立终端运行，完成后关闭：
npx tsx scripts/v4/serve_liveliness_study.ts
# 在另一终端采集、发布和检查：
npx tsx scripts/v4/capture_liveliness_study.ts
npx tsx scripts/v4/verify_liveliness_inputs.ts
python -X utf8 scripts/v4/publish_liveliness_study.py
npx tsx tests/liveliness-study-review.ts
python -X utf8 scripts/v4/finalize_liveliness_study.py
```
'''
    (STUDY / 'REPORT.md').write_text(text, 'utf-8')
    EXP.mkdir(parents=True, exist_ok=True)
    for p in ['policy.ts', 'REPORT.md', 'protocol.json', 'results.json']:
        shutil.copyfile(STUDY / p, EXP / p)
    sources = ['scripts/v4/prepare_liveliness_study.py', 'scripts/v4/serve_liveliness_study.ts', 'scripts/v4/capture_liveliness_study.ts',
               'scripts/v4/simulate_liveliness_study.ts', 'scripts/v4/verify_liveliness_inputs.ts', 'scripts/v4/publish_liveliness_study.py',
               'scripts/v4/finalize_liveliness_study.py', 'tests/liveliness-study.test.ts', 'tests/liveliness-study-review.ts']
    for p in sources:
        dest = EXP / 'source-snapshot' / p; dest.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(ROOT / p, dest)
    files = {}
    for folder in [STUDY, OUT, EXP, PUBLIC / 'liveliness-r1']:
        for p in folder.rglob('*'):
            if p.is_file() and p.name != 'provenance.json': files[p.relative_to(ROOT).as_posix()] = {'sha256': sha(p), 'bytes': p.stat().st_size}
    for p in [PUBLIC / 'liveliness-study.html', PUBLIC / 'liveliness-study-scenes.json', PUBLIC / 'liveliness-study-report.json']:
        files[p.relative_to(ROOT).as_posix()] = {'sha256': sha(p), 'bytes': p.stat().st_size}
    write(STUDY / 'provenance.json', {'schema': 'liveliness-study-provenance.v1', 'trained': False, 'promoted': False, 'files': files})
    print(json.dumps({'ok': True, 'clips': 6, 'actual_frames': 5996, 'offline_simulations': 2, 'unit_tests': 12,
                      'protected_runtime_unchanged': True, 'promoted': False, 'files': len(files)}))


if __name__ == '__main__': main()
