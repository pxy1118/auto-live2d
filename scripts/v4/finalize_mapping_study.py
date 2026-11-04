"""Freeze actual mapping evidence; no automatic quality winner or model promotion."""
import hashlib
import json
import shutil
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
STUDY=ROOT/'research/vtuber-v4-mapping-r1'
OUT=ROOT/'test-results/v4-mapping-r1'
EXP=ROOT/'experiments/vtuber-v4-mapping-r1'
PUBLIC=ROOT/'datasets/vtuber-v4/review'


def read(p):return json.loads(p.read_text(encoding='utf-8'))
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(p,v):p.write_text(json.dumps(v,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf-8')


def main():
    r=read(STUDY/'results.json');browser=read(OUT/'review-browser.json');assert browser['ok']
    assert r['clips']==12 and r['actual_frames']==8979 and not r['promoted'] and not r['trained']
    assert r['neutral_readbacks_identical'] and r['all_arm_finger_inputs_identical']
    assert len(r['response_probes'])==5 and len(r['micro_reaction_readbacks'])==9
    for p,h in read(STUDY/'runtime-before.json')['files'].items():assert sha(ROOT/p)==h,p
    for c in r['clip_diagnostics']:
        folder=OUT/c['id'];assert sha(folder/'input.json.gz')==c['input_sha256'];assert sha(folder/'actual.json.gz')==c['recording_sha256']
        assert c['out_of_range_inputs']==0 and c['two_raised_arm_samples']==0 and c['appearance_unchanged']
    for p in browser['pacing']:
        assert p['steady_current_time_writes']==0 and p['steady_seek_events']==0 and p['presentation_gap_p95_ms']<40
    # Old frozen research, including the user's rejection, stays exactly intact.
    for stem in ['vtuber-v4-prosody-study','vtuber-v4-playback-diagnosis-r1']:
        prior=read(ROOT/'research'/stem/'provenance.json')
        for p,h in prior['files'].items():
            if stem=='vtuber-v4-prosody-study' and p=='datasets/vtuber-v4/review/prosody-study.html':continue
            assert sha(ROOT/p)==h['sha256'],p
    features={}
    for scene,feature in [('welcome','early_brow_raise'),('shy','finite_side_glance'),('cajole','slow_blink_window')]:
        values={x['condition']:x for x in r['micro_reaction_readbacks'] if x['scene']==scene}
        if scene=='cajole':assert values['current']['minimum']>.99 and values['mapped_micro']['minimum']<.2
        else:assert values['current']['maximum']<.001 and values['mapped_micro']['maximum']>.09
        features[scene]=values
    r.update(browser_checks=browser['checks'],presentation_pacing=browser['pacing'],observed_unit_tests=6,
             typecheck_passed=True,previous_research_preserved=True,human_votes_generated=0,
             next_validation=['Human assessment of per-axis coupling and micro-reaction readability.',
                              'Non-default initial pose handover, interruption/cancel and full-session online integration before promotion.'])
    write(STUDY/'results.json',r);write(PUBLIC/'mapping-study-report.json',r)
    rows=[]
    for scene in ['welcome','shy','cajole']:
        group={c['condition']:c for c in r['clip_diagnostics'] if c['scene']==scene}
        rows.append('| '+scene+' | '+' | '.join(f"{group[mode]['body_input_acceleration_p95']:.4f}" for mode in r['conditions'])+' |')
    table='\n'.join(rows)
    text=f'''# 资产头身映射与细微反应研究 r1

本轮独立实现资产输入映射，比较“当前动作库执行／资产映射／映射＋细微反应”。4 个固定场景、12 段真实 60 fps 视频，共 8,979 帧参数回读；另有 5 个输入探针、900 帧实际回读。本轮没有重训语义或动作权重，没有接入聊天 LLM，也没有读取旧最终测试。

## 固定条件与归属

复用此前 development 场景的真实音频与固定意图原生手臂路径。没有使用已否决的节奏变速原型。每个场景三版的解码音频 PCM 完全相同，手臂/手指输入逐值一致，口型、基础表情和相机保持。害羞场景统一用近景，以便看清眉眼。

读取当前资产 40 条 VTube Studio 配置中的 8 条头身／注视映射。把原头部目标反解成虚拟输入，以保持滤波前的头部目标幅度，再一对多生成 AngleXYZ、PositionXYZ 和眼球输入。映射替换这八个输出，避免同旧躯干偏移相加；LeanInput 保持原路径，原生物理继续控制其输出。

平滑时间常数设为配置 Smoothing×5 ms，这是本轮的实验解释；不宣称精确复现 VTube Studio 内部滤波。实现由本项目独立编写，参考了 [WHALEL2D 固定版本](https://github.com/Ssssshaiiko/WHALEL2D/tree/1576fc34ddf9f061e91cbe56a37b488c0d0fcaae) 的设计，没有移植其程序或安装插件。

## 实际发现

1. 原配置确实能把同一个头部意图传到躯干输入；但不同方向先后关系不统一。横转探针的头部输入 T90 约 167 ms、躯干约 217 ms；俯仰约 33/217 ms；歪头约 333/217 ms，躯干输入反而更早。这里是输入参数响应，不能当作整个身体的视觉延迟。
2. 原配置不是统一的平滑增益。下表是本轮六个头/躯干输入参数按自身范围归一化后的加速度 P95；仅作为诊断，不是自然度评分，也不与上一轮不同统计口径的数值比较。

| 场景 | 当前执行 | 映射 | 映射＋细微反应 |
|---|---:|---:|---:|
{table}

招呼和撒娇的输入加速度 P95 降低，害羞场景略增；加上微反应后，害羞约比原执行高 10%。不能据此统一宣布映射更优或更自然，需要分方向、分情境看画面。

3. 新增反应在实际读回中可见：招呼早段眉部变化、害羞短暂侧看，以及撒娇的慢眨眼均出现在各自有限窗口中；不是只改了意图 JSON。微反应采用有界的进入／保持／退出包络，起止位置、速度和加速度连续。没有加入周期身体噪声或声学能量变速。
4. 中性场景三版的全部参数回读逐值完全相同。12 段均没有双臂抬起、越界输入、外观变化或特殊眼型误激活。
5. 三种条件各播放 7.3 秒，稳态没有自动 currentTime 写入或 seek；系统 Chrome 156 的画面呈现间隔 P95 为 33.3–33.4 ms，未观察到超过 100 ms 的间隔。只在用户主动切换版本时恢复其播放位置，使用单路视频自带音轨计时。

## 当前结论

工程机制与可视化对照已经完成；候选尚未通过主观自然度验收，也未切换默认。可以据这些材料判断哪些方向的耦合和哪些微反应适合角色。下一步应先做少量风格校准，再考虑同自动 4B 决策衔接；不能把这批人工固定意图直接当作语义泛化证据。

尚需验证非默认初始姿态接管、打断/取消和在线会话整合。当前策略耗时仅为离线本地计算，不包含 TTS、语义推理、网络或渲染，未作为实时延迟验收。

## 验证与保存

6 项单元检查、TypeScript 检查和真实页面验证通过。检查了映射轴向/反解、部位归属、时间步长与暂停、未来输入不改变过去、微反应包络边界、同一手臂输入、同步音频、逐帧 Cubism、单路实际帧呈现、显式切换和页面布局。旧实验与用户否决记录、原默认、权重和评分哈希保持。

```powershell
python -X utf8 scripts/v4/prepare_mapping_study.py
npx tsx --test tests/mapping-study.test.ts
npx tsx scripts/v4/capture_mapping_study.ts
python -X utf8 scripts/v4/publish_mapping_study.py
npx tsx tests/mapping-study-review.ts
python -X utf8 scripts/v4/finalize_mapping_study.py
```

采集使用独立开发服务器 8775，仅读资产，不注册默认角色的控制 WebSocket。该服务器在采集后关闭；当前默认服务仍由原启动器保持。新版本页面为 /dataset/vtuber-v4/review/mapping-study.html。
'''
    (STUDY/'REPORT.md').write_text(text,encoding='utf-8')
    EXP.mkdir(parents=True,exist_ok=True)
    sources=[ROOT/p for p in ['src/engine.ts','src/controller.ts','src/body-motion.ts','src/gesture-library.ts','src/gesture-choreography.ts',
        'src/eye-style.ts','tests/mapping-study.test.ts','tests/mapping-study-review.ts','package.json','package-lock.json']]
    sources+=list(STUDY.glob('*.ts'))+list(STUDY.glob('*.html'))+list((ROOT/'scripts/v4').glob('*mapping_study*'))
    for p in sources:
        dst=EXP/'source-snapshot'/p.relative_to(ROOT);dst.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,dst)
    shutil.copyfile(STUDY/'results.json',EXP/'results.json');shutil.copyfile(STUDY/'REPORT.md',EXP/'REPORT.md')
    write(EXP/'study.json',dict(schema='asset-mapping-experiment.v1',promoted=False,trained=False,semantic_model_used=False,
        human_quality_accepted=False,clips=12,actual_clip_frames=8979,actual_probe_frames=900,unit_tests=6,
        browser_checks=browser['checks'],default_and_previous_research_unchanged=True))
    files=set(sources)
    for folder in [STUDY,EXP,OUT,ROOT/'datasets/vtuber-v4-mapping-r1',PUBLIC/'mapping-r1']:
        files.update(p for p in folder.rglob('*') if p.is_file() and '__pycache__' not in p.parts and p.name!='provenance.json')
    files.update(PUBLIC/name for name in ['mapping-study.html','mapping-study-report.json','mapping-study-scenes.json'])
    write(STUDY/'provenance.json',dict(schema='asset-mapping-provenance.v1',promoted=False,trained=False,human_quality_accepted=False,
        files={str(p.relative_to(ROOT)).replace('\\','/'):dict(sha256=sha(p),bytes=p.stat().st_size) for p in sorted(files)}))
    print(json.dumps(dict(clips=12,clip_frames=8979,probe_frames=900,unit_tests=6,files=len(files),promoted=False,trained=False)),flush=True)


if __name__=='__main__':main()
