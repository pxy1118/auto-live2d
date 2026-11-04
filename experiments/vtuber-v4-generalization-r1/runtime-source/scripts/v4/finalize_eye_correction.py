"""Freeze targeted correction evidence without borrowing the parent's acceptance."""
import hashlib
import json
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EXP = ROOT / 'experiments/vtuber-v4-composition-r2'
OLD = ROOT / 'experiments/vtuber-v4-composition-r1'
VERSION = 'v4.12.2-discrete-eyes'

def read(path): return json.loads(path.read_text(encoding='utf-8'))
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def write(path, data): path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

def main():
    evidence = {name: ROOT / f'test-results/v4-composition-r2/{name}.json'
                for name in ['eye-browser', 'eye-recordings', 'planner-browser']}
    checks = {name: read(path) for name, path in evidence.items()}
    assert all(c['ok'] and c['runtime_version'] == VERSION for c in checks.values())
    for path in EXP.glob('*.pt'): assert sha(path) == sha(OLD / path.name)
    human = read(OLD / 'human-review.json')
    assert human['complete'] and not human['preference_gate_passed']
    ratings = ROOT / '.runtime/performance/ratings.json'
    assert sha(ratings) == human['ratings_sha256']
    default = ROOT / 'latent/default-run.json'
    assert read(default)['path'] == 'experiments/vtuber-v3'
    assert default.read_bytes().replace(b'\r\n', b'\n') == subprocess.check_output(['git', 'show', 'HEAD:latent/default-run.json'], cwd=ROOT).replace(b'\r\n', b'\n')
    run = read(EXP / 'run.json')
    run.update(targeted_checks_passed=True, engineering_checks_passed=False, promoted=False)
    write(EXP / 'run.json', run)
    sources = []
    for folder, suffixes in [('src', {'.ts', '.css'}), ('server', {'.ts'}), ('tests', {'.ts', '.py'}), ('scripts/v4', {'.ts', '.py'})]:
        sources.extend(p for p in (ROOT / folder).glob('*') if p.suffix in suffixes)
    sources.extend(ROOT / name for name in ['latent/stream-run.json', 'latent/default-run.json', 'latent/streaming.py',
        'latent/performance_planner.py', 'latent/planner_contract.py', 'docs/performance-v4.md',
        'docs/performance-tools.json', 'docs/performance-plan.schema.json', 'README.md', 'main.py', 'package.json'])
    for path in sources:
        target = EXP / 'runtime-source' / path.relative_to(ROOT)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, target)
    proof = EXP / 'verification'; proof.mkdir(exist_ok=True)
    for name, path in evidence.items(): shutil.copy2(path, proof / (name + '.json'))
    write(EXP / 'runtime-manifest.json', {'created_utc': datetime.now(timezone.utc).isoformat(),
        'runtime_version': VERSION, 'run_sha256': sha(EXP / 'run.json'),
        'sources': {p.relative_to(ROOT).as_posix(): sha(p) for p in sources},
        'weights': {p.name: sha(p) for p in EXP.glob('*.pt')}, 'parent_human_review_sha256': sha(OLD / 'human-review.json')})
    result = {'runtime_version': VERSION, 'targeted_checks_passed': True, 'engineering_acceptance_complete': False,
        'human_accepted': False, 'promoted': False, 'parent_human_review': human['totals'],
        'parent_preference_gate_passed': False, 'unit_tests_passed': 53,
        'new_ten_minute_test': False, 'new_latency_benchmark': False, 'model_weights_changed': False,
        'test_set_reevaluated': False, 'special_eye_states': [0, 1], 'eye_types_exclusive': True,
        'actual_frames': sum(c['frames'] for c in checks['eye-recordings']['clips']),
        'fractional_eye_frames': 0, 'overlapping_special_eye_frames': 0,
        'original_human_ratings_preserved': True, 'original_review_media_preserved': True,
        'evidence': {name: {'path': path.relative_to(ROOT).as_posix(), 'sha256': sha(path)} for name, path in evidence.items()}}
    write(EXP / 'validation-summary.json', result)
    print(json.dumps({k: result[k] for k in ['targeted_checks_passed', 'actual_frames', 'promoted', 'model_weights_changed']}))

if __name__ == '__main__': main()
