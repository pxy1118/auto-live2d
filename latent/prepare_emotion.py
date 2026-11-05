"""Download the pinned emotion classifier; no remote Python code is loaded."""
import hashlib,json,urllib.request
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'latent/emotion-source.json'
def digest(path):
    with path.open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()
def main():
    spec=json.loads(SOURCE.read_text(encoding='utf-8'))
    folder=ROOT/spec['local_path'];folder.mkdir(parents=True,exist_ok=True)
    for name,expected in spec['files'].items():
        target=folder/name
        if target.exists() and digest(target)==expected:
            print(json.dumps({'file':name,'status':'verified'}),flush=True);continue
        partial=target.with_name(target.name+'.partial')
        request=urllib.request.Request(f"https://huggingface.co/{spec['repo_id']}/resolve/{spec['revision']}/{name}",headers={'User-Agent':'auto-live2d/1.0'})
        with urllib.request.urlopen(request,timeout=90) as response,partial.open('wb') as output:
            total=int(response.headers.get('Content-Length',0));received=0;logged=-1
            while block:=response.read(1024*1024):
                output.write(block);received+=len(block)
                if received//(100*1024*1024)!=logged:
                    logged=received//(100*1024*1024);print(json.dumps({'file':name,'received_mb':round(received/1048576),'total_mb':round(total/1048576)}),flush=True)
        actual=digest(partial)
        if actual!=expected:raise RuntimeError(f'Fingerprint mismatch: {name}')
        partial.replace(target);print(json.dumps({'file':name,'status':'verified','sha256':actual}),flush=True)
if __name__=='__main__':main()
