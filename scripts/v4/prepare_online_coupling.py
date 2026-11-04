"""Freeze the pre-change runtime and the protected research/default artifacts."""
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[2]
STUDY = ROOT / 'research/vtuber-v4-online-coupling-r1'
CHANGING = ['src/performance.ts', 'src/engine.ts', 'src/performance-panel.ts',
            'server/performance-service.ts', 'docs/performance-tools.json', 'docs/performance-v4.md']


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    STUDY.mkdir(parents=True, exist_ok=True)
    target = STUDY / 'before.json'
    if target.exists():
        print('Existing baseline retained:', target)
        return
    old = json.loads((ROOT / 'research/vtuber-v4-mapping-r1/runtime-before.json').read_text('utf-8'))['files']
    protected = {p: sha(ROOT / p) for p in old if p not in CHANGING}
    for p in ['research/vtuber-v4-mapping-r1/provenance.json',
              'live2d/DeepSeek/DeepSeek/大肥鱼.vtube.json']:
        protected[p] = sha(ROOT / p)
    sources = {}
    for p in CHANGING:
        source = ROOT / p
        dest = STUDY / 'baseline' / p
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(source.read_bytes())
        sources[p] = sha(source)
    health = json.load(urlopen('http://127.0.0.1:8765/api/health', timeout=5))
    target.write_text(json.dumps({'created_utc': datetime.now(timezone.utc).isoformat(),
                                 'protected': protected, 'changing_sources': sources,
                                 'main_health': health,
                                 'protocol': 'Opt-in live coupling; current remains default. Fixed-input continuity tests plus real model/TTS streaming. No new training or human votes.'},
                                ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'protected_files': len(protected), 'baseline_sources': len(sources), 'default_process': health['process_id']}))


if __name__ == '__main__':
    main()
