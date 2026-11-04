"""Independent state/scheduling experiment, using a frozen pre-handover renderer."""
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
STUDY = ROOT / 'research/vtuber-v4-liveliness-r1'


def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def main():
    STUDY.mkdir(parents=True, exist_ok=True)
    if (STUDY / 'before.json').exists():
        print('Existing research baseline retained')
        return
    protected = {}
    for folder in ['src', 'server']:
        for p in (ROOT / folder).glob('*'):
            if p.is_file():
                protected[p.relative_to(ROOT).as_posix()] = sha(p)
    old = json.loads((ROOT / 'research/vtuber-v4-online-coupling-r1/before.json').read_text('utf-8'))
    protected.update({p: sha(ROOT / p) for p in old['protected']})
    for p in ['src/performance-coupling.ts', 'research/my-neuro-audit-20261103/REPORT.md',
              'research/vtuber-v4-online-coupling-r1/before.json']:
        protected[p] = sha(ROOT / p)
    baseline = ROOT / 'research/vtuber-v4-online-coupling-r1/baseline/src'
    pending = ['engine.ts']
    copied = {}
    while pending:
        name = pending.pop()
        if name in copied:
            continue
        source = baseline / name if name in ['engine.ts', 'performance.ts'] else ROOT / 'src' / name
        content = source.read_text('utf-8')
        for imported in re.findall(r"from ['\"]\./([^'\"]+)['\"]", content):
            pending.append(imported + ('' if imported.endswith('.ts') else '.ts'))
        adjusted = content.replace("'../vendor/", "'/vendor/")
        dest = STUDY / 'frozen/src' / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(adjusted, encoding='utf-8', newline='\n')
        copied[name] = {'source': source.relative_to(ROOT).as_posix(), 'source_sha256': sha(source),
                        'copy_sha256': sha(dest), 'vendor_import_rebased': adjusted != content}
    protocol = {'schema': 'liveliness-study.v1', 'created_utc': datetime.now(timezone.utc).isoformat(),
                'conditions': ['current', 'state_idle'], 'hz': 60, 'trained': False, 'promoted': False,
                'scenes': [
                    {'id': 'quiet', 'title': '安静等待 · 偶尔侧看与轻歪头', 'duration_ms': 28000, 'framing': 'full',
                     'initial': {'AngleX': 6, 'AngleZ': -3, 'PositionX': 2, 'LeanInput': -2.5},
                     'events': [], 'source': 'Synthetic silent execution probe, retained non-default initial pose.'},
                    {'id': 'shy', 'title': '两句对话 · 害羞到开心', 'duration_ms': 11960, 'framing': 'portrait',
                     'cached_scene': 'datasets/vtuber-v4-mapping-r1/shy',
                     'events': [{'at_ms': 500, 'emotion': 'shy', 'intensity': .38, 'hold_ms': 5000},
                                {'at_ms': 4440, 'emotion': 'happy', 'intensity': .3, 'hold_ms': 4000}],
                     'source': 'Cached real development speech and original arm/body path; fixed research emotion signals, not semantic model output.'},
                    {'id': 'anger', 'title': '生气保持 · 眉眼先放松，黑脸稍后退出', 'duration_ms': 10000, 'framing': 'portrait',
                     'initial': {'AngleX': -4, 'AngleY': -2, 'AngleZ': 2, 'PositionX': -1.5},
                     'events': [{'at_ms': 500, 'emotion': 'angry', 'intensity': .7, 'hold_ms': 4000}],
                     'source': 'Synthetic silent execution probe with the same explicit emotion/strength/hold in both conditions.'}],
                'idle': {'interval_ms': [10000, 18000], 'per_action_cooldown_ms': 20000,
                         'recent_history': 2, 'yield_ms': 300, 'arms_allowed': False},
                'constraints': ['No production source/config/weight changes.', 'No online semantic or TTS inference.',
                                'No keyword-triggered motions, periodic body noise, or speech-energy retiming.',
                                'Special eye drawing switches and appearance retain existing owners.',
                                'Ten-minute checks are policy simulations, not a full online stability acceptance.']}
    (STUDY / 'protocol.json').write_text(json.dumps(protocol, ensure_ascii=False, indent=2) + '\n', 'utf-8')
    (STUDY / 'before.json').write_text(json.dumps({'protected': protected, 'frozen_sources': copied}, ensure_ascii=False, indent=2) + '\n', 'utf-8')
    print(json.dumps({'frozen_source_files': len(copied), 'protected_files': len(protected), 'production_edited': False}))


if __name__ == '__main__':
    main()
