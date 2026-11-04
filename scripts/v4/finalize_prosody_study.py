"""Freeze measured, development-only research; never promote it or invent votes."""
import argparse
import hashlib
import json
import shutil
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
STUDY=ROOT/'research/vtuber-v4-prosody-study'
EXP=ROOT/'experiments/vtuber-v4-prosody-r1'


def read(p):
    return json.loads(p.read_text(encoding='utf-8'))


def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--observed-js-tests',type=int,required=True)
    parser.add_argument('--observed-python-tests',type=int,required=True);args=parser.parse_args()
    result=read(STUDY/'results.json');browser=read(ROOT/'test-results/v4-prosody-study/review-browser.json')
    assert browser['ok'] and result['actual_parameter_frames']==17829 and result['clips']==24
    assert not result['trained'] and not result['promoted'] and not result['final_test_loaded'] and result['human_votes']==0
    for p,h in read(STUDY/'runtime-before.json')['files'].items():assert sha(ROOT/p)==h,p
    for p,h in result['source_hashes'].items():assert sha(ROOT/p)==h,p
    assert result['paired_action_counts_matched']
    assert read(STUDY/'blinding.json')['balanced_positions']
    for clip in result['clip_diagnostics']:
        folder=ROOT/'test-results/v4-prosody-study'/clip['id']
        assert sha(folder/'input.json.gz')==clip['input_sha256']
        assert sha(folder/'actual.json.gz')==clip['recording_sha256']
        assert sha(ROOT/'datasets/vtuber-v4/review'/clip['video'])==clip['video_sha256']
        assert clip['two_raised_arm_samples']==0 and clip['out_of_range_inputs']==0
    EXP.mkdir(parents=True,exist_ok=True)
    sources=[ROOT/p for p in [
        'src/engine.ts','src/controller.ts','src/gesture-library.ts','src/gesture-choreography.ts','src/body-motion.ts',
        'src/motion.ts','speech/features.py','package.json','package-lock.json','tests/prosody-study.test.ts',
        'tests/test_prosody_audio.py','tests/prosody-study-review.ts']]
    sources+=list(STUDY.glob('*.ts'))+list(STUDY.glob('*.html'))
    sources+=list((ROOT/'scripts/v4').glob('*prosody_study*'))
    for source in sources:
        target=EXP/'source-snapshot'/source.relative_to(ROOT);target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source,target)
    shutil.copyfile(STUDY/'results.json',EXP/'results.json');shutil.copyfile(STUDY/'REPORT.md',EXP/'REPORT.md')
    evidence=dict(schema='prosody-research-evidence.v1',promoted=False,trained=False,human_naturalness_accepted=False,
        final_test_loaded=False,observed_tests=dict(javascript=args.observed_js_tests,python=args.observed_python_tests,typescript_check=True),
        browser_checks=browser['checks'],scenes=8,real_tts_turns=16,actual_cubism_clips=24,actual_frames=17829,
        original_default_and_human_ratings_unchanged=True,semantic_model_used=False,
        online_latency_measured=False,learned_timing_model_trained=False,
        failures_retained=['bootstrap-failure-detailed.json','encoding-first-failure.json','ui-selector-failure.json','ui-http-seek-failure.json'])
    (EXP/'study.json').write_text(json.dumps(evidence,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    files=set(sources)
    for folder in [STUDY,EXP,ROOT/'datasets/vtuber-v4-prosody-r1',ROOT/'test-results/v4-prosody-study',ROOT/'datasets/vtuber-v4/review/prosody-r1']:
        files.update(p for p in folder.rglob('*') if p.is_file() and '__pycache__' not in p.parts and p.name!='provenance.json')
    files.update(ROOT/'datasets/vtuber-v4/review'/name for name in ['prosody-study.html','prosody-study-report.json','prosody-study-scenes.json'])
    provenance=dict(**evidence,files={str(p.relative_to(ROOT)).replace('\\','/'):dict(sha256=sha(p),bytes=p.stat().st_size) for p in sorted(files)})
    (STUDY/'provenance.json').write_text(json.dumps(provenance,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(dict(frozen_files=len(files),frames=17829,clips=24,trained=False,promoted=False,human_votes=0)),flush=True)


if __name__=='__main__':main()
