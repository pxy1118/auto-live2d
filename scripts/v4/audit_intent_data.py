"""Research audit of train/development only; old final test remains sealed."""
import collections
import hashlib
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'research/vtuber-v4-intent-study';DATA=ROOT/'datasets/vtuber-v4-generalization-v1'
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def main():
    OUT.mkdir(parents=True,exist_ok=True);result={'scope':'train and validation only','test_loaded':False,'splits':{}}
    for split in ['train','validation']:
        rows=[json.loads(x) for x in (DATA/f'{split}.jsonl').read_text(encoding='utf-8').splitlines()]
        grouped=collections.defaultdict(list)
        for row in rows:grouped[(row['text'],row['context'])].append(row)
        unique=[group[0] for group in grouped.values()];new=[r for r in unique if r['challenge']!='legacy'];dialogue=[r for r in unique if r['challenge']=='dialogue']
        conflicts=[{'text':k[0],'context':k[1]} for k,group in grouped.items() if len({tuple(r['target'][p] for p in ['arm','body','emotion','eye']) for r in group})>1]
        active=[r for r in new if r['target']['body']!='none']
        ordinary=[r for r in new if r['challenge']=='implicit_intent' and r['target']['body']=='none']
        flagged=[r for r in new if any(t in r['context'] for t in ['撒娇','你明显害羞','你很感激','你真生气','你很惊讶'])]
        result['splits'][split]={'file_sha256':sha(DATA/f'{split}.jsonl'),'rows':len(rows),'unique_text_contexts':len(unique),
            'body_counts_unique':dict(collections.Counter(r['target']['body'] for r in unique)),
            'new_unique_pairs':len(new),'new_body_active_fraction':len(active)/len(new),
            'dialogue_unique_pairs':len(dialogue),'dialogue_body_active_fraction':sum(r['target']['body']!='none' for r in dialogue)/len(dialogue),
            'new_active_strength_point75_fraction':sum(r['target']['body_strength']==.75 for r in active)/len(active),
            'new_implicit_body_none_scene_families':sorted({r['semantic_group'] for r in ordinary}),
            'categorical_conflicts_identical_text_context':conflicts,
            'explicit_label_phrase_examples_for_manual_audit':[{'text':r['text'],'context':r['context']} for r in flagged[:6]]}
    result['sequence_builder_finding']={'source':'scripts/v4/build_generalization_data.py','method':'rng.sample(eligible, 3)',
        'meaning':'The previous sequences are randomly assembled contextual augmentations, not independently authored coherent conversations.'}
    result['conclusions']=['High activity prior in new dialogue supervision','No amplitude diversity for newly authored active-body targets',
        'Only one accepted body label per example','Some situations explicitly name the target affect; flag for factual-context rewrite, not a measured causal leakage estimate',
        'History augmentation and repeated contexts are not independent samples']
    (OUT/'data-audit.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({s:{k:d[k] for k in ['new_body_active_fraction','dialogue_body_active_fraction','new_active_strength_point75_fraction']} for s,d in result['splits'].items()}))
if __name__=='__main__':main()
