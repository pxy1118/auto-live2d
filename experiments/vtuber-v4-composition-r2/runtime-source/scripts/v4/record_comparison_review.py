"""Record real, versioned human votes without changing scores or reviewed media."""
import hashlib
import json
import shutil
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EXP = ROOT / 'experiments/vtuber-v4-composition-r1'
REVIEW = ROOT / 'datasets/vtuber-v4/review'

def read(path):
    return json.loads(path.read_text(encoding='utf-8'))

def write(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    ratings_path = ROOT / '.runtime/performance/ratings.json'
    ratings_sha = sha(ratings_path)
    ratings = read(ratings_path)
    votes = ratings['comparisons']['composition-r1']
    keys = read(EXP / 'blind-key.json')
    assert len(keys) == 24 and set(votes) == {str(i) for i in range(24)}, 'Review is not complete'
    totals = Counter(candidate=0, v3=0, tie=0, neither=0)
    rows = []
    for i, key in enumerate(keys):
        vote = votes[str(i)]
        assert vote['source'] == 'user' and vote['dataset_version'] == 'composition-r1'
        choice = vote['choice']
        assert choice in ['A', 'B', 'tie', 'neither']
        result = next((m['model'] for m in key['models'] if m['label'] == choice), choice)
        assert result in totals
        totals[result] += 1
        rows.append({'group': i + 1, 'choice': choice, 'result': result, 'note': vote['note']})
    accepted = totals['candidate'] >= 16
    assert read(ROOT / 'latent/default-run.json')['path'] == 'experiments/vtuber-v3'
    assert ratings['pilot'] == read(EXP / 'ratings-before-comparison.json')['pilot']
    assert sha(ratings_path) == ratings_sha, 'Ratings changed while being read; rerun'
    result = {'recorded_utc': datetime.now(timezone.utc).isoformat(), 'dataset_version': 'composition-r1',
              'complete': True, 'votes': 24, 'totals': dict(totals), 'required_candidate_preferences': 16,
              'preference_gate_passed': accepted, 'promoted': False, 'ratings_sha256': ratings_sha,
              'blind_key_sha256': sha(EXP / 'blind-key.json'), 'model_weights_changed': False,
              'usage': 'Acceptance and runtime bug correction; no training or test-set tuning', 'groups': rows}
    write(EXP / 'human-review.json', result)
    write(EXP / 'human-review-ratings.json', {'composition-r1': votes})
    backup = EXP / 'validation-summary-before-human-review.json'
    if not backup.exists():
        shutil.copy2(EXP / 'validation-summary.json', backup)
    summary = read(EXP / 'validation-summary.json')
    summary.update(human_complete=True, human_review_completed=True, human_votes=24,
                   candidate_preferred=totals['candidate'], human_preference_gate_passed=accepted,
                   human_acceptance_pending=False, full_acceptance_complete=False,
                   acceptance_status='preference_passed_not_promoted' if accepted else 'preference_failed',
                   human_review= {'path': 'human-review.json', 'sha256': sha(EXP / 'human-review.json')})
    write(EXP / 'validation-summary.json', summary)
    run = read(EXP / 'run.json')
    run['human_review'] = {'path': 'human-review.json', 'votes': 24, 'preferred': totals['candidate'],
                           'required': 16, 'preference_gate_passed': accepted, 'promoted': False}
    run['eligibility']['regression'].update(status='candidate' if accepted else 'not_accepted',
        reason=f"Human review complete: candidate {totals['candidate']}/24, v3 {totals['v3']}, tie {totals['tie']}, neither {totals['neither']}. Required 16 candidate preferences; default unchanged.")
    write(EXP / 'run.json', run)
    manifest = read(EXP / 'runtime-manifest.json')
    manifest.update(run_sha256=sha(EXP / 'run.json'), human_review_sha256=sha(EXP / 'human-review.json'))
    write(EXP / 'runtime-manifest.json', manifest)
    status = read(REVIEW / 'comparison-status.json')
    status.update(human_acceptance_pending=False, human_review_completed=True,
                  human_preference_gate_passed=accepted, review_result=dict(totals),
                  message=f"24 组评分已完成：新版 {totals['candidate']}、旧版 {totals['v3']}、差不多 {totals['tie']}、都不满意 {totals['neither']}。默认模型保留。")
    if (REVIEW / 'eye-fix.html').is_file():
        status['correction_preview'] = 'eye-fix.html'
    write(REVIEW / 'comparison-status.json', status)
    assert sha(ratings_path) == ratings_sha, 'Human ratings must remain untouched'
    print(json.dumps({k: result[k] for k in ['votes', 'totals', 'preference_gate_passed', 'promoted']}, ensure_ascii=False))

if __name__ == '__main__':
    main()
