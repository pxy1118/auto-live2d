"""Freeze the body composition candidate without promoting or changing weights."""
import hashlib,json,shutil
from datetime import datetime,timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'experiments/vtuber-v4-gesture-groups-r5'
DATA=ROOT/'datasets/vtuber-v4-native/review/action-groups-v5'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def read(p):return json.loads((ROOT/p).read_text(encoding='utf-8'))
def write(p,v):p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
def main():
    paths={k:f'test-results/v4-groups-r5/{file}.json' for k,file in [('render','render-verification'),('body','body-integration'),('co_speech','native-integration'),('review','review-verification')]}
    checks={k:read(p) for k,p in paths.items()};assert all(c['ok'] for c in checks.values())
    assert checks['body']['runtime_version']=='v4.10-body-composition' and checks['review']['variants']==39
    assert checks['render']['two_raised_arm_frames']==0 and len(checks['render']['clips'])==39
    assert sha(ROOT/'.runtime/performance/ratings.json')==read('experiments/vtuber-v4-gesture-groups-r4/validation-summary.json')['ratings_sha256']
    assert read('latent/default-run.json')['path']=='experiments/vtuber-v3'
    recordings=[]
    for p in sorted(DATA.glob('??-?.json')):
        done=read(p.with_suffix('')/'done.json');assert done['input_sha256']==sha(p) and done['actual_finite']
        assert p.with_suffix('.mp4').stat().st_mtime>=(p.with_suffix('')/'done.json').stat().st_mtime
        recordings.append({'clip':p.stem,'input_sha256':sha(p),'actual_sha256':sha(p.with_suffix('')/'actual.json'),'video_sha256':sha(p.with_suffix('.mp4'))})
    assert len(recordings)==39
    weights={p.name:sha(p) for p in OUT.glob('*.pt')}
    assert all(v==sha(ROOT/'experiments/vtuber-v4-gesture-groups-r4'/k) for k,v in weights.items())
    run=read('experiments/vtuber-v4-gesture-groups-r5/run.json')
    run['gesture_library'].update(source_sha256=sha(ROOT/'src/gesture-library.ts'),choreography_sha256=sha(ROOT/'src/gesture-choreography.ts'),body_motion_sha256=sha(ROOT/'src/body-motion.ts'))
    run['eligibility']['regression']['reason']='Body composition, actual render inputs, co-speech, pause/release/cancel and review UI checks passed. Independent body actions are authored tools, not newly trained labels. Human motion quality and full acceptance pending.'
    write(OUT/'run.json',run)
    source=[]
    for folder,exts in [('src',{'.ts','.css'}),('server',{'.ts'}),('tests',{'.ts','.py'}),('scripts/v4',{'.ts','.py'})]:source.extend(p for p in (ROOT/folder).glob('*') if p.suffix in exts)
    source.extend(ROOT/p for p in ['latent/stream-run.json','latent/default-run.json','latent/streaming.py','latent/gesture_selector.py','docs/performance-v4.md','docs/performance-tools.json','examples/performance_demo.py','README.md','package.json'])
    for p in source:
        target=OUT/'runtime-source'/p.relative_to(ROOT);target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,target)
    write(OUT/'runtime-manifest.json',{'created_utc':datetime.now(timezone.utc).isoformat(),'runtime_version':'v4.10-body-composition','run_sha256':sha(OUT/'run.json'),'sources':{p.relative_to(ROOT).as_posix():sha(p) for p in source},'weights':weights})
    for k,p in paths.items():target=OUT/'verification'/(k+'.json');target.parent.mkdir(exist_ok=True);shutil.copy2(ROOT/p,target)
    summary={'runtime_version':'v4.10-body-composition','targeted_checks_passed':True,'engineering_acceptance_complete':False,'human_accepted':False,'promoted':False,'hand_groups':7,'body_motions':5,'showcase_groups':13,'variants':39,'body_only_clips':15,'unit_tests_passed':40,'new_ten_minute_test':False,'new_latency_benchmark':False,'training_weights_unchanged':True,'actual_recordings':recordings,'total_actual_frames':checks['render']['total_frames'],'two_raised_arm_frames':0,'ratings_sha256':sha(ROOT/'.runtime/performance/ratings.json'),'pilot14_choice':read('.runtime/performance/ratings.json')['pilot']['13']['choice'],'evidence':{k:{'path':p,'sha256':sha(ROOT/p)} for k,p in paths.items()}}
    write(OUT/'validation-summary.json',summary);print(json.dumps({k:summary[k] for k in ['targeted_checks_passed','variants','body_only_clips','two_raised_arm_frames','promoted']}))
if __name__=='__main__':main()
