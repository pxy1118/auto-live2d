"""Audit trained checkpoint provenance and record the final, measured model metadata."""
import sys,argparse
from pathlib import Path
import torch

root=Path(__file__).resolve().parents[2];sys.path.insert(0,str(root/'latent'))
from common import read,write,sha,SOURCE
from networks import ActionExpert

folder=root/'experiments/vtuber-v3';archive=root/'archive/2026-10-31-vtuber-v3-training-controls'
parser=argparse.ArgumentParser();parser.add_argument('--record-final-metadata',action='store_true');args=parser.parse_args()
run=read(folder/'run.json');evaluation=read(folder/'split-evaluation.json');report={'ok':True,'models':{}}
for kind in ['regression','flow']:
    initial=torch.load(archive/'vtuber-v3'/f'{kind}.pt',weights_only=True,map_location='cpu')
    appearance=torch.load(archive/'vtuber-v3-before-motion'/f'{kind}.pt',weights_only=True,map_location='cpu')
    final=torch.load(folder/f'{kind}.pt',weights_only=True,map_location='cpu')
    assert final['encoder_revision']==SOURCE['revision'] and final['dataset_sha256']==run['dataset_sha256'] and final['profile_sha256']==run['profile_sha256']
    assert sha(folder/f'{kind}.pt')==run['models'][kind]['checkpoint_sha256']
    assert sha(archive/'vtuber-v3'/f'{kind}.pt')==run['appearance_refinement']['models'][kind]['base_sha256']
    assert sha(archive/'vtuber-v3-before-motion'/f'{kind}.pt')==run['motion_refinement']['models'][kind]['base_sha256']
    assert all(torch.equal(v,appearance['state_dict'][k]) for k,v in initial['state_dict'].items() if not k.startswith('appearance.'))
    assert all(torch.equal(v,final['state_dict'][k]) for k,v in appearance['state_dict'].items() if not k.startswith(('decoder.','action.','noisy.','flow_time.')))
    model=ActionExpert(kind,final['width'],final['layers'],final['action_dim'],final['expression_dim'],final['appearance_dim'],final['native_dim'])
    model.load_state_dict(final['state_dict']);assert all(torch.equal(v,model.state_dict()[k]) for k,v in final['state_dict'].items())
    report['models'][kind]={'sha256':sha(folder/f'{kind}.pt'),'appearance_only_stage_verified':True,'continuous_only_stage_verified':True,'weight_roundtrip':True}
    run['models'][kind]['weights_roundtrip']=True
    run['models'][kind]['final_training_metrics']=evaluation['splits']['train']['models'][kind]
run['held_out_evaluation']=True;run['evaluation_scope']='same procedural source and asset; no independent human validation'
run['appearance_refinement'].setdefault('base_at_fit',run['appearance_refinement']['base']);run['appearance_refinement']['base']='archive/2026-10-31-vtuber-v3-training-controls/vtuber-v3'
run['motion_refinement'].setdefault('base_at_fit',run['motion_refinement']['base']);run['motion_refinement']['base']='archive/2026-10-31-vtuber-v3-training-controls/vtuber-v3-before-motion'
evaluation['checkpoint_sha256']={kind:run['models'][kind]['checkpoint_sha256'] for kind in report['models']}
if args.record_final_metadata:
    if (folder/'FULL-MANIFEST.json').exists():raise ValueError('Sealed artifacts cannot be rewritten')
    write(folder/'run.json',run);write(folder/'split-evaluation.json',evaluation);write(folder/'checkpoint-audit.json',report)
print(report)
