"""Download and hash a separate, pinned encoder; never change the live encoder."""
import argparse
import json
from huggingface_hub import HfApi, snapshot_download
from common import ROOT, sha

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--repo',default='Qwen/Qwen3.5-4B')
    parser.add_argument('--revision',default='851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a')
    args=parser.parse_args()
    assert args.repo in ['Qwen/Qwen3.5-4B']
    info=HfApi().model_info(args.repo,revision=args.revision,files_metadata=True)
    assert info.sha==args.revision
    weights=[{'file':s.rfilename,'sha256':s.lfs.sha256,'bytes':s.size}
             for s in info.siblings if s.rfilename.endswith('.safetensors')]
    source={'repo_id':args.repo,'revision':info.sha,'license':'Apache-2.0',
            'source_url':'https://huggingface.co/'+args.repo,'weights':weights}
    folder=ROOT/'models'/args.repo.split('/')[-1]
    print(json.dumps({'stage':'download','repo':args.repo,'revision':info.sha,'bytes':sum(w['bytes'] for w in weights)}),flush=True)
    snapshot_download(args.repo,revision=info.sha,local_dir=folder,
                      allow_patterns=['*.json','*.safetensors','*.jinja','*.txt','LICENSE','README.md'])
    for w in weights:
        assert sha(folder/w['file'])==w['sha256'],'Downloaded weight hash mismatch'
        print(json.dumps({'stage':'verified','file':w['file']}),flush=True)
    dest=ROOT/'latent/encoders';dest.mkdir(exist_ok=True)
    (dest/'qwen3.5-4b.json').write_text(json.dumps(source,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'stage':'ready','source':'latent/encoders/qwen3.5-4b.json'}),flush=True)

if __name__=='__main__':main()
