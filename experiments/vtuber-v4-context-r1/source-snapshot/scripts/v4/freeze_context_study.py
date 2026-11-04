"""Freeze actual new research and compare preserved artifacts, without final-test access."""
import argparse
import hashlib
import json
import shutil
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2];STUDY=ROOT/'research/vtuber-v4-context-study'
hashes={}
def sha(path):
    if path not in hashes:hashes[path]=hashlib.sha256(path.read_bytes()).hexdigest()
    return hashes[path]
def read(path):return json.loads(path.read_text(encoding='utf-8'))

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--observed-unit-tests',type=int,required=True);parser.add_argument('--typescript-check',action='store_true');args=parser.parse_args()
    r1=ROOT/'experiments/vtuber-v4-context-r1';code=ROOT/'experiments/vtuber-v4-context-code-r1';results=read(r1/'results.json');code_results=read(code/'results.json')
    assert not results['promoted'] and not results['old_test_loaded'] and not code_results['promoted'] and not code_results['old_test_loaded']
    assert results['protocol_sha256']==sha(STUDY/'protocol.json') and code_results['fingerprint']['protocol_sha256']==sha(STUDY/'code-protocol.json')
    cache=read(r1/'cache.json')
    for entry in cache['modes'].values():assert sha(ROOT/entry['path'])==entry['sha256']
    for run in results['runs']:assert sha(r1/f"{run['mode']}-{run['seed']}.pt")==run['checkpoint_sha256']
    old_results=read(ROOT/'experiments/vtuber-v4-intent-r2/results.json')
    for run in results['runs']:
        if run['mode']=='legacy_json':
            old=next(r for r in old_results['runs'] if r['method']=='joint_body_adapter' and r['seed']==run['seed'])
            assert run['development']==old['development'],'Legacy control did not reproduce previous results'
    old=read(ROOT/'research/vtuber-v4-intent-study/provenance.json')
    for path,entry in old['files'].items():assert sha(ROOT/path)==entry['sha256'],path
    before=read(STUDY/'runtime-before.json');after=read(STUDY/'runtime-after.json');assert after['files_unchanged']
    for path,digest in before['files'].items():assert sha(ROOT/path)==digest
    browser=read(ROOT/'test-results/v4-context-study/review-browser.json');assert browser['ok']
    reference=read(ROOT/'datasets/vtuber-v4/review/body-strength-references/manifest.json');assert len(reference['clips'])==18 and reference['ok']
    assert sha(ROOT/'src/body-motion.ts')==reference['curve_sha256']
    for clip in reference['clips']:
        folder=ROOT/'test-results/v4-context-study/body-calibration'/clip['id']
        assert sha(folder/'input.json')==clip['input_sha256'] and sha(folder/'actual.json.gz')==clip['recording_sha256']
        assert sha(ROOT/'datasets/vtuber-v4/review'/clip['video'])==clip['video_sha256']
        assert sha(ROOT/'datasets/vtuber-v4/review'/clip['poster'])==clip['poster_sha256']
    source_paths=[ROOT/p for p in [
        'latent/common.py','latent/semantic_tokens.py','latent/planner_contract.py','latent/intent_study.py',
        'latent/run_intent_study.py','latent/run_intent_adapter_study.py','latent/cache_intent_features.py','latent/cache_intent_tokens.py',
        'src/body-motion.ts','src/engine.ts','src/controller.ts','src/performance.ts','src/performance-profile.ts',
        'latent/encoders/qwen3.5-4b.json','latent/pyproject.toml','latent/uv.lock','package.json','package-lock.json',
        'tests/performance-context-study-review.ts']]
    source_paths += [p for folder in ['latent','scripts/v4'] for p in (ROOT/folder).glob('*') if p.is_file() and ('context' in p.name or p.name in ['capture_body_calibration.ts','encode_body_calibration.py'])]
    for source in set(source_paths):
        target=r1/'source-snapshot'/source.relative_to(ROOT);target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source,target)
    files=set(source_paths)
    for folder in [STUDY,r1,code,ROOT/'test-results/v4-context-study',ROOT/'datasets/vtuber-v4/review/body-strength-references']:
        files.update(p for p in folder.rglob('*') if p.is_file() and '__pycache__' not in p.parts and p.name!='provenance.json')
    files.update(ROOT/'datasets/vtuber-v4/review'/name for name in ['context-study.html','context-study-report.json','context-study-scenes.json'])
    manifest=dict(schema='context-study-provenance.v1',promoted=False,old_final_test_loaded=False,new_final_test_created=False,
        preserved_prior_artifacts=len(old['files']),legacy_controls_reproduced=3,training_runs=len(results['runs']),
        direct_generations=len(read(r1/'direct-generation.json')['records']),code_prefills=len(read(code/'readouts.json')['records']),
        body_clips=18,actual_parameter_frames=sum(c['frames'] for c in reference['clips']),
        observed_console_checks=dict(context_unit_tests=args.observed_unit_tests,typescript_check=args.typescript_check,
            evidence='Observed command results supplied by operator; not manufactured from static inspection'),browser_checks=browser['checks'],
        files={str(p.relative_to(ROOT)).replace('\\','/'):dict(sha256=sha(p),bytes=p.stat().st_size) for p in sorted(files)},
        scope='Development-only. No naturalness acceptance or concurrent TTS/latency acceptance; default and old ratings unchanged.')
    (STUDY/'provenance.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({k:manifest[k] for k in ['preserved_prior_artifacts','legacy_controls_reproduced','training_runs','direct_generations','code_prefills','body_clips','actual_parameter_frames','promoted']}),flush=True)
if __name__=='__main__':main()
