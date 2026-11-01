from huggingface_hub import snapshot_download
from common import ROOT,SOURCE,sha
folder=ROOT/'models'/SOURCE['repo_id'].split('/')[-1]
snapshot_download(SOURCE['repo_id'],revision=SOURCE['revision'],local_dir=folder,allow_patterns=['*.json','*.safetensors','*.jinja','*.txt','LICENSE'])
for item in SOURCE['weights']:
    if sha(folder/item['file'])!=item['sha256']: raise ValueError('预训练权重 SHA-256 不匹配')
print('Pinned semantic encoder ready.')
