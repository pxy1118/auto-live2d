"""Freeze feedback-informed action supervision without rewriting human ratings."""
import argparse
import hashlib
import json
import re
import shutil
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from scripts.audit_performance_feedback import audit
from acting_feedback_data import DESIGNS, ACCEPTANCE
from catalog_contract import MODEL_ACTION_IDS, ACTION_BY_ID, catalog_sha256
from motion_history import authored_history, state_vector
from emotion_event import project_target
from common import sha

BASE=ROOT/'datasets/vtuber-v4-planner-v2/records.jsonl'
OUT=ROOT/'datasets/acting-feedback-r3f'
def norm(text):return re.sub(r'[\W_]+','',text,flags=re.UNICODE)
def dump(path,value):path.write_text(json.dumps(value,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf-8')
def jsonl(path,rows):path.write_text(''.join(json.dumps(row,ensure_ascii=False,allow_nan=False)+'\n' for row in rows),encoding='utf-8')
def check_groups(rows):
    groups=defaultdict(set);texts=defaultdict(set)
    for r in rows:groups[r['group']].add(r['split']);texts[norm(r['text'])].add(r['split'])
    if any(len(s)>1 for s in groups.values()) or any(len(s)>1 for s in texts.values()):raise ValueError('Train/validation/test text or group leakage')
    return {'groups':len(groups),'normalized_texts':len(texts),'cross_split_groups':0,'cross_split_texts':0}

def build(out=OUT):
    review=audit(ROOT/'datasets/emotion-acting-review-v1');latest={r['case_id']:r for r in review['rows']}
    reviewed_text={norm(r['text']) for r in review['rows']}
    source_files={str(Path(p).relative_to(ROOT)):value for p,value in review['source_sha256'].items()}
    fingerprint={'base':sha(BASE),'base_features':sha(ROOT/'datasets/native28-motion-r2/features.pt'),'designs':sha(Path(__file__).with_name('acting_feedback_data.py')),
                 'builder':sha(Path(__file__)),'catalog':catalog_sha256(),'history':sha(ROOT/'contracts/motion-history.json'),
                 'user_files':hashlib.sha256(json.dumps(source_files,sort_keys=True).encode()).hexdigest()}
    if (out/'manifest.json').exists():
        old=json.loads((out/'manifest.json').read_text(encoding='utf-8'))
        if old['fingerprint']!=fingerprint:raise RuntimeError('Frozen dataset differs; choose a new --out directory')
        for name,want in old['artifacts'].items():
            if sha(out/name)!=want:raise RuntimeError('Frozen dataset artifact changed: '+name)
        print(json.dumps({'cached':True,'counts':old['counts']}),flush=True);return
    rows=[];excluded=0
    base=[json.loads(line) for line in BASE.read_text(encoding='utf-8-sig').splitlines()]
    for i,r in enumerate(base):
        if norm(r['text']) in reviewed_text:excluded+=1;continue
        t=project_target(r['target']);t['onset_fraction']=min(.95,t.pop('onset_ms')/max(1000,len(r['text'])*170))
        rows.append({'id':'legacy:'+r['id'],'text':r['text'],'context':r['context'],'split':r['split'],'group':'legacy:'+r['semantic_group'],
                     'source':'authored_legacy','base_index':i,'history':authored_history(r['state']),'target':t,'weight':1.,'variant_weight':.15,'label_basis':'legacy synthetic authoring'})
    prefixes=['','还有一件事，','听我慢慢说，']
    for design,action,variant,case_id,stems in DESIGNS:
        if case_id and case_id not in latest:raise ValueError('Feedback source missing: '+case_id)
        if action not in MODEL_ACTION_IDS:raise ValueError(action)
        for j,(before,anchor,after) in enumerate(stems):
            # All paraphrases, contexts and state variations of a stem share a fold.
            split='test' if j%6==5 else 'validation' if j%6==4 else 'train'
            for k,prefix in enumerate(prefixes):
                text=prefix+before+anchor+after
                if norm(text) in reviewed_text:raise ValueError('Reviewed acceptance text entered synthetic training')
                for state_id in range(6):
                    history={'last_action':'none','last_variant':None,'age_ms':10000,'phase':'idle'}
                    if state_id in (1,2):history.update(last_action='thanks',last_variant=0,age_ms=30000 if state_id==1 else 6000)
                    if state_id==3:history.update(last_action=action,last_variant=variant,age_ms=5000)
                    if state_id==4:history.update(last_action='point',last_variant=0,age_ms=500,phase='hold')
                    if state_id==5:history.update(last_action='nod',last_variant=1,age_ms=18000)
                    # Busy is an admission constraint owned by the scheduler;
                    # it must not erase a later phrase's intended action.
                    target=action if state_id!=3 else 'none'
                    hold={'tremble':1900,'proud':2100,'cajole':2300,'shake':1500}.get(action,1600)
                    rows.append({'id':f'feedback:{design}:{j}:{k}:{state_id}','text':text,'context':'和熟悉的观众自然聊天。',
                      'split':split,'group':f'feedback:{design}:{j}','source':'feedback_authored','design':design,'history':history,
                      'target':{'id':target,'variant':variant if target!='none' else 0,'strength':.8 if target not in ('tremble','none') else .6 if target=='tremble' else 0.,'hold_ms':hold if target!='none' else 0.,'onset_fraction':text.index(anchor)/len(text) if target!='none' else 0.},
                      'weight':3.,'variant_weight':1.,'anchor':{'text':anchor,'start':text.index(anchor),'end':text.index(anchor)+len(anchor)},
                      'feedback_case_id':case_id,'label_basis':'assistant-authored interpretation of explicit feedback; not a human approved take'})
    acceptance=[]
    for case_id,(allowed,anchor) in ACCEPTANCE.items():
        r=latest[case_id];text=r['text']
        if anchor not in text:raise ValueError('Acceptance anchor missing: '+case_id)
        # Match the runtime's sentence-level semantic cache. A later relief cue
        # must not become a label on the earlier worried question.
        spans=list(re.finditer(r'[^。！？!?；;\n]+[。！？!?；;\n]?',text));position=text.index(anchor)
        span=next(s for s in spans if s.start()<=position<s.end());clause=span.group();prefix=text[:span.start()]
        context='\n'.join(v for v in [r['context'],prefix] if v)[-1200:]
        frac=clause.index(anchor)/len(clause)
        acceptance.append({'id':case_id,'text':clause,'full_text':text,'context':context,'allowed_actions':allowed,'anchor_fraction':frac,
           'note':r['note'],'rating_file':str(Path(r['rating_file']).relative_to(ROOT)),'use':'training_replay_only','label_basis':'assistant interpretation of explicit user action suggestion; seen in training, not validation or blind test'})
        action=allowed[0];variant=1 if case_id in ('b501b065bb6a404db7d253f109b20017','e57e3a3d068943528a1108d024f60e72') else 2 if case_id in ('b9ba25a8467341a7b3247fb223e7ac67','a6de64c32a014badb2e543e1833549bc','5f59e87381134311a83da663efed0431','a472b11df18d4b60b43f8db6c38c36d8') else 0
        for state_id in range(6):
            history={'last_action':'none','last_variant':None,'age_ms':10000,'phase':'idle'}
            if state_id==1:history.update(last_action='thanks',last_variant=0,age_ms=6000)
            if state_id==2:history.update(last_action='nod',last_variant=1,age_ms=18000)
            if state_id==3:history.update(last_action=action,last_variant=variant,age_ms=5000)
            if state_id==4:history.update(last_action='point',last_variant=0,age_ms=500,phase='hold')
            if state_id==5:history.update(last_action='chest',last_variant=0,age_ms=30000)
            selected=action if state_id!=3 else 'none'
            rows.append({'id':f'interpretation:{case_id}:{state_id}','text':clause,'context':context,'split':'train','group':'interpretation:'+case_id,
               'source':'feedback_interpreted','history':history,'weight':12.,'variant_weight':1.,'feedback_case_id':case_id,
               'target':{'id':selected,'variant':variant if selected!='none' else 0,'strength':.65 if action=='tremble' else .85,'hold_ms':1900 if action in ('tremble','proud','cajole') else 1600,'onset_fraction':frac if selected!='none' else 0.},
               'label_basis':'assistant interpretation of explicit action note; no human-approved numerical motion labels'})
        if prefix.strip():
            for state_id in range(6):
                rows.append({'id':f'prefix:{case_id}:{state_id}','text':prefix.strip(),'context':r['context'],'split':'train','group':'interpretation:'+case_id,
                  'source':'feedback_interpreted','history':{'last_action':'none','last_variant':None,'age_ms':10000,'phase':'idle'},'weight':8.,'variant_weight':1.,'feedback_case_id':case_id,
                  'target':{'id':'none','variant':0,'strength':0.,'hold_ms':0.,'onset_fraction':0.},'label_basis':'assistant-authored neutral preparation before the explicitly annotated later cue'})
    leakage=check_groups(rows)
    for r in rows:
        if len(state_vector(r['history']))!=26:raise ValueError('history contract mismatch')
        if not 0<=r['target']['onset_fraction']<=.95:raise ValueError('anchor out of range')
    out.mkdir(parents=True,exist_ok=True)
    source=ROOT/'datasets/acting-feedback-r3/source-contracts'
    (out/'source-contracts').mkdir(exist_ok=True)
    for p in source.glob('*.json'):
        dest=out/'source-contracts'/p.name
        if dest.exists() and dest.read_bytes()!=p.read_bytes():raise RuntimeError('Baseline snapshot differs')
        shutil.copyfile(p,dest) if dest.resolve()!=p.resolve() else None
    jsonl(out/'records.jsonl',rows);jsonl(out/'acceptance.jsonl',acceptance)
    jsonl(out/'preferences.jsonl',[{'case_id':r['case_id'],'choice':r['choice'],'takes':r['takes'],'note':r['note'],'runtime':r['runtime'],
      'use':'audit_only','training_ready':False,'reason':'shared facial curves and changed motion definitions; no unverified parameter regression or neither-to-none conversion'} for r in review['rows']])
    dump(out/'source-hashes.json',source_files)
    manifest={'schema':'acting.feedback.dataset.v1','fingerprint':fingerprint,'counts':{'records':len(rows),'source':dict(Counter(r['source'] for r in rows)),
      'split':dict(Counter(r['split'] for r in rows)),'actions':dict(Counter(r['target']['id'] for r in rows)),
      'human_rating_cases_audited':len(review['rows']),'human_rating_files':review['counts']['human_rating_files'],'raw_human_motion_labels':0,
      'feedback_interpreted_cases':len(acceptance),'feedback_acceptance_cases':0,'training_replay_cases':len(acceptance),'legacy_rows_excluded_for_review_overlap':excluded},'leakage':leakage,
      'selection':'validation only; original feedback phrases are training supervision and replay checks, never advertised as unseen acceptance',
      'face_classifier':'frozen; labels never replaced by scenario names','artifacts':{name:sha(out/name) for name in ['records.jsonl','acceptance.jsonl','preferences.jsonl','source-hashes.json']}}
    dump(out/'manifest.json',manifest);print(json.dumps(manifest['counts'],ensure_ascii=False),flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--out',type=Path,default=OUT);build(parser.parse_args().out)
