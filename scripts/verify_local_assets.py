#!/usr/bin/env python3
"""Verify every local runtime asset is present and pinned; never touches the network.

Run from the repository root on Windows or inside WSL:
    python scripts/verify_local_assets.py
Exit code 0 means every required runtime file exists and matches its recorded hash.
"""
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
rows = []


def sha(path: Path) -> str:
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def read(path: Path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def check(label: str, relative: str, expected_sha: str | None = None, expected_bytes: int | None = None):
    path = ROOT / relative
    if not path.is_file():
        rows.append((label, relative, 'MISSING', ''))
        return False
    size = path.stat().st_size
    if expected_bytes is not None and size != expected_bytes:
        rows.append((label, relative, 'SIZE', f'{size} != {expected_bytes}'))
        return False
    if expected_sha is not None:
        actual = sha(path)
        if actual != expected_sha:
            rows.append((label, relative, 'SHA', actual))
            return False
    rows.append((label, relative, 'OK', f'{size / 1048576:.1f} MiB'))
    return True


def main() -> int:
    ok = True
    # 1) frozen Qwen3.5-0.8B text encoder (project-local, no HF cache)
    encoder = read(ROOT / 'latent/encoder-source.json')
    for weight in encoder['weights']:
        ok &= check('qwen-encoder', f"models/Qwen3.5-0.8B/{weight['file']}", weight.get('sha256'), weight.get('bytes'))
    # 2) pinned multilingual emotion classifier
    emotion = read(ROOT / 'latent/emotion-source.json')
    for name, digest in emotion['files'].items():
        ok &= check('emotion-model', f"{emotion['local_path']}/{name}", digest)
    # 3) fine-tuned Qwen3-TTS checkpoint + project-local inference source
    speech = read(ROOT / 'speech/config.json')
    speech_source = read(ROOT / 'speech/model-source.json')
    for entry in speech_source['files']:
        ok &= check('qwen-tts-weights', f"{speech['checkpoint']}/{entry['file']}", entry.get('sha256'), entry.get('bytes'))
    vendor = Path(speech['repository'])
    for entry in read(ROOT / vendor / 'SOURCE.json')['files']:
        ok &= check('qwen-tts-source', f"{speech['repository']}/{entry['file']}", entry.get('sha256'))
    for entry in read(ROOT / 'vendor/faster-qwen3-tts/SOURCE.json')['files']:
        ok &= check('tts-accelerator', f"vendor/faster-qwen3-tts/{entry['file']}", entry.get('sha256'))
    # 4) runtime channel profile and promoted v6 package
    profile_path = ROOT / 'latent/runtime-profile.json'
    profile = read(profile_path)
    pointer = read(ROOT / 'latent/stream-run.json')
    if not pointer.get('promoted'):
        rows.append(('runtime-package', str(pointer.get('path')), 'NOT-PROMOTED', ''))
        ok = False
    else:
        run_path = ROOT / pointer['path'] / 'run.json'
        if not run_path.is_file():
            rows.append(('runtime-package', str(run_path.relative_to(ROOT)), 'MISSING', ''))
            ok = False
        else:
            run = read(run_path)
            if run.get('profile_sha256') != profile.get('sha256'):
                rows.append(('runtime-package', 'profile_sha256', 'MISMATCH', ''))
                ok = False
            if run.get('fingerprints', {}).get('profile_file_sha256') not in (None, sha(profile_path)):
                rows.append(('runtime-package', 'profile_file_sha256', 'MISMATCH', ''))
                ok = False
            for name, spec in (run.get('models') or {}).items():
                ok &= check(f'runtime-{name}', f"{pointer['path']}/{spec.get('checkpoint')}", spec.get('sha256'))
    # 5) report
    width = max(len(row[0]) for row in rows) if rows else 10
    for label, path, state, detail in rows:
        print(f'{label:<{width}}  {state:<12} {path}  {detail}')
    failed = [row for row in rows if row[2] != 'OK']
    print(f"\n{len(rows)} assets checked, {len(failed)} problem(s).")
    if failed:
        print('Missing or mismatched runtime assets; run the prepare/training scripts before launching.', file=sys.stderr)
        return 1
    print('All required runtime assets are project-local and pinned. No network access is needed.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
