"""Versioned train/development/final-test files; old test labels never enter training."""
import copy
import hashlib
import json
import random
import re
import sys
import unicodedata
from collections import Counter
from pathlib import Path
from generalization_scenarios import CASES, CONTRASTS

ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'latent'))
from planner_contract import ARMS,BODIES,EMOTIONS,FACES,SCHEMA,state_vector
OUT=ROOT/'datasets/vtuber-v4-generalization-v1'

def norm(s):return re.sub(r'[^\w]','',unicodedata.normalize('NFKC',s)).lower()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(p,d):p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
def plan(arm='none',body='none',emotion='keep',eye='normal',level=.5):
    faces={k:0. for k in FACES};channel={'angry':'黑脸','shy':'脸红','sad':'流泪','confused':'加载'}.get(emotion)
    if channel:faces[channel]=level
    return dict(schema=SCHEMA,arm=arm,body=body,emotion=emotion,eye=eye,arm_variant=0,body_variant=0,
        body_strength=.75 if body!='none' else 0.,expressions=faces,eye_strength=float(eye!='normal'),
        arm_hold_ms=1700 if arm in ['grass','explain'] else 1250,body_hold_ms=2800 if body=='cajole' else 2100,
        face_hold_ms=5500 if emotion=='angry' else 4300 if emotion=='shy' else 3200,onset_ms=240)

def main():
    if OUT.exists():raise RuntimeError('Refusing to overwrite a versioned dataset')
    rows=[];base=[];rng=random.Random(31991)
    old=ROOT/'datasets/vtuber-v4-planner-v2/records.jsonl'
    for line in old.read_text(encoding='utf-8').splitlines():
        r=json.loads(line)
        if r['split']=='test':continue
        r['id']='legacy-'+r['id'];r['source_dataset']='vtuber-v4-planner-v2'
        r['challenge']='legacy';r['target']['eye_strength']=float(r['target']['eye']!='normal');rows.append(r)
    def add(split,family,text,context,target,challenge):
        base.append(dict(split=split,semantic_group='generalization-'+family,family=family,text=text,context=context,
                         target=copy.deepcopy(target),source='authored_generalization',challenge=challenge))
    for index,(split,family,texts,context,arm,body,emotion,eye,level) in enumerate(CASES):
        for text in texts.split('|'):
            add(split,family,text,context,plan(arm,body,emotion,eye,level),'implicit_intent')
        if index%3==0:
            text=texts.split('|')[0]
            add(split,family,f'我只是转述她说的“{text.rstrip("。？！") }”，这不是我的感受。',
                '正在平静读别人的发言，不代入角色，不表演引号内容。',plan(),'attribution')
    for split,family,text,c1,e1,eye1,c2,e2,eye2 in CONTRASTS:
        for context,emotion,eye in [(c1,e1,eye1),(c2,e2,eye2)]:
            body='cajole' if family in ['again','repeat','shorter-stay'] and emotion=='shy' else 'none'
            add(split,family,text,context,plan(body=body,emotion=emotion,eye=eye,level=.75 if emotion=='angry' else .45),'context_flip')
    add('test','held-thanks-cajole','你替我准备了这么多，真的很感激，再多陪我一小会儿嘛。',
        '你向亲近的人道谢，又带一点撒娇地挽留。',plan('thanks','cajole','shy',level=.4),'unseen_composition')
    # Paired mild/strong situations have identical words but different degree in context.
    for split,tag,text in [('train','notice','这一下，我可有点接不住了。'),('validation','public','你把这个说出来，我都有点不知所措。'),('test','letter','这封信，怎么能写得这么认真呀。')]:
        for level,context in [(.25,'朋友轻轻夸了一句，你略有一点不好意思，仍很从容。'),(.85,'亲近的人当众深情告白，你明显害羞，脸颊发热。')]:
            add(split,'degree-'+tag,text,context,plan(emotion='shy',level=level),'intensity_context')
    # Coherent multi-clause conditions, kept entirely inside their original split.
    sequences=[]
    for split,count in [('train',80),('validation',20),('test',20)]:
        eligible=[r for r in base if r['split']==split and r['challenge']=='implicit_intent']
        for i in range(count):
            chosen=rng.sample(eligible,3);recent=[];ids=[]
            for j,source in enumerate(chosen):
                row=copy.deepcopy(source);row['context']=source['context']+'\n最近说过：'+''.join(recent[-2:]);row['challenge']='dialogue';row['sequence_id']=f'{split}-{i:03}';base.append(row);ids.append(len(base)-1);recent.append(row['text'])
            sequences.append(dict(id=f'{split}-{i:03}',split=split,base_indices=ids))
    for i,r in enumerate(base):
        for k in range(3):
            state={'emotion':EMOTIONS[1+(i+k)%7],'last_arm':ARMS[(i+k)%len(ARMS)],'last_body':BODIES[(i*3+k)%len(BODIES)],
                'last_arm_variant':k,'last_body_variant':(k+1)%3,'arm_age_ms':[700,4500,11000][k],
                'body_age_ms':[600,2800,8000][k],'arm_active':k==0,'body_active':k==0,'face_state':[0.]*12}
            if state['emotion'] in ['angry','shy','sad']:state['face_state'][{'angry':0,'shy':2,'sad':1}[state['emotion']]]=.55
            row=copy.deepcopy(r);row.update(id=f'g{i:05}-h{k}',state=state,state_vector=state_vector(state));row['target'].update(arm_variant=(k+1)%3,body_variant=(k+2)%3);rows.append(row)
    text_splits={};families={}
    for r in rows:
        text_splits.setdefault(norm(r['text']),set()).add(r['split']);families.setdefault(r['semantic_group'],set()).add(r['split'])
        if r['split']=='train':assert (r['target']['arm'],r['target']['body']) not in [('thanks','cajole'),('point','tilt')]
    assert all(len(s)==1 for s in text_splits.values()),'Normalized utterance leaked across splits'
    assert all(len(s)==1 for s in families.values()),'Semantic family leaked across splits'
    OUT.mkdir()
    paths={}
    for split in ['train','validation','test']:
        rr=[r for r in rows if r['split']==split];path=OUT/f'{split}.jsonl'
        path.write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in rr),encoding='utf-8',newline='\n')
        paths[split]={'file':path.name,'sha256':sha(path),'records':len(rr),
            'unique_text_contexts':len({(r['text'],r['context']) for r in rr}),
            'new_scenarios':len({r['semantic_group'] for r in rr if r['challenge']!='legacy'}),
            'challenge_counts':dict(Counter(r['challenge'] for r in rr))}
    write(OUT/'sequences.json',sequences)
    write(OUT/'manifest.json',{'schema':'generalization.dataset.v1','splits':paths,'parent_records_sha256':sha(old),
        'source_sha256':{n:sha(Path(__file__).parent/n) for n in ['generalization_scenarios.py','build_generalization_data.py']},
        'source':'authored synthetic supervision, not human performance demonstrations','human_reviewed':False,
        'history_augmentations':3,'sequences':len(sequences),'held_out_compositions':[['thanks','cajole'],['point','tilt']],
        'split_policy':'complete normalized utterances, context pairs, semantic scenarios and all history variants isolated',
        'test_policy':'separate file; never loaded by feature caching, training or selection; evaluate selected checkpoint once'})
    print(json.dumps({'path':str(OUT.relative_to(ROOT)),'splits':paths},ensure_ascii=False))

if __name__=='__main__':main()
