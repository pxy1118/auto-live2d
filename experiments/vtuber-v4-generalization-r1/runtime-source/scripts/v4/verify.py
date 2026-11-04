import gzip,hashlib,json,wave,os
from collections import Counter
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[2];DATA=Path(os.environ.get('DATASET_ROOT',ROOT/'datasets/vtuber-v4'));EXPERIMENT=Path(os.environ.get('EXPERIMENT_ROOT',ROOT/'experiments/vtuber-v4'))
def read(path):return json.loads(path.read_text(encoding='utf-8'))
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def main():
    manifest=read(DATA/'manifest.json');items=manifest['items'];profile=read(DATA/'profile.json');groups={};targets={};audio={};nframes=0;split=Counter()
    assert len(items)==int(os.environ.get('EXPECTED_CLIPS',1200))
    for item in items:
        clip=read(DATA/'clips'/f"{item['id']}.json");split[item['split']]+=1
        groups.setdefault(clip['text'],set()).add(clip['split']);target=hashlib.sha256(json.dumps(clip['values']).encode()).hexdigest();targets.setdefault(target,set()).add(clip['split'])
        sound=DATA/item['audio'];audio.setdefault(str(sound),sha(sound));assert audio[str(sound)]==item['audio_sha256']
        record=DATA/'recordings'/f"{item['id']}.json.gz"
        with gzip.open(record,'rt',encoding='utf-8') as f:r=json.load(f)
        a=np.asarray(r['actual']);assert a.shape==(len(clip['values']),509);assert np.isfinite(a).all();nframes+=len(a)
    assert all(len(v)==1 for v in groups.values());assert all(len(v)==1 for v in targets.values())
    by_id={i['id']:i for i in items};seqs=read(DATA/'sequences.json');assert len(seqs)==240
    for seq in seqs:
        assert all(by_id[id]['split']==seq['split'] for id in seq['clips']);dialogue=read(DATA/'dialogues'/f"{seq['id']}.json")
        assert sha(DATA/dialogue['audio'])==dialogue['audio_sha256']
        with gzip.open(DATA/'dialogue-recordings'/f"{seq['id']}.json.gz",'rt',encoding='utf-8') as f:r=json.load(f)
        assert len(r['actual'])==len(dialogue['values']);assert np.isfinite(r['actual']).all();nframes+=len(r['actual'])
    run=read(EXPERIMENT/'run.json');assert run['dataset_sha256']==sha(DATA/'manifest.json')
    for model in run['models'].values():assert sha(EXPERIMENT/model['checkpoint'])==model['sha256']
    audit=read(ROOT/'test-results/v4/audit/capabilities.json');assert len(audit['parameters'])==509;assert all(s['finite'] for p in audit['parameters'] for s in p['samples'])
    pairfile=DATA/'review/comparison-pairs.json'
    if pairfile.exists():
        pairs=read(pairfile);assert len(pairs)==24
        for pair in pairs:
            for clip in pair['clips']:assert (DATA/'review'/clip['media']).exists();assert (DATA/'review'/clip['video']).exists()
    report={'ok':True,'clips':len(items),'dialogues':len(seqs),'unique_texts':len(groups),'unique_audio_files':len(audio),'split':dict(split),'actual_parameter_frames':nframes,
      'audited_parameters':509,'visible_parameters':sum(p['visible_change'] for p in audit['parameters']),'cross_split_text_leaks':0,'cross_split_identical_target_leaks':0,'human_calibrated':run.get('human_calibrated',False),'promoted':False}
    target=EXPERIMENT/'dataset-verification.json';target.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(report,ensure_ascii=False))
if __name__=='__main__':main()
