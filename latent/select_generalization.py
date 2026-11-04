"""Select a complete configuration using DEVELOPMENT means across matched seeds."""
import json
import shutil
from collections import defaultdict
from pathlib import Path
import numpy as np
from common import ROOT,sha

OUT=ROOT/'experiments/vtuber-v4-generalization-r1'
def write(path,data):path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

def main():
    if (OUT/'selected.json').exists():raise RuntimeError('Selection is frozen; do not reselect after final testing')
    protocol=json.loads((OUT/'protocol.json').read_text());groups=defaultdict(list)
    for path in sorted((OUT/'candidates').glob('*/metadata.json')):
        d=json.loads(path.read_text());assert d['checkpoint_sha256']==sha(path.with_name('planner.pt'));assert not d['test_used_for_selection']
        groups[(d['repo'],d['representation'])].append((path,d))
    assert len(groups)==4
    table=[]
    for (repo,mode),items in groups.items():
        assert sorted(d['seed'] for _,d in items)==sorted(protocol['seeds'])
        table.append({'repo':repo,'representation':mode,'mean_score':float(np.mean([d['selection_score'] for _,d in items])),
            'score_std':float(np.std([d['selection_score'] for _,d in items])),
            'mean_new_macro_f1':float(np.mean([d['validation']['new_scenarios']['mean_macro_f1'] for _,d in items])),
            'mean_all_macro_f1':float(np.mean([d['validation']['all']['mean_macro_f1'] for _,d in items])),
            'mean_new_active_recall':{k:float(np.mean([d['validation']['new_scenarios'][k]['correct_active_recall'] for _,d in items])) for k in ['arm','body','emotion','eye']},
            'encoder_p95_ms_isolated':items[0][1]['encoder_ms']['p95'],'seeds':[d['seed'] for _,d in items]})
    # A tie within 0.01 goes to the measured faster encoder; then simpler representation.
    top=max(t['mean_score'] for t in table);near=[t for t in table if t['mean_score']>=top-.01]
    selected=min(near,key=lambda t:(t['encoder_p95_ms_isolated'],t['representation']!='tail16_mean'))
    items=groups[(selected['repo'],selected['representation'])]
    # Use the median seed instead of cherry-picking the best single run.
    path,metadata=sorted(items,key=lambda p:p[1]['selection_score'])[len(items)//2]
    shutil.copy2(path.with_name('planner.pt'),OUT/'selected-planner.pt')
    write(OUT/'selected-metadata.json',metadata)
    result={'selected_configuration':selected,'selected_seed':metadata['seed'],'checkpoint':'selected-planner.pt',
        'checkpoint_sha256':sha(OUT/'selected-planner.pt'),'source_candidate':path.parent.relative_to(ROOT).as_posix(),
        'encoder_source':protocol['encoders']['4b' if '4B' in selected['repo'] else '0.8b'],
        'dataset_manifest_sha256':protocol['dataset_manifest_sha256'],'selection_split':'validation','test_used_for_selection':False,
        'table':sorted(table,key=lambda t:-t['mean_score']),'promoted':False,'human_accepted':False,
        'tie_rule':'within 0.01 select lower isolated encoder P95; then tail mean','seed_rule':'median validation seed'}
    write(OUT/'selected.json',result);print(json.dumps(result,indent=2))

if __name__=='__main__':main()
