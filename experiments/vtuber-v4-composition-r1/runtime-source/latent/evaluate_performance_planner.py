"""One final held-out test evaluation; never called by training/selection."""
import argparse,hashlib,json
from pathlib import Path
import torch
from performance_planner import load_planner,decode,class_probabilities
from planner_contract import ARMS,BODIES,EMOTIONS,EYES,target_values
ROOT=Path(__file__).resolve().parents[1]
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--run',type=Path,default=ROOT/'experiments/vtuber-v4-composition-r1');parser.add_argument('--split',choices=['validation','test'],default='test');args=parser.parse_args();run=args.run.resolve();destination=run/(args.split+'-evaluation.json')
    if args.split=='test' and destination.exists():raise RuntimeError('Final test already evaluated; do not use it for model selection')
    meta=json.loads((run/'performance-planner.json').read_text(encoding='utf-8'));rows=[json.loads(line) for line in (ROOT/meta['dataset']/'records.jsonl').read_text(encoding='utf-8').splitlines()];rows=[r for r in rows if r['split']==args.split]
    cache=torch.load(ROOT/'experiments/vtuber-v4-planner-r1/semantic-cache.pt',weights_only=True);saved=torch.load(run/'performance-planner.pt',weights_only=True);model=load_planner(saved).eval();x=torch.stack([cache[r['text']+'\n'+r['context']] for r in rows]);state=torch.tensor([r['state_vector'] for r in rows]);torch.set_num_threads(3)
    with torch.inference_mode():output=model(x,state)
    decoded=[decode({k:v[i] for k,v in output.items()},meta['thresholds']) for i in range(len(rows))];metrics={};mistakes=[]
    for key,labels in [('arm',ARMS),('body',BODIES),('emotion',EMOTIONS),('eye',EYES)]:
        true=torch.tensor([labels.index(r['target'][key]) for r in rows]);selected=torch.tensor([labels.index(p[key]) for p in decoded]);negative=true==0;positive=~negative
        metrics[key]={'accuracy':float((true==selected).float().mean()),'false_positive_rate':float(((selected>0)&negative).sum()/negative.sum().clamp_min(1)),'correct_active_recall':float(((true==selected)&positive).sum()/positive.sum().clamp_min(1)),
                      'per_class_recall':{name:float(((selected==i)&(true==i)).sum()/(true==i).sum().clamp_min(1)) for i,name in enumerate(labels)}}
    for r,p in zip(rows,decoded):
        if any(r['target'][k]!=p[k] for k in ['arm','body','emotion','eye']):mistakes.append({'id':r['id'],'source':r['source'],'text':r['text'],'context':r['context'],'expected':{k:r['target'][k] for k in ['arm','body','emotion','eye']},'predicted':{k:p[k] for k in ['arm','body','emotion','eye']}})
    truth=torch.tensor([target_values(r['target']) for r in rows]);error=(output['values']-truth).abs();active=truth[:,1:7]>.05;metrics['regression']={'normalized_mae':float(error.mean()),'active_face_strength_mae':float(error[:,1:7][active].mean()),'active_body_strength_mae':float(error[:,0][torch.tensor([r['target']['body']!='none' for r in rows])].mean())}
    result={'split':args.split,'records':len(rows),'unique_text_context':len({(r['text'],r['context']) for r in rows}),'checkpoint_sha256':hashlib.sha256((run/'performance-planner.pt').read_bytes()).hexdigest(),'metrics':metrics,'not_used_for_selection':args.split=='test','mistakes':mistakes}
    destination.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');print(json.dumps({k:v for k,v in result.items() if k!='mistakes'}))
if __name__=='__main__':main()
