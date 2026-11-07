import hashlib
import json
import re
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
RUNTIME=ROOT/'.runtime'
AUDIO=RUNTIME/'speech/audio'

def read(path):return json.loads(Path(path).read_text(encoding='utf-8-sig'))
def write(path,data):Path(path).write_text(json.dumps(data,ensure_ascii=False,indent=2,allow_nan=False),encoding='utf-8')
def sha(path):
    with Path(path).open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def local_path(value):
    """Resolve a project-relative asset path, keeping absolute Windows paths usable from WSL."""
    if Path('/proc').is_dir() and re.match(r'^[A-Za-z]:[/\\]',value):value='/mnt/'+value[0].lower()+'/'+value[2:].lstrip('/\\').replace('\\','/')
    path=Path(value)
    return path if path.is_absolute() else ROOT/path
def settings():return read(ROOT/'speech/config.json')
