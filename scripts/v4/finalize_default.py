"""Freeze the actual default deployment; keep failed targets explicitly separate."""
import argparse
import hashlib
import json
import shutil
import urllib.request
from datetime import datetime,timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'experiments/vtuber-v4-default-r1';CHECKS=ROOT/'test-results/v4-default'
def read(path):return json.loads(path.read_text(encoding='utf-8'))
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def write(path,value):path.write_text(json.dumps(value,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf-8')

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--observed-js-tests',type=int,required=True);parser.add_argument('--observed-python-tests',type=int,required=True);args=parser.parse_args()
    config=read(ROOT/'latent/stream-run.json');assert config['promoted'] and config['path']=='experiments/vtuber-v4-default-r1'
    run=read(OUT/'run.json');assert run['promoted'] and run['default_acceptance']['source']=='explicit_user_request'
    live=read(CHECKS/'browser-verification-default.json');ui=read(CHECKS/'default-ui.json');latency=read(CHECKS/'latency-summary.json')
    assert live['ok'] and live['stress']['wall_ms']>=600000 and ui['ok']
    assert live['stress']['two_raised_arm_samples']==0
    with urllib.request.urlopen('http://127.0.0.1:8768/health',timeout=10) as f:health=json.load(f)
    active=health['streaming'];assert active['promoted'] and active['execution']['body_encoder_shared']
    assert active['execution']['motor_device']=='cpu' and active['execution']['planner_device']=='cuda'
    with urllib.request.urlopen('http://127.0.0.1:8769/health',timeout=10) as f:tts=json.load(f)
    assert tts['ready'];backup=ROOT/'.runtime/v4-default-change/backup';original=read(backup/'index.json')
    assert sha(ROOT/'.runtime/performance/ratings.json')=='7f7d6b0ae58dff2355aec7cbe93dbe0c54f741cb41d7b688177d5d4a4ba16f47'
    for name in ['latent/default-run.json']:
        assert sha(ROOT/name)==original['files'][name]
    preserved=[];superseded=[]
    old=read(ROOT/'research/vtuber-v4-intent-study/provenance.json')
    for name,entry in old['files'].items():
        if sha(ROOT/name)==entry['sha256']:preserved.append(name)
        else:
            assert name=='latent/stream-run.json',name
            assert sha(backup/name)==entry['sha256'];superseded.append(name)
    weights={p.name:sha(p) for p in OUT.glob('*.pt')}
    assert weights['body-planner.pt']==run['body_planner']['sha256']
    assert weights['performance-planner.pt']==run['performance_planner']['sha256']
    sources=[ROOT/p for p in ['main.py','README.md','docs/v4-default.md','latent/stream-run.json','latent/default-run.json',
        'latent/streaming.py','latent/generalization_runtime.py','latent/body_intent_runtime.py','latent/context_prompts.py',
        'latent/semantic_tokens.py','latent/intent_study.py','latent/planner_contract.py','latent/encoders/qwen3.5-4b.json',
        'server/performance-service.ts','server/index.ts','src/performance-panel.ts','src/latent-panel.ts','src/performance.ts',
        'src/body-motion.ts','src/gesture-library.ts','src/gesture-choreography.ts','tests/test_default_launcher.py',
        'latent/test_default_runtime.py','tests/performance-default.test.ts','tests/performance-default-latency.ts',
        'tests/performance-default-ui.ts','tests/performance-browser.ts','scripts/v4/prepare_default.py',
        'scripts/v4/finalize_default.py','package.json','package-lock.json','latent/pyproject.toml','latent/uv.lock']]
    for path in sources:
        target=OUT/'source-snapshot'/path.relative_to(ROOT);target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(path,target)
    verification=OUT/'verification';verification.mkdir(exist_ok=True)
    for name in ['browser-verification-default.json','default-ui.json','latency-legacy.json','legacy-worker-args.json',
                 'latency-default.json','latency-summary.json','latency-summary-initial.json','latency-summary-parallel-start.json']:
        shutil.copy2(CHECKS/name,verification/name)
    summary=dict(created_utc=datetime.now(timezone.utc).isoformat(),promoted=True,activation_basis='explicit_user_request',
        functional_checks_passed=True,latency_targets_passed=latency['ok'],latency=latency['summary'],
        execution=active['execution'],body_seed=run['body_planner']['selected_seed'],stress={k:v for k,v in live['stress'].items() if k!='metrics'},
        ui_checks=ui['checks'],observed_console_tests=dict(javascript=args.observed_js_tests,python=args.observed_python_tests,
            scope='55 existing JS regressions plus 1 new concurrency test; 4 body runtime plus 5 profile-selection unit tests'),
        excluded_broad_suite=dict(launcher_lifecycle_precondition_failures=6,executed=False,
            reason='Initial broad discovery hit the occupied-service guard; not counted as passed. Real owned legacy/default start-stop paths were exercised separately.'),
        weights=weights,sources={str(p.relative_to(ROOT)).replace('\\','/'):sha(p) for p in sources},
        prior_intent_artifacts_preserved=len(preserved),intentional_configuration_replacement=superseded,
        original_human_ratings_unchanged=True,scientific_reports_changed=False,final_test_loaded=False,
        tts_checkpoint_sha256=tts.get('checkpoint_sha256'),
        original_source_backup='.runtime/v4-default-change/backup',legacy_command='python main.py --legacy')
    write(OUT/'deployment.json',summary)
    m=summary['latency'];s=summary['stress']
    report=f'''# v4 默认方案部署

用户明确认可后，普通 `python main.py` 已自动使用 `experiments/vtuber-v4-default-r1` 并打开会话表演入口。本次启用依据当前用户请求，旧研究分数与原人工评分没有回写。

组成：冻结 4B 词元注意力规划器、已确认协调动作库、语境＋任务说明身体分支。身体分支以校准目标的中位数选 7137，不读取终测；与规划器共享一份 GPU 4B 骨干。旧 0.8B 底层轨迹在 CPU 保留，原 CUDA Graph 音色权重不变。

默认状态、接口与实际设备已核对：`promoted=true`、背景专家 CPU、规划 CUDA、身体编码器共享。默认网页选择协调动作组，研究 Flow 禁用。长语境会保留当前完整台词、事实前缀和最近对话，并在指标里记录裁剪。

## 实际验证

- 连续运行 {s['wall_ms']/1000:.1f} 秒，{s['clauses']} 分句，双臂同时抬起样本为 {s['two_raised_arm_samples']}。
- 实际 TTS、多句持续表演、暂停/恢复、显式情绪与特殊眼型、单手问候、取消和迟到消息、持久外观均通过运行检查。
- 长语境实际播放完成，身体输入不超过 512 token；眼镜、鞋子、裙子设置在讲话和取消后保持。
- 55 项既有 JavaScript 回归、1 项新增并行读取测试、4 项身体运行时与 5 项启动配置单测通过，TypeScript 检查通过。
- 初次宽泛发现测试时，完整启动器生命周期用例因已有服务而在前置条件失败，未执行且未计为通过；本轮实际验证了受控停止、旧版启动与普通默认启动。

## 延迟与限制

使用独立重启的原 0.8B CUDA 链路作基线，三组相同新文本实际播放，排除一组预热。首音中位数从 {m['baseline_first_audio_ms']:.1f} ms 到 {m['default_first_audio_ms']:.1f} ms，增加 {m['increase_ms']:.1f} ms。包含会话建立从 {m['baseline_including_setup_ms']:.1f} ms 到 {m['default_including_setup_ms']:.1f} ms，增加 {m['increase_including_setup_ms']:.1f} ms；动作更新 P95 为 {m['action_update_p95_ms']:.1f} ms，样本 {m['action_updates']} 次。

包含会话建立的增加值仍略高于原 200 ms 目标，严格延迟检查保留为未通过；没有通过改分数或放宽测试将其记为成功。已将就绪状态与角色状态并行读取以减少建立开销，其他优化留待后续。用户认可的默认选择与自动指标达标分开记录。

本次没有新自然度盲测，也没有重新评估旧终测。模型可能漏选或误选，导演覆盖和旧版入口继续保留。

## 使用与回退

```powershell
python main.py
# 本次改用旧版：
python main.py --stop
python main.py --legacy
```

再次普通启动即返回新默认。原源码/配置备份在 `.runtime/v4-default-change/backup`，旧底层预测指针仍为 v3。完整配置、权重哈希、运行记录见 deployment.json 与 verification/。
'''
    (OUT/'DEPLOYMENT.md').write_text(report,encoding='utf-8')
    print(json.dumps({k:summary[k] for k in ['promoted','functional_checks_passed','latency_targets_passed','body_seed','prior_intent_artifacts_preserved']}),flush=True)
if __name__=='__main__':main()
