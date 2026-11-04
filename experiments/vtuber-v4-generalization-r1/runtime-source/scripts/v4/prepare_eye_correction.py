"""Keep reviewed A/B media frozen; create a runtime-only correction and two visual replays."""
import hashlib
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OLD = ROOT / 'experiments/vtuber-v4-composition-r1'
NEW = ROOT / 'experiments/vtuber-v4-composition-r2'
REVIEW = ROOT / 'datasets/vtuber-v4/review'
MEDIA = 'eye-fix-composition-r2'

def read(path): return json.loads(path.read_text(encoding='utf-8'))
def write(path, data): path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    assert read(OLD / 'human-review.json')['complete']
    NEW.mkdir(exist_ok=True)
    for source in [*OLD.glob('*.pt'), OLD / 'performance-planner.json']:
        target = NEW / source.name
        if target.exists(): assert sha(source) == sha(target)
        else: shutil.copy2(source, target)
    run = read(OLD / 'run.json')
    run.update(stage='eye_runtime_correction_candidate', promoted=False, engineering_checks_passed=False,
               full_acceptance_complete=False, body_human_accepted=False, planner_human_calibrated=False,
               parent_run='experiments/vtuber-v4-composition-r1', parent_run_sha256=sha(OLD / 'run.json'),
               human_review={'status': 'not_reviewed', 'parent_preferences': read(OLD / 'human-review.json')['totals']})
    run['motion_policy'].update(version='v4.12.2-discrete-eyes', eye_policy={'exclusive': True, 'values': [0, 1], 'fade': False})
    run['eligibility']['regression'].update(status='candidate', reason='Runtime eye correction only. Parent review failed 11/24; this revision has no independent overall acceptance.')
    write(NEW / 'run.json', run)
    target = REVIEW / MEDIA
    target.mkdir(exist_ok=True)
    pairs = read(REVIEW / 'comparison-pairs-composition-r1.json')
    capture_pairs, display_pairs, provenance = [], [], []
    for index in [10, 19]:
        pair = pairs[index]
        original = next(c for c in pair['clips'] if c['label'] == 'A')
        source = REVIEW / Path(original['video']).with_suffix('.json')
        params = read(source)
        params['face'] = [row[:6] + [1 if eye else 0] for row, eye in zip(params['face'], params['eye'])]
        identifier = source.stem
        write(target / (identifier + '.json'), params)
        corrected = {'label': '修正后', 'media': f'{MEDIA}/{identifier}.webp', 'video': f'{MEDIA}/{identifier}.mp4',
                     'poster': f'{MEDIA}/{identifier}-poster.webp', 'audio': original['audio']}
        capture_pairs.append({'text': pair['text'], 'context': pair['context'], 'clips': [corrected]})
        display_pairs.append({'group': index + 1, 'text': pair['text'], 'clips': [dict(original, label='原候选'), corrected]})
        provenance.append({'group': index + 1, 'source': str(source.relative_to(ROOT)).replace('\\', '/'),
                           'source_sha256': sha(source), 'corrected_input_sha256': sha(target / (identifier + '.json')),
                           'scope': 'Same original motion, facial overlays, PCM and duration. Only replacement-eye channels become exclusive 0/1.'})
    write(REVIEW / 'eye-fix-capture-pairs.json', capture_pairs)
    write(REVIEW / 'eye-fix-pairs.json', display_pairs)
    write(NEW / 'correction-provenance.json', {'weights_changed': False, 'retrained': False,
                                              'test_set_reevaluated': False, 'replays': provenance})
    write(ROOT / 'latent/stream-run.json', {'path': 'experiments/vtuber-v4-composition-r2', 'promoted': False,
          'reason': 'Special eyes are exclusive full on/off after real human feedback. Parent missed the 16/24 preference gate; no default promotion.'})
    (REVIEW / 'eye-fix.html').write_text(HTML, encoding='utf-8')
    print(json.dumps({'candidate': 'composition-r2', 'corrected_groups': [11, 20], 'weights_changed': False}))

HTML = '''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>特殊眼型修正</title><style>body{margin:0;background:#f3f6f3;color:#233a31;font:16px system-ui}main{max-width:1050px;margin:auto;padding:24px}p{line-height:1.8}article{background:white;border-radius:14px;padding:20px;margin:24px 0}.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}video{width:100%;height:520px;object-fit:contain}button{padding:10px;font:inherit;cursor:pointer}a{color:#236b4d}@media(max-width:600px){main{padding:12px}article{padding:12px}video{height:330px}.pair{gap:6px}}</style>
<main><a href="index.html#comparison">← 返回原 24 组评分</a><h1>特殊眼型 · 修正前后</h1>
<p>24 组评分已完成：新版 11、旧版 2、差不多 9、都不满意 2；未达到新版 16 组的门槛，默认仍为 v3。</p>
<p>根据第 11、20 组备注，特殊眼型改为互斥开关：启用为 1，关闭为 0。下面复用原候选的运动、连续表情、声音和时长，只修正眼型显示；这两组用于检查绘制问题，不代表新版整体通过验收。原视频和评分均保留，无需重新填写这 24 组。</p><div id="items">正在载入…</div></main>
<script>const esc=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
fetch('eye-fix-pairs.json').then(r=>r.json()).then(pairs=>{document.getElementById('items').innerHTML=pairs.map(p=>`<article><h2>原第 ${p.group} 组 · ${esc(p.text)}</h2><button>同步播放修正前后</button><div class="pair">${p.clips.map(c=>`<div><strong>${esc(c.label)}</strong><video controls preload="none" poster="${esc(c.poster)}" src="${esc(c.video)}"></video></div>`).join('')}</div></article>`).join('');for(const b of document.querySelectorAll('button'))b.onclick=()=>{b.closest('article').querySelectorAll('video').forEach((v,i)=>{v.currentTime=0;v.muted=i!==0;v.play().catch(()=>{});});};});</script></html>'''

if __name__ == '__main__': main()
