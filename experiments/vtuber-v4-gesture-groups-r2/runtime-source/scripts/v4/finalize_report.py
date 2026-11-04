"""Freeze the candidate runtime and collect existing evidence; never writes human votes."""
import hashlib,json,shutil,subprocess
from datetime import datetime,timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'experiments/vtuber-v4-restrained'
TEST=ROOT/'test-results/v4'
def read(path):return json.loads(path.read_text(encoding='utf-8'))
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    stability={kind:read(TEST/f'browser-verification-restrained{suffix}.json') for kind,suffix in [('regression',''),('flow','-flow')]}
    latency={kind:read(TEST/f'latency-restrained-{kind}.json') for kind in stability}
    handoff=read(TEST/'handoff-verification.json');review=read(TEST/'review-verification.json');combinations=read(TEST/'combinations/report.json')
    data=read(OUT/'dataset-verification.json');units=read(TEST/'unit-checks.json')
    reports=[*stability.values(),*latency.values(),handoff,review,combinations,data,units]
    assert all(r['ok'] for r in reports),'A required engineering check has not passed'
    assert all(r['stress']['wall_ms']>=600000 for r in stability.values()),'Ten-minute evidence required for each expert'
    run=read(OUT/'run.json')
    for item in [*run['models'].values(),run['motor_gate']]:assert sha(OUT/item['checkpoint'])==item['sha256']
    old=json.loads(subprocess.check_output(['git','show','HEAD:latent/default-run.json'],cwd=ROOT))
    assert read(ROOT/'latent/default-run.json')==old,'Legacy default must remain unchanged before human acceptance'
    files=[*sorted((ROOT/'src').glob('*.ts')),*sorted((ROOT/'src').glob('*.css')),*sorted((ROOT/'server').glob('*.ts')),
        *[ROOT/f for f in ['latent/streaming.py','latent/motor_gate.py','latent/serve.py','latent/stream-run.json','speech/features.py','package.json']]]
    runtime=OUT/'runtime-source';hashes={}
    for file in files:
        relative=file.relative_to(ROOT);target=runtime/relative;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(file,target);hashes[relative.as_posix()]=sha(file)
    (OUT/'runtime-manifest.json').write_text(json.dumps({'created_at':datetime.now(timezone.utc).isoformat(),'files':hashes,'legacy_default_sha256':sha(ROOT/'latent/default-run.json'),'run_sha256':sha(OUT/'run.json')},indent=2),encoding='utf-8')
    ratings=read(ROOT/'.runtime/performance/ratings.json')
    summary={'engineering_checks_passed':True,'promoted':False,'naturalness_accepted':False,'reason':'Body preference and final blind comparison remain human decisions.',
        'dataset':data,'stability':{kind:{'runtime_version':r.get('runtime_version'),'wall_ms':r['stress']['wall_ms'],'clauses':r['stress']['clauses'],'explicit_gesture':r['explicit_gesture'],'gesture_policy':r['stress'].get('gesture_policy')} for kind,r in stability.items()},
        'latency':{kind:r['summary'] for kind,r in latency.items()},'handoff':handoff,'review':review,'combinations':{'ok':combinations['ok'],'cases':len(combinations['cases'])},'unit_checks':units,
        'human_review':{'pilot_count':len(ratings['pilot']),'comparison_count':len(ratings['comparison']),'pilot_14_choice':ratings['pilot']['13']['choice'],'ratings_sha256':sha(ROOT/'.runtime/performance/ratings.json')},
        'scope_notes':['Regression ten-minute run used v4.3; v4.4 corrects skirt naming and initial selection. Motor policy/checkpoints unchanged. Flow ten-minute run and final latency/handoff use v4.4.',
            'Final state reporting, idempotency retirement and timing instrumentation have separate unit/integration checks; they do not change generated trajectories.',
            'Latency uses one warmup pair and three measured pairs per candidate, not a large-sample benchmark.','Original synthetic data shared authoring assumptions; all subjective decisions remain pending.']}
    (OUT/'validation-summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
    paragraph='回归与 Flow 分别完成十分钟真实会话（含 TTS、动作及长停顿）：'+ '；'.join(f"{kind} {r['stress']['wall_ms']/1000:.1f} 秒、{r['stress']['clauses']} 分句" for kind,r in stability.items())+'。'
    paragraph+='热服务各 1 组预热、3 组实测：'+ '；'.join(f"{kind} 首音 {r['summary']['v4_median_first_audio_ms']:.1f} ms、含会话建立的增量 {r['summary']['increase_including_setup_ms']:.1f} ms、动作更新 P95 {r['summary']['action_update_p95_ms']:.1f} ms" for kind,r in latency.items())+'。'
    paragraph+='暂停/恢复、取消与迟到请求、外观保持、原生/手动接管、真实眨眼及页面媒体检查通过。完整记录和版本范围见 `validation-summary.json`，运行源码快照见 `runtime-manifest.json`。回归十分钟在 v4.3 完成，外观命名修正后的 v4.4 由 Flow 十分钟与最终接管/延迟检查覆盖；不能把这些结果当成人工自然度通过。'
    report=OUT/'REPORT.md';text=report.read_text(encoding='utf-8');start='实时十分钟、首音延迟、接管与眨眼结果由最终 `validation-summary.json` 汇总，报告生成前保持待核验；不能引用旧整数实验的持续运行结果作为新版动作质量证据。'
    if start in text:report.write_text(text.replace(start,paragraph),encoding='utf-8')
    print(json.dumps({'engineering_checks_passed':True,'promoted':False,'human_review':summary['human_review'],'latency':summary['latency']},ensure_ascii=False))
if __name__=='__main__':main()
