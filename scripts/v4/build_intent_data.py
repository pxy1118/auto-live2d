"""Build a new, development-only intent study; never reads the sealed final test."""
import collections
import hashlib
import json
import sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'latent'))
from planner_contract import ARMS,BODIES,EMOTIONS,EYES,FACES,state_vector
from intent_scenes import SCENES

OUT=ROOT/'datasets/vtuber-v4-intent-v1'
def digest(x):return hashlib.sha256(json.dumps(x,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
def file_sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def body_annotation(code):
    parts=code.split(':');kind={'F':'forbidden','O':'optional','R':'required'}[parts[0]]
    if kind=='forbidden':preferred='none';acceptable=['none'];window=[0.,0.]
    else:
        preferred=parts[1];acceptable=list(dict.fromkeys((['none'] if kind=='optional' else [])+parts[1:]))
        active=next(a for a in acceptable if a!='none')
        optional={'lean':(.18,.34),'nod':(.12,.3),'turn':(.15,.3),'tilt':(.14,.32),'sway':(.18,.35),'cajole':(.22,.4)}
        required={'lean':(.5,.72),'nod':(.45,.65),'turn':(.5,.7),'tilt':(.45,.65),'sway':(.5,.8),'cajole':(.5,.75)}
        window=list((optional if kind=='optional' else required)[active])
    return dict(necessity=kind,preferred=preferred,acceptable=acceptable,
                forbidden=[x for x in BODIES if x not in acceptable],active_strength_interval=window)

def validate_annotation(a):
    good=a['acceptable'];bad=a['forbidden'];kind=a['necessity'];lo,hi=a['active_strength_interval']
    assert len(good)==len(set(good)) and len(bad)==len(set(bad))
    assert set(good).isdisjoint(bad) and set(good+bad)==set(BODIES)
    assert a['preferred'] in good and 0<=lo<=hi<=1
    if kind=='forbidden':assert good==['none'] and lo==hi==0
    elif kind=='optional':assert 'none' in good and len(good)>1 and lo>0
    elif kind=='required':assert 'none' not in good and lo>0
    else:raise AssertionError('unknown necessity')

def split_families():
    grouped=collections.defaultdict(list)
    for s in SCENES:grouped[s['family']].append(s)
    assert len(SCENES)==100 and len({s['id'] for s in SCENES})==100
    singles=sorted([k for k,v in grouped.items() if len(v)==1],key=lambda k:digest(['intent-v1-7137',k]))
    pairs=sorted([k for k,v in grouped.items() if len(v)==2],key=lambda k:digest(['intent-v1-7137',k]))
    assert len(singles)==78 and len(pairs)==11 and len(grouped)==89
    # 60/20/20 stories. Every context-contrast pair stays together.
    chunks={'train':singles[:46]+pairs[:7],
            'development':singles[46:62]+pairs[7:9],
            'calibration':singles[62:]+pairs[9:]}
    return {f:split for split,ff in chunks.items() for f in ff}

def rows_for(scene,split):
    past=[];emotion='neutral';faces=[0.]*6;eye='normal';last_arm='none';last_body='none'
    for i,t in enumerate(scene['turns']):
        ann=body_annotation(t['body_code']);validate_annotation(ann)
        assert t['arm'] in ARMS and t['emotion'] in EMOTIONS and t['eye'] in EYES
        context=scene['facts']+'\n'+''.join(f"观众：{u}\n角色：{v}\n" for u,v in past)+f"观众：{t['viewer']}"
        base_state=dict(emotion=emotion,face_state=faces+[float(eye!='normal')]+[float(eye==v) for v in EYES],
                        last_arm=last_arm,last_body=last_body,last_arm_variant=0,last_body_variant=0,
                        arm_age_ms=6000,body_age_ms=4000,arm_active=False,body_active=False)
        # These are explicitly hypothetical execution histories, not extra scenes.
        states=[('canonical',base_state),
                ('long_pause',{**base_state,'arm_age_ms':6000,'body_age_ms':4000,'last_arm':'none','last_body':'none'}),
                ('busy',{**base_state,'arm_age_ms':400,'body_age_ms':300,'arm_active':True,'body_active':True})]
        for variant,state in states:
            yield dict(id=f"{scene['id']}/t{i+1}/{variant}",scene_id=scene['id'],family=scene['family'],
                split=split,turn=i+1,history_variant=variant,text=t['text'],context=context,
                state=state,state_vector=state_vector(state),body_annotation=ann,
                separate_draft_labels={k:t[k] for k in ['arm','emotion','eye']},
                review_status='assistant_authored_draft_not_human_gold',
                provenance='scripts/v4/intent_scenes.py')
        past.append((t['viewer'],t['text']));last_arm=t['arm'];last_body=ann['preferred']
        if t['emotion']!='keep':emotion=t['emotion']
        # Approximate preceding affect only. The current turn target is never put in its input.
        faces=[0.]*6
        if emotion=='angry':faces[FACES.index('黑脸')]=.55
        if emotion=='shy':faces[FACES.index('脸红')]=.45
        eye=t['eye']

def main():
    OUT.mkdir(parents=True,exist_ok=True);splits=split_families();all_rows={k:[] for k in ['train','development','calibration']}
    for scene in SCENES:all_rows[splits[scene['family']]].extend(rows_for(scene,splits[scene['family']]))
    # Exact full input must never straddle splits. Repeated short acknowledgments in
    # different real contexts are not automatically independent context-contrast pairs.
    owners={};text_owners=collections.defaultdict(set)
    for split,rows in all_rows.items():
        for r in rows:
            key=(r['text'],r['context']);assert key not in owners or owners[key]==split
            owners[key]=split;text_owners[r['text']].add(r['family'])
    duplicates={k:sorted(v) for k,v in text_owners.items() if len(v)>1}
    assert not duplicates,duplicates
    for split,rows in all_rows.items():
        path=OUT/f'{split}.jsonl';content=''.join(json.dumps(r,ensure_ascii=False,separators=(',',':'))+'\n' for r in rows)
        if path.exists() and path.read_text(encoding='utf-8')!=content:raise RuntimeError('Immutable version exists with different rows: create a new version')
        path.write_text(content,encoding='utf-8')
    summary=dict(schema='intent-study.v1',author='assistant',annotation_status='draft',scenes=100,turns=300,families=89,
        history_variants=3,independent_sample_unit='story family, not augmented row',
        seed=7137,final_test_created=False,old_final_test_loaded=False,files={},splits={},
        source_sha256=file_sha(Path(__file__).with_name('intent_scenes.py')),family_splits=splits)
    for split,rows in all_rows.items():
        canonical=[r for r in rows if r['history_variant']=='canonical']
        summary['files'][f'{split}.jsonl']=file_sha(OUT/f'{split}.jsonl')
        summary['splits'][split]=dict(rows=len(rows),turns=len(canonical),scenes=len({r['scene_id'] for r in canonical}),
            families=len({r['family'] for r in canonical}),
            necessity=dict(collections.Counter(r['body_annotation']['necessity'] for r in canonical)),
            preferred=dict(collections.Counter(r['body_annotation']['preferred'] for r in canonical)))
        for kind in ['forbidden','optional','required']:assert summary['splits'][split]['necessity'].get(kind,0)>0
    (OUT/'manifest.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    (OUT/'scenes.json').write_text(json.dumps(SCENES,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(summary['splits'],ensure_ascii=False))
if __name__=='__main__':main()
