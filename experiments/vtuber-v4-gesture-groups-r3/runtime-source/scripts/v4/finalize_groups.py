"""Freeze the reviewed runtime sources and summarize actual action-group checks.

Console-only test counts must be supplied explicitly after those tests pass.
Browser results are read and checked here, never manufactured.
"""
import argparse
import hashlib
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'experiments/vtuber-v4-gesture-groups'

def read(path):
    return json.loads((ROOT / path).read_text(encoding='utf-8'))

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def write(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')

def main():
    parser = argparse.ArgumentParser()
    for name in ('unit-tests', 'streaming-tests', 'authoring-tests'):
        parser.add_argument('--'+name, type=int, required=True)
    args = parser.parse_args()
    paths = {
        'continuity':'test-results/v4/browser-verification-gesture-groups.json',
        'latency':'test-results/v4/latency-gesture-groups.json',
        'native_co_speech':'test-results/v4-groups/native-integration.json',
        'handoff':'test-results/v4/handoff-verification.json',
        'review':'test-results/v4/review-verification.json',
        'legacy':'test-results/verification.json',
        'dataset':'experiments/vtuber-v4-native/dataset-verification.json',
    }
    checks = {name:read(path) for name,path in paths.items()}
    assert all(check['ok'] for check in checks.values())
    assert checks['continuity']['runtime_version']=='v4.6-gesture-groups'
    assert checks['continuity']['stress']['wall_ms']>=600000
    assert all(checks[key]['runtime_version']=='v4.6-gesture-groups' for key in ('latency','native_co_speech','handoff'))
    assert checks['review']['ratings_unchanged']
    run = read('experiments/vtuber-v4-gesture-groups/run.json')
    run['gesture_library']['source_sha256']=sha(ROOT/'src/gesture-library.ts')
    run['body_human_accepted']=False
    run['promoted']=False
    if run.get('motion_policy',{}).get('version')!='v4.6-gesture-groups':
        run['retained_continuous_motion_policy']=run.get('motion_policy',{})
    run['motion_policy']={'version':'v4.6-gesture-groups','default_backend':'groups','default_style':'restrained','restrained_minimum_automatic_gap_ms':6000,'max_automatic_groups_per_clause':1,'phases':['enter','hold','exit','blend'],'default_hold_ms':1400,'automatic_grass_hold_ms':1800,'director_hold_range_ms':[0,15000],'variants_per_group':3,'clock':'actual audio progress, held on pause/underflow, wall-time tail after voice'}
    run['eligibility']['regression']={'status':'candidate','scope':'expression, idle and learned action-group selection; continuous arm outputs excluded','reason':'Coordinated groups passed live functional, continuity and latency checks; raw continuous arms failed quality checks; human action-group review pending.'}
    write(OUT/'run.json', run)
    source_paths = []
    for folder, suffixes in [('src',{'.ts','.css'}),('server',{'.ts'}),('latent',{'.py'}),('tests',{'.ts','.py'}),('scripts/v4',{'.py','.ts'})]:
        source_paths += [p for p in (ROOT/folder).glob('*') if p.suffix in suffixes]
    source_paths += [ROOT/p for p in ['package.json','package-lock.json','docs/performance-v4.md','docs/performance-tools.json','examples/performance_demo.py','latent/stream-run.json','latent/default-run.json','speech/features.py','speech/config.json','speech/model-source.json']]
    snapshot = OUT/'runtime-source'
    for source in source_paths:
        target=snapshot/source.relative_to(ROOT)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source,target)
    manifest = {str(p.relative_to(ROOT)).replace('\\','/'):sha(p) for p in source_paths}
    weights = {p.name:sha(p) for p in OUT.glob('*.pt')}
    stamp=datetime.now(timezone.utc).isoformat()
    write(OUT/'runtime-manifest.json', {'created_utc':stamp,'runtime_version':'v4.6-gesture-groups','run_sha256':sha(OUT/'run.json'),'selector_config_sha256':sha(OUT/'gesture-selector.json'),'sources':manifest,'weights':weights})
    records=OUT/'verification'
    records.mkdir(exist_ok=True)
    for name,path in paths.items():
        shutil.copy2(ROOT/path, records/(name+'.json'))
    selector=read('experiments/vtuber-v4-gesture-groups/gesture-selector.json')
    ratings=read('.runtime/performance/ratings.json')
    summary={
        'created_utc':stamp,'runtime_version':'v4.6-gesture-groups',
        'engineering_checks_passed':True,'promoted':False,'body_human_accepted':False,
        'new_blind_comparisons_completed':0,'action_groups':8,'variants_per_group':3,'preview_variants':16,
        'console_checks':{'unit_tests_passed':args.unit_tests,'streaming_tests_passed':args.streaming_tests,'authoring_tests_passed':args.authoring_tests,'source':'observed test-command results supplied by operator'},
        'evidence':{name:{'path':path,'sha256':sha(ROOT/path)} for name,path in paths.items()},
        'continuity':{k:v for k,v in checks['continuity']['stress'].items() if k!='metrics'},
        'actual_live_wave':checks['continuity']['explicit_gesture'],
        'latency':checks['latency']['summary'],
        'selector_validation':selector['validation'],'selector_test':selector['test'],
        'ratings_sha256':sha(ROOT/'.runtime/performance/ratings.json'),
        'pilot14_choice':ratings['pilot']['13']['choice'],
        'limitations':['synthetic semantic supervision only','continuous arm experts failed live quality checks','new action-group style and 24 blind comparisons await human review'],
    }
    write(OUT/'validation-summary.json',summary)
    print(json.dumps({k:summary[k] for k in ['engineering_checks_passed','promoted','body_human_accepted','action_groups','preview_variants']},ensure_ascii=False))

if __name__=='__main__':
    main()
