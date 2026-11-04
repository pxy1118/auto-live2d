"""Publish a concrete, verified blind review. Human votes are never generated."""
import hashlib,json,shutil
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];REVIEW=ROOT/'datasets/vtuber-v4/review';EXP=ROOT/'experiments/vtuber-v4-composition-r1'
def read(p):return json.loads(p.read_text(encoding='utf-8'))
def main():
    browser=read(ROOT/'test-results/v4/browser-verification-composition-r1.json');latency=read(ROOT/'test-results/v4/latency-composition-r1.json');recording=read(ROOT/'test-results/v4-composition/recordings.json');functional=read(ROOT/'test-results/v4-composition/planner-browser.json')
    assert all(r['ok'] for r in [browser,latency,recording,functional]);assert browser['runtime_version']=='v4.12.1-composition-planner';assert browser['stress']['wall_ms']>=600000;assert browser['stress']['two_raised_arm_samples']==0
    pairs=read(REVIEW/'comparison-pairs-composition-r1.json');assert len(pairs)==24
    for pair in pairs:
        for c in pair['clips']:
            video=REVIEW/c['video'];done=video.with_suffix('')/'done.json';assert video.exists() and video.stat().st_mtime>=done.stat().st_mtime
            assert (REVIEW/c['poster']).is_file()
    baseline=EXP/'ratings-before-comparison.json'
    if not baseline.exists():shutil.copy2(ROOT/'.runtime/performance/ratings.json',baseline)
    archive=REVIEW/'comparison-pairs-legacy-v4.json'
    if not archive.exists():shutil.copy2(REVIEW/'comparison-pairs.json',archive)
    shutil.copy2(REVIEW/'comparison-pairs-composition-r1.json',REVIEW/'comparison-pairs.json')
    status={'blocked':False,'dataset_version':'composition-r1','pairs':24,'minimum_new_preferences':16,'human_acceptance_pending':True,'same_audio_and_duration':True,'video_fps':30,'scope':'whole-utterance model proposals; streaming continuity verified separately','message':'24 组自动表演盲测已可查看。请综合语义贴合、自然度、情绪可读性和重复感选择，评分自动保存。'}
    (REVIEW/'comparison-status.json').write_text(json.dumps(status,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'published_pairs':24,'dataset_version':'composition-r1','human_votes_written':False}))
if __name__=='__main__':main()
