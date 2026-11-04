"""Freeze choreography revision evidence without reusing an old acceptance claim."""
import hashlib
import json
import shutil
from datetime import datetime,timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'experiments/vtuber-v4-gesture-groups-r2'
DATA=ROOT/'datasets/vtuber-v4-native/review/action-groups-v2'
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def read(path):return json.loads((ROOT/path).read_text(encoding='utf-8'))
def write(path,value):path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

def main():
    paths={'co_speech':'test-results/v4-groups-r2/native-integration.json','online':'test-results/v4/browser-verification-choreography-r2.json','latency':'test-results/v4/latency-choreography-r2.json','review':'test-results/v4-groups-r2/review-verification.json','manual_ui':'test-results/v4-groups-r2/manual-ui.json'}
    checks={k:read(p) for k,p in paths.items()}
    assert all(d['ok'] for d in checks.values())
    assert all(checks[k]['runtime_version']=='v4.7-choreography' for k in ('co_speech','online','latency'))
    assert checks['review']['variants']==24 and checks['review']['ratings_unchanged']
    assert 'pass 32' in (OUT/'unit-tests.log').read_text(encoding='utf-8')
    recorded=[]
    for folder in sorted(p for p in DATA.iterdir() if p.is_dir()):
        done=json.loads((folder/'done.json').read_text(encoding='utf-8'))
        source=folder.with_suffix('.json')
        assert done['input_sha256']==sha(source) and done['actual_finite']
        assert done['hz']==60 and done['image_hz']==30
        actual=json.loads((folder/'actual.json').read_text(encoding='utf-8'))
        assert len(actual['values'])>100
        recorded.append({'clip':folder.name,'input_sha256':sha(source),'actual_sha256':sha(folder/'actual.json'),'frames':len(actual['values']),'video_sha256':sha(folder.with_suffix('.mp4'))})
    assert len(recorded)==24
    run=read('experiments/vtuber-v4-gesture-groups-r2/run.json')
    run['gesture_library']['source_sha256']=sha(ROOT/'src/gesture-library.ts')
    run['gesture_library']['choreography_sha256']=sha(ROOT/'src/gesture-choreography.ts')
    run['eligibility']['regression']['reason']='Targeted co-speech, authored variants, online selection and latency checks passed; full-fist drawing unavailable; human quality and new full acceptance pending.'
    write(OUT/'run.json',run)
    source=[]
    for folder,exts in [('src',{'.ts','.css'}),('server',{'.ts'}),('tests',{'.ts','.py'}),('scripts/v4',{'.ts','.py'})]:source.extend(p for p in (ROOT/folder).glob('*') if p.suffix in exts)
    source.extend(ROOT/p for p in ['latent/streaming.py','latent/gesture_selector.py','latent/stream-run.json','latent/default-run.json','docs/performance-v4.md','docs/performance-tools.json','examples/performance_demo.py','README.md','package.json'])
    for p in source:
        target=OUT/'runtime-source'/p.relative_to(ROOT);target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,target)
    manifest={'created_utc':datetime.now(timezone.utc).isoformat(),'runtime_version':'v4.7-choreography','run_sha256':sha(OUT/'run.json'),'sources':{p.relative_to(ROOT).as_posix():sha(p) for p in source},'weights':{p.name:sha(p) for p in OUT.glob('*.pt')}}
    write(OUT/'runtime-manifest.json',manifest)
    summary={'runtime_version':'v4.7-choreography','targeted_checks_passed':True,'engineering_acceptance_complete':False,'human_accepted':False,'promoted':False,'full_fist_supported':False,'groups':8,'variants':24,'unit_tests_passed':32,'actual_recordings':recorded,'online_development_session_ms':checks['online']['stress']['wall_ms'],'new_ten_minute_test':False,'previous_ten_minute_evidence':'../vtuber-v4-gesture-groups/verification/continuity.json','latency':checks['latency']['summary'],'co_speech_acting':checks['co_speech']['acting'],'ratings_sha256':sha(ROOT/'.runtime/performance/ratings.json'),'pilot14_choice':read('.runtime/performance/ratings.json')['pilot']['13']['choice'],'evidence':{k:{'path':p,'sha256':sha(ROOT/p)} for k,p in paths.items()}}
    proof=OUT/'verification';proof.mkdir(exist_ok=True)
    for k,p in paths.items():shutil.copy2(ROOT/p,proof/(k+'.json'))
    write(OUT/'validation-summary.json',summary)
    print(json.dumps({'targeted_checks_passed':True,'actual_recordings':24,'full_fist_supported':False,'human_accepted':False,'promoted':False}))

if __name__=='__main__':main()
