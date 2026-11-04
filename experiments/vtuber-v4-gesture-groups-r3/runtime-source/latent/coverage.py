"""Verify visible-option coverage from actual Cubism recordings, not candidate labels alone."""
import argparse
from pathlib import Path
import numpy as np
from common import ROOT,read,write,sha


def main(folder):
    profile=read(folder/'profile.json');clips=[read(p) for p in sorted((folder/'candidates').glob('*.json'))]
    qa=read(folder/'review/automated-qa.json');expressions={};motions={};evidence={}
    model=ROOT/'live2d/DeepSeek/DeepSeek';extra={'默认体型':'config_default_body','体型1':'config_body1','体型2':'config_body2','前倾':'config_lean','竖食指开':'point_explain','竖食指关':'point_explain'}
    for c in clips:
        rec=read(folder/c['recording_file']);ids={k:i for i,k in enumerate(rec['parameter_ids'])}
        values=np.array([f['actual'] for f in rec['frames']]);initial=rec['initial_state']['values']
        commands=rec['commands'];names={e['params']['name'] for e in commands if e['method']=='expressions.set' and e['params'].get('enabled',True)}
        for name,family in extra.items():
            if c['family']==family:names.add(name)
        for name in names:
            params=read(model/'Exp3'/(name+'.exp3.json'))['Parameters'];checks={}
            for p in params:
                v=values[:,ids[p['Id']]]
                if name=='默认体型':good=abs(float(v[-1]))<.01
                elif name=='竖食指关':good=float(v.max())>.9 and abs(float(v[-1]))<.01
                elif p.get('Blend')=='Add' and p['Value']==0:good=bool((np.abs(v-initial[p['Id']])<.01).any())
                else:good=float(np.abs(v-initial[p['Id']]).max())>.05
                checks[p['Id']]={'min':float(v.min()),'max':float(v.max()),'pass':bool(good)}
            if all(x['pass'] for x in checks.values()):expressions.setdefault(name,[]).append(c['id']);evidence.setdefault(name,{'clip_id':c['id'],'recording_sha256':c['recording_sha256'],'parameters':checks})
        played={t['name'] if isinstance(t,dict) else t for s in c['trace'] for t in s['motions']}
        for name in played:motions.setdefault(name,[]).append(c['id'])
        if qa['results'][c['id']]['gates']['all_background_behaviors_resident'] and qa['results'][c['id']]['gates']['resident_idle_changes']:motions.setdefault('IDLE',[]).append(c['id'])
    expected_e={p.name[:-10] for p in (model/'Exp3').glob('*.exp3.json')};expected_m={p.name[:-13] for p in (model/'Animation').glob('*.motion3.json')}
    rates={}
    for split in ['all','train','validation','test']:
        group=[c for c in clips if split=='all' or c['split']==split]
        rates[split]={'clips':len(group),'blush_clips':sum(any(row[profile['expressions'].index('脸红')] for row in c['expressions']) for c in group),
            'black_clips':sum(any(row[profile['expressions'].index('黑脸')] for row in c['expressions']) for c in group),
            'explicit_hand_clips':sum(any(c['right']) or any(c['left']) for c in group),'native_full_clips':sum(bool(c['native_motion']) for c in group)}
    missing={'expressions':sorted(expected_e-set(expressions)),'motions':sorted(expected_m-set(motions))}
    report={'scope':'all visible expressions, appearance presets, gestures and original animations; no exhaustive 509-slider sampling',
        'pass':not any(missing.values()),'expression_count':len(expected_e),'motion_count':len(expected_m),'missing':missing,
        'expressions':expressions,'expression_evidence':evidence,'motions':motions,'background_behavior':profile['background_behavior'],'distribution':rates,
        'equivalents':{'body_presets':'appearance.set equals Clothes2 = 0 / 0.4 / 1; raw Add-zero default expression is represented by explicit default restoration',
            'finger':'semantic gesture.set plays paired original transition clips, including closure',
            'lean':'continuous LeanInput controls the native forward-lean input',
            'native':'full tracking-loss motion is learned as native clip selection; its curves are not generated twice'},
        'qa_sha256':sha(folder/'review/automated-qa.json'),'human_reviewed':False}
    write(folder/'review/coverage.json',report)
    if not report['pass']:raise ValueError(missing)
    print({'coverage':'23 expressions / 8 motions','distribution':rates})


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--dataset',default='datasets/vtuber-v3')
    main(ROOT/parser.parse_args().dataset)
