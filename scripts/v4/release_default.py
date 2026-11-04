"""Freeze or verify the accepted local release; never package third-party assets."""
import argparse
import hashlib
import json
from pathlib import Path
from datetime import datetime, timezone
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[2]
RELEASE = ROOT / 'releases/v4-default-r1'
MANIFEST = RELEASE / 'manifest.json'
ARCHIVE = ROOT / 'archive/v4-default-r1-20261104/source-and-web.zip'
STUDY = ROOT / 'research/vtuber-v4-finalization-20261104'
PACKAGES = ['vtuber-v4-default-r1', 'vtuber-v4-composition-r2', 'vtuber-v3']
EXCLUDED_DIRS = {'.git', '.venv', '__pycache__', 'node_modules', '.cache'}
EXTENSIONS = {'.py', '.ts', '.js', '.css', '.html', '.json', '.md', '.toml',
              '.lock', '.ps1', '.cmd', '.sh', '.txt', '.yaml', '.yml', '.png', '.svg', '.jpg'}


def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def entry(path):
    return {'sha256': sha(path), 'bytes': path.stat().st_size}


def files(folder):
    return sorted(p for p in folder.rglob('*') if p.is_file()
                  and not EXCLUDED_DIRS.intersection(p.relative_to(folder).parts))


def source_files():
    roots = ['src', 'server', 'latent', 'speech', 'tests', 'examples', 'scripts',
             'docs', 'vendor/faster-qwen3-tts']
    result = {p for name in roots for p in files(ROOT / name)
              if p.suffix in EXTENSIONS or p.name in {'LICENSE', '.python-version'}}
    result.update(ROOT / name for name in ['main.py', 'README.md', 'LICENSE',
                  'THIRD-PARTY-NOTICES.md', '.gitignore', '.gitattributes', 'index.html',
                  'package.json', 'package-lock.json', 'tsconfig.json',
                  'start.cmd', 'start.ps1', 'stop.ps1', 'research/README.md',
                  'releases/v4-default-r1/REPORT.md'])
    # The profiles and selection metadata are code inputs; checkpoints remain external.
    for name in PACKAGES:
        result.update(p for p in (ROOT / 'experiments' / name).iterdir()
                      if p.is_file() and p.name in {'run.json', 'profile.json', 'selection.json'})
    return sorted(result)


def index(paths):
    return {p.relative_to(ROOT).as_posix(): entry(p) for p in paths}


def resource_files():
    result = []
    for model in ['Qwen3.5-0.8B', 'Qwen3.5-4B']:
        result.extend(('repo', p.relative_to(ROOT).as_posix(), p)
                      for p in files(ROOT / 'models' / model))
    for name in PACKAGES:
        result.extend(('repo', p.relative_to(ROOT).as_posix(), p)
                      for p in (ROOT / 'experiments' / name).glob('*.pt'))
    for folder in ['vendor/cubism', 'live2d/DeepSeek/DeepSeek']:
        result.extend(('repo', p.relative_to(ROOT).as_posix(), p) for p in files(ROOT / folder))
    config = read(ROOT / 'speech/config.json')
    checkpoint = Path(config['checkpoint'])
    result.extend(('tts_checkpoint', row['file'], checkpoint / row['file'])
                  for row in read(ROOT / 'speech/model-source.json')['files'])
    return sorted(result, key=lambda item: (item[0], item[1]))


def assert_pins():
    pointer = read(ROOT / 'latent/stream-run.json')
    assert pointer['path'] == 'experiments/vtuber-v4-default-r1' and pointer['promoted']
    assert pointer['rollback_path'] == 'experiments/vtuber-v4-composition-r2'
    assert read(ROOT / 'latent/default-run.json')['path'] == 'experiments/vtuber-v3'
    before = read(STUDY / 'before.json')['files']
    intentional = {'README.md', 'docs/v4-default.md', 'src/performance-panel.ts'}
    for name, expected in before.items():
        if name not in intentional:
            assert sha(ROOT / name) == expected, f'Protected file changed: {name}'
    assert not (ROOT / 'src/performance-coupling.ts').exists()
    candidate = ROOT / 'research/vtuber-v4-online-coupling-r1/candidate'
    for row in read(candidate / 'MANIFEST.json')['files']:
        assert sha(candidate / row['file']) == row['sha256'], row['file']
    default = ROOT / 'experiments/vtuber-v4-default-r1'
    run = read(default / 'run.json')
    for spec in [*run['models'].values(), run['performance_planner'],
                 run['body_planner'], run['motor_gate'], run['gesture_selector']]:
        yield default / spec['checkpoint'], spec['sha256']
    for spec, model in [('latent/encoder-source.json', 'Qwen3.5-0.8B'),
                        ('latent/encoders/qwen3.5-4b.json', 'Qwen3.5-4B')]:
        for row in read(ROOT / spec)['weights']:
            yield ROOT / 'models' / model / row['file'], row['sha256']
    config = read(ROOT / 'speech/config.json')
    for row in read(ROOT / 'speech/model-source.json')['files']:
        yield Path(config['checkpoint']) / row['file'], row['sha256']


