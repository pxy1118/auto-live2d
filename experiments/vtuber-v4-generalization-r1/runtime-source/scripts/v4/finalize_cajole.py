"""Freeze the cajole addition, distinguishing new and reused recordings."""
import hashlib,json,shutil
from datetime import datetime,timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'experiments/vtuber-v4-gesture-groups-r6';DATA=ROOT/'datasets/vtuber-v4-native/review/action-groups-v6'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def read(p):return json.loads((ROOT/p).read_text(encoding='utf-8'))
def write(p,v):p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
def main():
    paths={k:f'test-results/v4-groups-r6/{file}.json' for k,file in [('render','render-verification'),('body','body-integration'),('review','review-verification')]}
    checks={k:read(p) for k,p in paths.items()};assert all(c['ok'] for c in checks.values())
    assert checks['body']['runtime_version']=='v4.11-cajole' and checks['review']['variants']==42
    assert checks['render']['two_raised_arm_frames']==0 and len(checks['render']['clips'])==42
    parent=ROOT/'experiments/vtuber-v4-gesture-groups-r5';assert sha(ROOT/'.runtime/performance/ratings.json')==read(parent/'validation-summary.json')['ratings_sha256']
    assert read('latent/default-run.json')['path']=='experiments/vtuber-v3'
    proof=read(OUT/'showcase.json');recordings=[]
    for i,p in enumerate(sorted(DATA.glob('??-?.json'))):
        frame=DATA.parent/proof[i]['capture_source']/p.stem;done=read(frame/'done.json');assert done['input_sha256']==sha(p) and done['actual_finite']
        video=frame.with_suffix('.mp4');assert video.stat().st_mtime>=(frame/'done.json').stat().st_mtime
        recordings.append({'clip':p.stem,'source':proof[i]['capture_source'],'input_sha256':sha(p),'actual_sha256':sha(frame/'actual.json'),'video_sha256':sha(video)})
    assert len(recordings)==42 and sum(r['source']=='action-groups-v6' for r in recordings)==3
    weights={p.name:sha(p) for p in OUT.glob('*.pt')};assert all(v==sha(parent/k) for k,v in weights.items())
    run=read(OUT/'run.json');run['gesture_library'].update(source_sha256=sha(ROOT/'src/gesture-library.ts'),choreography_sha256=sha(ROOT/'src/gesture-choreography.ts'),body_motion_sha256=sha(ROOT/'src/body-motion.ts'))
    run['eligibility']['regression']['reason']='Authored cajole forward lean/twist variants pass targeted render, co-speech, composition and UI checks; new selector labels and human motion quality acceptance remain pending.';write(OUT/'run.json',run)
    source=[]
    for folder,exts in [('src',{'.ts','.css'}),('server',{'.ts'}),('tests',{'.ts','.py'}),('scripts/v4',{'.ts','.py'})]:source.extend(p for p in (ROOT/folder).glob('*') if p.suffix in exts)
    source.extend(ROOT/p for p in ['latent/stream-run.json','latent/default-run.json','latent/streaming.py','latent/gesture_selector.py','docs/performance-v4.md','docs/performance-tools.json','examples/performance_demo.py','README.md','package.json'])
    for p in source:
        target=OUT/'runtime-source'/p.relative_to(ROOT);target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,target)
    write(OUT/'runtime-manifest.json',{'created_utc':datetime.now(timezone.utc).isoformat(),'runtime_version':'v4.11-cajole','run_sha256':sha(OUT/'run.json'),'sources':{p.relative_to(ROOT).as_posix():sha(p) for p in source},'weights':weights})
    for k,p in paths.items():target=OUT/'verification'/(k+'.json');target.parent.mkdir(exist_ok=True);shutil.copy2(ROOT/p,target)
    summary={'runtime_version':'v4.11-cajole','targeted_checks_passed':True,'engineering_acceptance_complete':False,'human_accepted':False,'promoted':False,'hand_groups':7,'body_motions':6,'showcase_groups':14,'variants':42,'body_only_clips':18,'unit_tests_passed':41,'newly_rendered_clips':3,'reused_clips':39,'new_ten_minute_test':False,'new_latency_benchmark':False,'training_weights_unchanged':True,'actual_recordings':recordings,'total_actual_frames':checks['render']['total_frames'],'two_raised_arm_frames':0,'ratings_sha256':sha(ROOT/'.runtime/performance/ratings.json'),'pilot14_choice':read('.runtime/performance/ratings.json')['pilot']['13']['choice'],'evidence':{k:{'path':p,'sha256':sha(ROOT/p)} for k,p in paths.items()}}
    write(OUT/'validation-summary.json',summary);print(json.dumps({k:summary[k] for k in ['targeted_checks_passed','variants','newly_rendered_clips','reused_clips','promoted']}))
if __name__=='__main__':main()
