"""Prepare the emotion classifier and verify/reuse the two frozen action heads."""
import argparse,hashlib,json,shutil
from pathlib import Path
from prepare_emotion import main as prepare_classifier
ROOT=Path(__file__).resolve().parents[1]
def read(path):return json.loads(path.read_text(encoding='utf-8-sig'))
def sha(path):
    with path.open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--verify-only',action='store_true');args=parser.parse_args()
    folder=ROOT/'experiments/vtuber-v5-emotion-action-r1';run=read(folder/'run.json');source=read(ROOT/'latent/emotion-source.json')
    if not args.verify_only:prepare_classifier()
    for name,expected in source['files'].items():
        target=ROOT/source['local_path']/name
        if not target.is_file() or sha(target)!=expected:raise RuntimeError('Emotion resource missing or changed: '+name)
    for item,parent in [(run['models']['regression'],run['source_runs']['continuous']),(run['performance_planner'],run['source_runs']['actions'])]:
        target=folder/item['checkpoint'];expected=item['sha256']
        if target.is_file() and sha(target)==expected:continue
        if args.verify_only:raise RuntimeError('Action checkpoint missing or changed: '+str(target))
        source_file=ROOT/parent/item['checkpoint']
        if not source_file.is_file() or sha(source_file)!=expected:raise RuntimeError('Prepare the documented source action checkpoint: '+str(source_file))
        shutil.copyfile(source_file,target)
    print('Pinned emotion resources and both frozen action checkpoints verified. No training performed.')
if __name__=='__main__':main()
