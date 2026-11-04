"""Hash the actual artifacts and source of the completed, unpromoted research run."""
import hashlib
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'research/vtuber-v4-intent-study'
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def read(path):return json.loads(path.read_text(encoding='utf-8'))

def main():
    files=[]
    for rel in ['latent','scripts/v4','research/vtuber-v4-intent-study','datasets/vtuber-v4-intent-v1',
                'experiments/vtuber-v4-intent-r1','experiments/vtuber-v4-intent-r2','test-results/v4-intent-study']:
        folder=ROOT/rel
        if rel in ['latent','scripts/v4']:files.extend(p for p in folder.iterdir() if p.is_file() and 'intent' in p.name)
        else:files.extend(p for p in folder.rglob('*') if p.is_file() and '__pycache__' not in p.parts and p.name!='provenance.json')
    files.extend(ROOT/p for p in ['tests/performance-intent-study-review.ts','latent/default-run.json','latent/stream-run.json',
        'latent/encoder.py','latent/encoder-source.json','latent/encoders/qwen3.5-4b.json','latent/uv.lock',
        'datasets/vtuber-v4/review/intent-study.html','datasets/vtuber-v4/review/intent-study-report.json',
        'datasets/vtuber-v4/review/intent-study-scenes.json'])
    base=ROOT/'experiments/vtuber-v4-generalization-r1/selected-planner.pt'
    assert sha(base)=='053fd98de35fa065f50fd8e86f0031fa5d1730b8544785363c4b803192d5cfa8'
    for phase in ['r1','r2']:
        folder=ROOT/f'experiments/vtuber-v4-intent-{phase}';result=read(folder/'results.json')
        assert not result['old_test_loaded'] and not result['promoted']
        for run in result['runs']:assert sha(folder/f"{run['method']}-{run['seed']}.pt")==run['checkpoint_sha256']
    manifest=read(ROOT/'datasets/vtuber-v4-intent-v1/manifest.json')
    for name,digest in manifest['files'].items():assert sha(ROOT/'datasets/vtuber-v4-intent-v1'/name)==digest
    browser=read(ROOT/'test-results/v4-intent-study/review-browser.json');assert browser['ok']
    assert sha(ROOT/'.runtime/performance/ratings.json')==browser['rating_before']
    value=dict(schema='intent-study-provenance.v1',promoted=False,old_final_test_loaded=False,new_final_test_created=False,
        original_base_sha256=sha(base),human_ratings_sha256=browser['rating_before'],
        files={str(p.relative_to(ROOT)).replace('\\','/'):dict(sha256=sha(p),bytes=p.stat().st_size) for p in sorted(set(files))},
        note='Research artifacts only. Timing of feature extraction/head fitting is not end-to-end latency. No runtime candidate or human preference acceptance.')
    (OUT/'provenance.json').write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(dict(files=len(value['files']),base_verified=True,ratings_unchanged=True,promoted=False)))
if __name__=='__main__':main()
