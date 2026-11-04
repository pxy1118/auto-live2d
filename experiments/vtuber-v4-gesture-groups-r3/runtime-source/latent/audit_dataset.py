"""Read-only source/split audit; writes an additional integrity report, not labels."""
import argparse
from pathlib import Path
import numpy as np
from common import ROOT, read, write, sha, digest
from data import prepare


def audit(folder):
    rows,manifest,tensors=prepare(folder,'all')
    groups={split:{r['family'] for r in rows if r['split']==split} for split in ['train','validation','test']}
    assert not (groups['train']&groups['validation'] or groups['train']&groups['test'] or groups['validation']&groups['test'])
    captions={};motions={};clips={}
    for row in rows:
        a=row['annotation'];key=digest({k:a.get(k,'') for k in ['utterance','context','style']})
        assert key not in captions, 'Exact duplicate encoder input remains'
        captions[key]=row['split'];clips[row['clip_id']]=row
    for clip_id,row in clips.items():
        candidate=read(folder/'candidates'/(clip_id+'.json'))
        assert sha(folder/candidate['recording_file'])==candidate['recording_sha256']
        rec=row['recording'];assert rec==read(folder/candidate['recording_file'])
        assert len(rec['parameter_ids'])==509 and len(rec['frames'])==round(candidate['duration_ms']/100)
        for frame in rec['frames']:
            assert len(frame['driver'])==len(frame['actual'])==509
            assert np.isfinite(np.asarray(frame['driver'],float)).all() and np.isfinite(np.asarray(frame['actual'],float)).all()
        key=digest({k:candidate.get(k,[]) for k in ['values','right','left','expressions','appearance','native_target']})
        assert key not in motions or motions[key]==row['split'],'Identical motion crosses a split'
        motions[key]=row['split']
    active=np.ptp(tensors['actions'],axis=(0,1))>.03
    profile=read(folder/'profile.json');expressions=tensors['expressions']
    report={'ok':True,'dataset_sha256':manifest['sha256'],'sample_count':len(rows),'unique_clips':len(clips),
            'full_native_parameter_values_checked':sum(len(row['recording']['frames'])*509*2 for row in clips.values()),
            'split_families':{k:sorted(v) for k,v in groups.items()},'exact_duplicate_inputs':0,'identical_motion_cross_split':0,
            'observed_channels':[c['id'] for c,used in zip(profile['channels'],active) if used],
            'expression_positive_frames':{name:int(expressions[:,:,i].sum()) for i,name in enumerate(profile.get('expressions',[]))},
            'human_reviewed':False,'source':'program_authored_assistant_reviewed'}
    write(folder/'review/integrity.json',report)
    print({k:v for k,v in report.items() if k not in ['split_families','observed_channels','expression_positive_frames']})


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--dataset',default='datasets/vtuber-v3')
    audit(ROOT/parser.parse_args().dataset)
