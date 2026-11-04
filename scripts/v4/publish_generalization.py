"""Publish measured research results and development demos, never invent acceptance."""
import hashlib
import json
import math
import shutil
import subprocess
from datetime import datetime,timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2];EXP=ROOT/'experiments/vtuber-v4-generalization-r1';REVIEW=ROOT/'datasets/vtuber-v4/review';VERSION='v4.13.0-clause-plan'
def read(p):return json.loads(p.read_text(encoding='utf-8'))
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(p,d):p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

def main():
    selection=read(EXP/'selected.json');test=read(EXP/'test-evaluation.json');protocol=read(EXP/'protocol.json')
    assert selection['checkpoint_sha256']==sha(EXP/'selected-planner.pt')==test['checkpoint_sha256']
    assert selection['selection_split']=='validation' and test['not_used_for_selection']
    evidence={'automatic_playback':ROOT/'test-results/v4-generalization/browser.json',
        'recordings':ROOT/'test-results/v4-generalization/recordings.json',
        'special_eyes':ROOT/'test-results/v4-generalization/eyes/eye-browser.json',
        'legacy_compatibility':ROOT/'test-results/v4-generalization/legacy/planner-browser.json',
        'review_browser':ROOT/'test-results/v4-generalization/review-browser.json',
        'continuity':ROOT/'test-results/v4-generalization/browser-verification-generalization-r1.json',
        'latency':ROOT/'test-results/v4/latency-generalization-r1-novel-final.json'}
    checks={k:read(p) for k,p in evidence.items()}
    assert all(d['ok'] and d['runtime_version']==VERSION for d in checks.values())
    assert checks['continuity']['stress']['wall_ms']>=600000
    assert checks['continuity']['stress']['two_raised_arm_samples']==0
    assert checks['latency']['text_mode']=='novel3'
    launcher_path=ROOT/'test-results/v4-generalization/launcher-preview.json';launcher=read(launcher_path)
    assert launcher['ok'] and launcher['stream_stage']=='generalization_research_candidate' and launcher['planner_sha256']==selection['checkpoint_sha256']
    ratings=ROOT/'.runtime/performance/ratings.json';human=read(ROOT/'experiments/vtuber-v4-composition-r1/human-review.json')
    assert sha(ratings)==human['ratings_sha256']
    default=ROOT/'latent/default-run.json';assert read(default)['path']=='experiments/vtuber-v3'
    assert default.read_bytes().replace(b'\r\n',b'\n')==subprocess.check_output(['git','show','HEAD:latent/default-run.json'],cwd=ROOT).replace(b'\r\n',b'\n')
    assert read(ROOT/'latent/stream-run.json')['path']=='experiments/vtuber-v4-composition-r2'
    pairs=read(REVIEW/'generalization-pairs.json');assert len(pairs)==6;recordings=[]
    for pair in pairs:
        c=pair['clips'][0];video=REVIEW/c['video'];folder=video.with_suffix('');done=read(folder/'done.json');params=read(video.with_suffix('.json'));actual=read(folder/'actual.json')
        assert done['runtime_revision']==VERSION and done['input_sha256']==sha(video.with_suffix('.json'))
        assert video.exists() and video.stat().st_mtime>= (folder/'done.json').stat().st_mtime
        assert len(list(folder.glob('*.png')))==done['frames']==math.ceil(len(params['values'])/2)
        ids=actual['parameter_ids'];indices=[ids.index(k) for k in ['key5','key3','key4','key6']]
        for row in actual['values']:
            assert all(math.isfinite(v) for v in row)
            assert all(row[i] in [0,1] for i in indices) and sum(row[i] for i in indices)<=1
        assert len(actual['values'])==len(params['values']) and done['image_hz']==30
        info=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_entries','stream=codec_type,r_frame_rate','-of','json',str(video)],text=True))
        assert any(s['codec_type']=='audio' for s in info['streams'])
        assert any(s['codec_type']=='video' and s['r_frame_rate']=='30/1' for s in info['streams'])
        recordings.append({'video':c['video'],'frames':len(actual['values']),'sha256':sha(video),'original_pcm_sha256':sha(ROOT/'datasets/vtuber-v4'/c['audio'])})
    quality={}
    target=protocol['quality_targets'];m=test['executed']
    for k,goal in [('arm',target['arm_active_recall']),('body',target['body_active_recall']),('emotion',target['emotion_active_recall']),('eye',target['eye_active_recall'])]:
        quality[k+'_recall']={'value':m[k]['correct_active_recall'],'target':goal,'passed':m[k]['correct_active_recall']>=goal}
        quality[k+'_false_positive_rate']={'value':m[k]['false_positive_rate'],'maximum':target['neutral_false_positive_rate'],'passed':m[k]['false_positive_rate']<=target['neutral_false_positive_rate']}
    quality_pass=all(v['passed'] for v in quality.values())
    result={'runtime_version':VERSION,'selected_configuration':selection['selected_configuration'],'selected_seed':selection['selected_seed'],
        'ablation':selection['table'],'dataset':read(ROOT/'datasets/vtuber-v4-generalization-v1/manifest.json'),
        'test':{k:test[k] for k in ['samples','unique_text_contexts','scenario_families','executed','raw','by_challenge','gpu_peak_allocated_mb']},
        'test_metrics_scope':'category confidence-gated proposals; cooldown, occupied parts and rendering are tested separately',
        'quality_checks':quality,'quality_gate_passed':quality_pass,'engineering_checks_passed':True,
        'full_acceptance_complete':False,'human_accepted':False,'promoted':False,'unit_tests_passed':55,'python_tests_passed':21,
        'new_test_evaluated_once':True,'no_final_test_tuning':True,'model_weights_changed_after_selection':False,
        'stress':checks['continuity']['stress'],'latency':checks['latency']['summary'],'latency_text_mode':'fresh different text in every measured pair; services warm, text not previously inferred',
        'runtime_devices':{'semantic_planner':'cuda','legacy_continuous_expert':'cpu','tts':'cuda'},
        'demonstrations':{'count':6,'frames':sum(r['frames'] for r in recordings),'recordings':recordings,'scope':'development scenes; real streamed TTS and automatic model plans; video replays actual recorded Cubism parameters'},
        'ratings_preserved':True,'v3_default_preserved':True,'live_stream_candidate_preserved':'composition-r2','native_candidate_launcher_verified':True,
        'limits':['authored synthetic labels; not human performance data','history augmentations are not independent samples','small new-scenario suite is not proof of broad open-domain generalization','single-label body supervision can penalize plausible alternative gestures; no post-test relabeling','body false positives and active recall did not meet the predeclared quality gate'],
        'evidence':{k:{'path':p.relative_to(ROOT).as_posix(),'sha256':sha(p)} for k,p in evidence.items()}}
    result['legacy_validation_baseline']=read(EXP/'legacy-validation-baseline.json')
    write(EXP/'validation-summary.json',result)
    proof=EXP/'verification';proof.mkdir(exist_ok=True)
    for k,p in evidence.items():shutil.copy2(p,proof/(k+'.json'))
    shutil.copy2(launcher_path,proof/'native-launcher.json')
    sources=[]
    for directory,extensions in [('src',{'.ts','.css'}),('server',{'.ts'}),('latent',{'.py','.json'}),('scripts/v4',{'.py','.ts'}),('tests',{'.ts','.py'})]:
        sources.extend(p for p in (ROOT/directory).glob('*') if p.suffix in extensions)
    sources.extend(ROOT/n for n in ['README.md','docs/performance-v4.md','docs/performance-plan.schema.json','docs/performance-tools.json','main.py','package.json','latent/pyproject.toml','latent/uv.lock','latent/encoders/qwen3.5-4b.json'])
    for p in sources:
        dest=EXP/'runtime-source'/p.relative_to(ROOT);dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,dest)
    write(EXP/'runtime-manifest.json',{'created_utc':datetime.now(timezone.utc).isoformat(),'sources':{p.relative_to(ROOT).as_posix():sha(p) for p in sources},
        'selected_checkpoint_sha256':sha(EXP/'selected-planner.pt'),'protocol_sha256':sha(EXP/'protocol.json'),'default_pointer_sha256':sha(default),'ratings_sha256':sha(ratings)})
    public={k:result[k] for k in ['runtime_version','selected_configuration','ablation','legacy_validation_baseline','test','test_metrics_scope','quality_checks','quality_gate_passed','engineering_checks_passed','full_acceptance_complete','human_accepted','promoted','unit_tests_passed','python_tests_passed','latency','latency_text_mode','runtime_devices','limits']}
    public['data_counts']={k:{n:d[n] for n in ['records','unique_text_contexts','new_scenarios']} for k,d in result['dataset']['splits'].items()}
    public['stress']={k:result['stress'][k] for k in ['wall_ms','clauses','unique_planned_clauses','two_raised_arm_samples']}
    write(REVIEW/'generalization-report.json',public);(REVIEW/'generalization.html').write_text(HTML,encoding='utf-8')
    status=read(REVIEW/'comparison-status.json');status['research_preview']='generalization.html';write(REVIEW/'comparison-status.json',status)
    lines=['# 语义容量与泛化对照实验','',
        '固定新版数据、任务查询头结构和训练配方，对比 0.8B / 4B 与最后 16 词元平均 / 完整词元注意力。每组使用三个相同随机种子，共 12 次训练；候选按开发集均值选择，采用中位种子，测试集仅评估一次。此对照的 0.8B 平均组使用本轮统一的任务查询头，不是旧 r2 的 MLP 选择器。输入维度不同，适配层参数量也随骨干变化。','',
        '| 骨干 | 特征 | 新场景宏 F1 | 开发集综合分 |','|---|---|---:|---:|']
    for row in selection['table']:lines.append(f"| {row['repo']} | {row['representation']} | {row['mean_new_macro_f1']:.4f} | {row['mean_score']:.4f} |")
    lines.extend(['','这些数值是三个种子的开发集均值，不是整体自然度或开放域泛化保证。数据为编写的合成监督，三个历史增强不独立；训练/验证分别有 2127/411 个不同台词与语境组合，新的最终测试有 125 个组合、30 个场景家族，共 381 条历史增强记录。原 v2 测试标签未进入训练。','',
        f"选定候选的最终门控提议召回率：手势 {m['arm']['correct_active_recall']:.1%}、身体 {m['body']['correct_active_recall']:.1%}、情绪 {m['emotion']['correct_active_recall']:.1%}、特殊眼型 {m['eye']['correct_active_recall']:.1%}。身体动作提议误触发率 {m['body']['false_positive_rate']:.1%}，超过 4% 目标；手势和身体召回率也略低于目标。当前未通过质量门槛，未切换默认。不会依据这些终测错误重调本检查点或改写测试标签。",'',
        '运行时让 4B 语义规划与 TTS 共用 CUDA，原 0.8B 连续专家留在 CPU。CPU 语义预热与 TTS 合成重叠；分句计划提前提交并按真实音频起始时间触发，不依赖首个连续轨迹是否迟到。v3 及流式 r2 指针保留。','',
        f"新的热服务、新台词延迟检查：首音中位数 {result['latency']['v4_median_first_audio_ms']:.1f} ms，较同条件基线增加 {result['latency']['increase_ms']:.1f} ms，含会话建立增加 {result['latency']['increase_including_setup_ms']:.1f} ms；动作更新 P95 {result['latency']['action_update_p95_ms']:.1f} ms。一组预热排除，三组不同台词配对测量；样本量有限。",'',
        f"十分钟检查实际运行 {result['stress']['wall_ms']/1000:.1f} 秒，覆盖 {result['stress']['clauses']} 个分句，双臂同时抬起采样为零。55 项 TypeScript、21 项 Python 测试和生产构建通过。六段两句开发示例记录真实音频与 Cubism 参数，并重渲染为带声音的视频；不是盲测，也没有机器填写的评分。",'',
        '此前时序修正前的运行、参数和视频保留在 before-early-plan 相关目录。完整元数据、全部种子权重、特征缓存、代码指纹及失败终测记录保留。本版仍是研究候选；下一轮需在训练/开发数据上处理身体误触发、监督多解和更自然的组合，再使用新的独立终测与人工偏好验收。'])
    (EXP/'REPORT.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
    print(json.dumps({'engineering_checks_passed':True,'quality_gate_passed':quality_pass,'promoted':False,'demonstrations':6}))

HTML='''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>语义泛化实验</title>
<style>body{margin:0;background:#f3f6f3;color:#233a31;font:16px system-ui}main{max-width:1100px;margin:auto;padding:28px}h1{font-size:28px}p{line-height:1.8}section,article{padding:20px;background:white;border:1px solid #dce5dd;border-radius:14px;margin:22px 0}table{border-collapse:collapse;width:100%;font-size:14px}.table table{min-width:760px}th,td{text-align:left;padding:12px;border-bottom:1px solid #dce5dd}.table{overflow:auto}.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}video{width:100%;height:520px;object-fit:contain;background:#eef4ef}a{color:#236b4d}.muted{color:#63766b}@media(max-width:650px){main{padding:14px}.grid{grid-template-columns:1fr}video{height:470px}section,article{padding:14px}}</style>
<main><a href="index.html#comparison">← 返回原评分</a> · <a href="eye-fix.html">特殊眼型修正</a><h1>更大语义模型 · 泛化对照与连续表演</h1>
<p>本轮比较模型容量和语义特征读取方式。四组、每组三个随机种子；采用同一数据、任务查询头结构和训练配方。</p><section id="result">正在载入实验结果…</section><section><h2>四组受控对照</h2><div class="table"><table><thead><tr><th>语义骨干</th><th>特征读取</th><th>新场景宏 F1</th><th>身体正确召回</th><th>情绪正确召回</th><th>特殊眼型正确召回</th></tr></thead><tbody id="table"></tbody></table></div><p class="muted">窄屏可左右滑动表格。表格为开发集三个种子的均值。合成标签、较小场景集及历史增强不能替代真实对话与人工自然度评价。这里的 0.8B 基线使用本轮统一查询头，和旧版在线选择器不同。</p></section>
<section><h2>实际连续表演 · 六段开发示例</h2><p>包含同一句话在不同语境下的情绪变化、单手问候、撒娇、强调重点和转述。视频回放真实流式表演的参数与原始语音；这些场景用于工程检查，未作为新盲测，也没有代填评分。</p><div id="clips" class="grid"></div></section></main>
<script>const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),pct=x=>(x*100).toFixed(1)+'%';
Promise.all([fetch('generalization-report.json').then(r=>r.json()),fetch('generalization-pairs.json').then(r=>r.json())]).then(([d,pairs])=>{document.getElementById('result').innerHTML=`<strong>候选：4B＋词元注意力。工程检查通过，质量门槛尚未通过，默认模型保留。</strong><p>独立终测有 ${d.test.unique_text_contexts} 个台词/语境组合、${d.test.scenario_families} 个场景家族。身体动作提议的误触发率为 ${pct(d.test.executed.body.false_positive_rate)}，目标不超过 4%；仍需优化。</p><p>新台词动作更新 P95 ${d.latency.action_update_p95_ms.toFixed(0)} ms，首音增加 ${d.latency.increase_ms.toFixed(0)} ms，含会话建立增加 ${d.latency.increase_including_setup_ms.toFixed(0)} ms。连续运行 ${(d.stress.wall_ms/1000).toFixed(0)} 秒，覆盖 ${d.stress.clauses} 个分句。</p>`;document.getElementById('table').innerHTML=d.ablation.map(r=>`<tr><td>${esc(r.repo.split('/').at(-1))}</td><td>${r.representation==='full_attention'?'词元注意力':'最后 16 词元平均'}</td><td>${pct(r.mean_new_macro_f1)}</td><td>${pct(r.mean_new_active_recall.body)}</td><td>${pct(r.mean_new_active_recall.emotion)}</td><td>${pct(r.mean_new_active_recall.eye)}</td></tr>`).join('');document.getElementById('clips').innerHTML=pairs.map(p=>`<article><h3>${esc(p.text)}</h3><p>${esc(p.context)}</p><video controls preload="none" poster="${esc(p.clips[0].poster)}" src="${esc(p.clips[0].video)}"></video><p class="muted">${esc(p.spoken_text)}</p></article>`).join('');});</script></html>'''

if __name__=='__main__':main()
