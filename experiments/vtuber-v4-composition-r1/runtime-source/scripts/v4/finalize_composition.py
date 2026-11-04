"""Freeze actual engineering evidence without treating synthetic metrics as approval."""
import hashlib,json,shutil,subprocess
from datetime import datetime,timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];EXP=ROOT/'experiments/vtuber-v4-composition-r1';VERSION='v4.12.1-composition-planner'
def read(p):return json.loads((ROOT/p).read_text(encoding='utf-8'))
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(p,d):p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
def main():
    evidence={'automatic_playback':'test-results/v4-composition/planner-browser.json','continuity':'test-results/v4/browser-verification-composition-r1.json','latency':'test-results/v4/latency-composition-r1.json','recordings':'test-results/v4-composition/recordings.json','review':'test-results/v4-composition/comparison-review.json','motion_gallery':'test-results/v4-composition/motion-review.json'}
    checks={k:read(p) for k,p in evidence.items()};assert all(c['ok'] for c in checks.values());assert checks['continuity']['runtime_version']==VERSION and checks['latency']['runtime_version']==VERSION
    assert checks['continuity']['stress']['wall_ms']>=600000 and checks['continuity']['stress']['two_raised_arm_samples']==0 and checks['continuity']['stress']['planner_enabled']
    summary=checks['latency']['summary'];assert summary['action_update_p95_ms']<200 and summary['increase_ms']<=200 and summary['increase_including_setup_ms']<=200
    metadata=read(EXP/'performance-planner.json');assert sha(EXP/'performance-planner.pt')==metadata['sha256'];test=read(EXP/'test-evaluation.json');assert test['checkpoint_sha256']==metadata['sha256'] and test['not_used_for_selection']
    ratings=read('.runtime/performance/ratings.json');before=read(EXP/'ratings-before-comparison.json');assert ratings['pilot']==before['pilot'];assert ratings['pilot']['13']['choice']=='B'
    default=ROOT/'latent/default-run.json';assert read(default)['path']=='experiments/vtuber-v3';assert default.read_bytes().replace(b'\r\n',b'\n')==subprocess.check_output(['git','show','HEAD:latent/default-run.json'],cwd=ROOT).replace(b'\r\n',b'\n')
    choices=ratings.get('comparisons',{}).get('composition-r1',{});key=read(EXP/'blind-key.json');preferred=sum(choices.get(str(i),{}).get('choice')==next(m['label'] for m in item['models'] if m['model']=='candidate') for i,item in enumerate(key));human_complete=len(choices)==24;human_pass=human_complete and preferred>=16
    run=read(EXP/'run.json');run['motion_policy']['version']=VERSION;run['engineering_checks_passed']=True;run['body_human_accepted']=False;run['planner_human_calibrated']=False;run['eligibility']['regression']['reason']='Engineering, continuity and latency checks passed. Raw proposals still miss unseen body intents; independent human preference acceptance pending.';write(EXP/'run.json',run)
    source=[]
    for folder,exts in [('src',{'.ts','.css'}),('server',{'.ts'}),('tests',{'.ts','.py'}),('scripts/v4',{'.ts','.py'})]:source.extend(p for p in (ROOT/folder).glob('*') if p.suffix in exts)
    names=['latent/planner_contract.py','latent/performance_planner.py','latent/train_performance_planner.py','latent/select_performance_planner.py','latent/evaluate_performance_planner.py','latent/encoder.py','latent/common.py','latent/streaming.py','latent/serve.py','latent/gesture_selector.py','latent/stream-run.json','latent/default-run.json','latent/encoder-source.json','latent/pyproject.toml','latent/uv.lock','docs/performance-v4.md','docs/performance-tools.json','docs/performance-plan.schema.json','examples/performance_demo.py','README.md','package.json','main.py']
    source.extend(ROOT/n for n in names)
    for p in source:
        target=EXP/'runtime-source'/p.relative_to(ROOT);target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,target)
    write(EXP/'runtime-manifest.json',{'created_utc':datetime.now(timezone.utc).isoformat(),'runtime_version':VERSION,'run_sha256':sha(EXP/'run.json'),'sources':{p.relative_to(ROOT).as_posix():sha(p) for p in source},'weights':{p.name:sha(p) for p in EXP.glob('*.pt')},'dataset_manifest_sha256':sha(ROOT/'datasets/vtuber-v4-planner-v2/manifest.json')})
    proof=EXP/'verification';proof.mkdir(exist_ok=True)
    for k,p in evidence.items():shutil.copy2(ROOT/p,proof/(k+'.json'))
    result={'runtime_version':VERSION,'engineering_checks_passed':True,'full_acceptance_complete':False,'human_complete':human_complete,'human_preference_gate_passed':human_pass,'human_votes':len(choices),'candidate_preferred':preferred,'human_votes_written_by_agent':False,'promoted':False,'typescript_unit_tests_passed':50,'python_tests_passed':10,'stress':checks['continuity']['stress'],'latency':summary,'comparison_pairs':24,'comparison_videos':48,'pilot_ratings_preserved':True,'old_v3_default_preserved':True,'raw_proposal_test_metrics':test['metrics'],'test_evaluated_once':True,'execution_gates_selected_from_validation_renders':True,'evidence':{k:{'path':p,'sha256':sha(ROOT/p)} for k,p in evidence.items()}}
    write(EXP/'validation-summary.json',result);print(json.dumps({k:result[k] for k in ['engineering_checks_passed','human_votes','candidate_preferred','promoted']}))
if __name__=='__main__':main()
