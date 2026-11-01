"""Predeclared behavioral regression cases; not an independent generalization benchmark."""
import argparse
import json
from pathlib import Path
import urllib.request
from common import ROOT, read, write


def summarize(case, result):
    events=result['command']['params']['events']
    active={e['params']['name'] for e in events if e['method']=='expressions.set' and e['params']['enabled']}
    hand=any(e['method']=='gesture.set' and e['params']['pose']!='default' for e in events)
    return {'id':case['id'],'expected':{k:case[k] for k in ['blush','black','hand']},
            'predicted':{'blush':'脸红' in active,'black':'黑脸' in active,'hand':hand},'active_expressions':sorted(active),'constraints':result['constraints']}


def main(args):
    cases=read(ROOT/'tests/behavior-cases.json');report={'scope':'behavioral regression cases; known during development, not held-out quality','cases':[]}
    policy=None
    if args.experiment:
        from runtime import LatentPolicy
        policy=LatentPolicy(ROOT/args.experiment)
    for case in cases:
        payload={'text':case['text'],'context':case['context'],'style':'lively','kind':'regression'}
        if policy:result=policy.predict(**payload)
        else:
            req=urllib.request.Request(args.url+'/api/latent/predict',json.dumps(payload,ensure_ascii=False).encode(),{'Content-Type':'application/json'})
            with urllib.request.urlopen(req,timeout=60) as response:result=json.load(response)
        report['cases'].append(summarize(case,result))
    report['metrics']={}
    for key in ['blush','black','hand']:
        neg=[r for r in report['cases'] if not r['expected'][key]];pos=[r for r in report['cases'] if r['expected'][key]]
        report['metrics'][key]={'false_positives':sum(r['predicted'][key] for r in neg),'negative_cases':len(neg),'true_positives':sum(r['predicted'][key] for r in pos),'positive_cases':len(pos)}
    write(ROOT/args.output,report);print(json.dumps(report['metrics']))


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--url',default='http://127.0.0.1:8765');parser.add_argument('--experiment');parser.add_argument('--output',required=True)
    main(parser.parse_args())