def freeze():
    assert not MANIFEST.exists(), 'Release already frozen; do not overwrite its provenance.'
    assert not ARCHIVE.exists(), 'Archive already exists; do not overwrite it.'
    pins = list(assert_pins())
    source, build = index(source_files()), index(files(ROOT / 'dist'))
    assert 'dist/index.html' in build
    resources, observed = [], {}
    for scope, name, path in resource_files():
        row = {'scope': scope, 'path': name, **entry(path)}
        resources.append(row)
        observed[path.resolve()] = row['sha256']
    for path, expected in pins:
        assert observed[path.resolve()] == expected, f'Pinned resource changed: {path}'
    protected = {name: entry(ROOT / name) for name in read(STUDY / 'before.json')['files']
                 if name not in {'README.md', 'docs/v4-default.md', 'src/performance-panel.ts'}}
    candidate = ROOT / 'research/vtuber-v4-online-coupling-r1/candidate'
    protected.update(index(files(candidate)))
    # A new local-only directory; the fixed absolute target must remain inside archive/.
    assert ARCHIVE.resolve().is_relative_to((ROOT / 'archive').resolve())
    ARCHIVE.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(ARCHIVE, 'x', compression=ZIP_DEFLATED, compresslevel=6) as bundle:
        for name in [*source, *build]:
            bundle.write(ROOT / name, name)
    RELEASE.mkdir(parents=True, exist_ok=True)
    manifest = {
        'schema': 'auto-live2d.local-release.v1', 'release': 'v4-default-r1',
        'created_utc': datetime.now(timezone.utc).isoformat(),
        'runtime_version': 'v4.13.0-clause-plan',
        'default_pointer': 'latent/stream-run.json',
        'activation_basis': 'explicit_user_acceptance',
        'full_original_acceptance_complete': False,
        'historical_latency_gate_passed': False,
        'source': source, 'build': build, 'resources': resources, 'preserved': protected,
        'archive': {'path': ARCHIVE.relative_to(ROOT).as_posix(), **entry(ARCHIVE),
                    'scope': 'source and built webpage; external resources excluded'},
        'checks': index(p for p in files(ROOT / 'test-results/v4-finalization-20261104')
                        if not p.name.startswith('launcher-')),
        'historical_evidence': index([ROOT / 'test-results/v4-default' / name for name in
                                     ['browser-verification-default.json', 'default-ui.json', 'latency-summary.json']]),
    }
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'frozen': str(MANIFEST), 'source_files': len(source),
                      'resources': len(resources), 'archive_bytes': ARCHIVE.stat().st_size}))


def verify(include_resources):
    manifest = read(MANIFEST)
    # Evaluating the generator checks pointers, protected files and the paused source.
    list(assert_pins())
    expected_sources = set(manifest['source'])
    actual_sources = {p.relative_to(ROOT).as_posix() for p in source_files()}
    assert actual_sources == expected_sources, f'Source file set changed: {actual_sources ^ expected_sources}'
    assert {p.relative_to(ROOT).as_posix() for p in files(ROOT / 'dist')} == set(manifest['build'])
    for section in ['source', 'build', 'preserved', 'checks', 'historical_evidence']:
        for name, expected in manifest[section].items():
            assert entry(ROOT / name) == expected, f'{section}: {name}'
    artifact = manifest['archive']
    assert entry(ROOT / artifact['path']) == {k: artifact[k] for k in ['sha256', 'bytes']}
    if include_resources:
        actual = {(scope, name) for scope, name, _ in resource_files()}
        assert actual == {(row['scope'], row['path']) for row in manifest['resources']}
        checkpoint = Path(read(ROOT / 'speech/config.json')['checkpoint'])
        for row in manifest['resources']:
            path = (ROOT if row['scope'] == 'repo' else checkpoint) / row['path']
            assert entry(path) == {k: row[k] for k in ['sha256', 'bytes']}, f'Resource: {row["path"]}'
    print(json.dumps({'ok': True, 'release': manifest['release'],
                      'source_files': len(expected_sources), 'resources_verified': include_resources}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['freeze', 'verify'])
    parser.add_argument('--resources', action='store_true', help='Also hash external resources during verification')
    args = parser.parse_args()
    if args.action == 'freeze':
        freeze()
    else:
        verify(args.resources)
