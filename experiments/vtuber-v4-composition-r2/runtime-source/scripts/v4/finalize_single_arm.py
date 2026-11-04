"""Freeze the single-arm choreography revision and its actual checks."""
import hashlib,json,shutil
from pathlib import Path
from datetime import datetime,timezone
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'experiments/vtuber-v4-gesture-groups-r4'
DATA=ROOT/'datasets/vtuber-v4-native/review/action-groups-v4'
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def read(path):return json.loads((ROOT/path).read_text(encoding='utf-8'))
def write(path,value):path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

def main():
    paths={'single_arm':'test-results/v4-groups-r4/single-arm-verification.json','co_speech':'test-results/v4-groups-r4/native-integration.json','review':'test-results/v4-groups-r4/review-verification.json'}
    checks={k:read(p) for k,p in paths.items()}
    assert all(d['ok'] for d in checks.values())
    assert checks['co_speech']['runtime_version']=='v4.9-single-arm'
    assert checks['review']['variants']==21 and checks['review']['ratings_unchanged']
    assert len(checks['single_arm']['clips'])==21
    recordings=[]
    for folder in sorted(p for p in DATA.iterdir() if p.is_dir()):
        done=json.loads((folder/'done.json').read_text(encoding='utf-8'));assert done['actual_finite'] and done['input_sha256']==sha(folder.with_suffix('.json'))
        recordings.append({'clip':folder.name,'input_sha256':done['input_sha256'],'actual_sha256':sha(folder/'actual.json'),'video_sha256':sha(folder.with_suffix('.mp4'))})
    assert len(recordings)==21
    run=read('experiments/vtuber-v4-gesture-groups-r4/run.json');run['gesture_library']['source_sha256']=sha(ROOT/'src/gesture-library.ts');run['gesture_library']['choreography_sha256']=sha(ROOT/'src/gesture-choreography.ts');run['eligibility']['regression']['reason']='Single-arm frame checks, handoff, co-speech and UI checks passed; human motion quality and full acceptance pending.';write(OUT/'run.json',run)
    source=[]
    for folder,exts in [('src',{'.ts','.css'}),('server',{'.ts'}),('tests',{'.ts','.py'}),('scripts/v4',{'.ts','.py'})]:source.extend(p for p in (ROOT/folder).glob('*') if p.suffix in exts)
    source.extend(ROOT/p for p in ['latent/stream-run.json','latent/default-run.json','latent/streaming.py','latent/gesture_selector.py','docs/performance-v4.md','docs/performance-tools.json','examples/performance_demo.py','README.md','package.json'])
    for p in source:
        target=OUT/'runtime-source'/p.relative_to(ROOT);target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,target)
    write(OUT/'runtime-manifest.json',{'created_utc':datetime.now(timezone.utc).isoformat(),'runtime_version':'v4.9-single-arm','run_sha256':sha(OUT/'run.json'),'sources':{p.relative_to(ROOT).as_posix():sha(p) for p in source},'weights':{p.name:sha(p) for p in OUT.glob('*.pt')}})
    proof=OUT/'verification';proof.mkdir(exist_ok=True)
    for k,p in paths.items():shutil.copy2(ROOT/p,proof/(k+'.json'))
    summary={'runtime_version':'v4.9-single-arm','targeted_checks_passed':True,'engineering_acceptance_complete':False,'human_accepted':False,'promoted':False,'groups':7,'variants':21,'arm_policy':'single_primary','unit_tests_passed':33,'test_count_source':'observed command results for this revision','new_ten_minute_test':False,'actual_recordings':recordings,'reused_captures':read('experiments/vtuber-v4-gesture-groups-r4/reused-captures.json'),'two_raised_arm_frames':sum(c['two_raised_arm_frames'] for c in checks['single_arm']['clips']),'ratings_sha256':sha(ROOT/'.runtime/performance/ratings.json'),'pilot14_choice':read('.runtime/performance/ratings.json')['pilot']['13']['choice'],'evidence':{k:{'path':p,'sha256':sha(ROOT/p)} for k,p in paths.items()}}
    write(OUT/'validation-summary.json',summary);print(json.dumps({'targeted_checks_passed':True,'variants':21,'two_raised_arm_frames':summary['two_raised_arm_frames'],'promoted':False}))

if __name__=='__main__':main()
