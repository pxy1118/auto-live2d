"""Freeze native-joint palm-wave evidence; never promote subjective acceptance."""
import hashlib,json,shutil
from pathlib import Path
from datetime import datetime,timezone
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'experiments/vtuber-v4-gesture-groups-r3'
DATA=ROOT/'datasets/vtuber-v4-native/review/action-groups-v3'
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def read(path):return json.loads((ROOT/path).read_text(encoding='utf-8'))
def write(path,value):path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

def main():
    paths={'joints':'test-results/v4-groups-r3/joint-verification.json','co_speech_development':'test-results/v4-groups-r3/native-integration.json','online_release':'test-results/v4/browser-verification-native-palm-r3.json','retirement_release':'test-results/v4-groups-r3/retirement-live.json','review':'test-results/v4-groups-r3/review-verification.json'}
    checks={k:read(p) for k,p in paths.items()}
    assert all(d['ok'] for d in checks.values())
    assert checks['online_release']['runtime_version']==checks['retirement_release']['runtime_version']=='v4.8-native-palm'
    assert checks['review']['variants']==21 and checks['review']['ratings_unchanged']
    recordings=[]
    for folder in sorted(p for p in DATA.iterdir() if p.is_dir()):
        done=json.loads((folder/'done.json').read_text(encoding='utf-8'))
        assert done['actual_finite'] and done['input_sha256']==sha(folder.with_suffix('.json'))
        recordings.append({'clip':folder.name,'input_sha256':done['input_sha256'],'actual_sha256':sha(folder/'actual.json'),'video_sha256':sha(folder.with_suffix('.mp4'))})
    assert len(recordings)==21
    run=read('experiments/vtuber-v4-gesture-groups-r3/run.json')
    run['gesture_library']['source_sha256']=sha(ROOT/'src/gesture-library.ts');run['gesture_library']['choreography_sha256']=sha(ROOT/'src/gesture-choreography.ts')
    run['eligibility']['regression']['reason']='Native point-joint palm waves, retired-class protection, actual rendering and release online checks passed; human quality and full acceptance pending.'
    write(OUT/'run.json',run)
    source=[]
    for folder,exts in [('src',{'.ts','.css'}),('server',{'.ts'}),('tests',{'.ts','.py'}),('latent',{'.py'}),('scripts/v4',{'.ts','.py'})]:source.extend(p for p in (ROOT/folder).glob('*') if p.suffix in exts)
    source.extend(ROOT/p for p in ['latent/stream-run.json','latent/default-run.json','docs/performance-v4.md','docs/performance-tools.json','examples/performance_demo.py','README.md','package.json'])
    for p in source:
        target=OUT/'runtime-source'/p.relative_to(ROOT);target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,target)
    write(OUT/'runtime-manifest.json',{'created_utc':datetime.now(timezone.utc).isoformat(),'runtime_version':'v4.8-native-palm','run_sha256':sha(OUT/'run.json'),'sources':{p.relative_to(ROOT).as_posix():sha(p) for p in source},'weights':{p.name:sha(p) for p in OUT.glob('*.pt')}})
    proof=OUT/'verification';proof.mkdir(exist_ok=True)
    for k,p in paths.items():shutil.copy2(ROOT/p,proof/(k+'.json'))
    summary={'runtime_version':'v4.8-native-palm','targeted_checks_passed':True,'engineering_acceptance_complete':False,'human_accepted':False,'promoted':False,'groups':7,'variants':21,'retired_gestures':['cheer'],'unit_tests_passed':32,'python_tests_passed':17,'test_count_source':'observed command results for this revision','new_ten_minute_test':False,'online_scope':'real two-clause TTS, learned selection, directives, pause, cancel and duplicate request regression; stress phase disabled','co_speech_development_version':checks['co_speech_development']['runtime_version'],'actual_recordings':recordings,'joint_comparison':checks['joints'],'reused_captures':read('experiments/vtuber-v4-gesture-groups-r3/reused-captures.json'),'ratings_sha256':sha(ROOT/'.runtime/performance/ratings.json'),'pilot14_choice':read('.runtime/performance/ratings.json')['pilot']['13']['choice'],'evidence':{k:{'path':p,'sha256':sha(ROOT/p)} for k,p in paths.items()}}
    write(OUT/'validation-summary.json',summary)
    print(json.dumps({'targeted_checks_passed':True,'groups':7,'variants':21,'retired':['cheer'],'human_accepted':False,'promoted':False}))

if __name__=='__main__':main()
