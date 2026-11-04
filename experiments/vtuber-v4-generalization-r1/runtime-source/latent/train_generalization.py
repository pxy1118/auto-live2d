"""Controlled 2x2 backbone/representation experiment; test file is never loaded."""
import argparse
import json
import random
import time
from pathlib import Path
import torch
from torch.nn import functional as F
from common import ROOT,sha
from semantic_tokens import TokenPerformancePlanner,representation
from generalization_data import read_rows,batch,metrics,predict_all,subset,CHOICES

GATES={'arm':.85,'body':.4,'emotion':.7,'eye':.6}
def write(path,data):path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

def main():
    p=argparse.ArgumentParser();p.add_argument('--cache',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--mode',choices=['tail16_mean','full_attention'],required=True);p.add_argument('--seed',type=int,default=7137);p.add_argument('--steps',type=int,default=1600);p.add_argument('--dataset',type=Path,default=ROOT/'datasets/vtuber-v4-generalization-v1');args=p.parse_args()
    out=args.output;out.mkdir(parents=True,exist_ok=True)
    if (out/'planner.pt').exists():raise RuntimeError('Refusing to overwrite a completed experiment')
    torch.set_num_threads(3);torch.set_float32_matmul_precision('high');torch.manual_seed(args.seed);random.seed(args.seed);started=time.perf_counter()
    cache_meta=json.loads((args.cache/'cache.json').read_text());cache=torch.load(args.cache/'tokens.pt',map_location='cpu',weights_only=True)
    features={k:representation(v.to('cuda'),args.mode) for k,v in cache['features'].items()}
    assert cache_meta['dataset_manifest_sha256']==sha(args.dataset/'manifest.json') and not cache_meta['test_encoded']
    assert sha(args.cache/'tokens.pt')==cache_meta['tokens_sha256'];manifest=json.loads((args.dataset/'manifest.json').read_text())
    for split in ['train','validation']:assert sha(args.dataset/f'{split}.jsonl')==manifest['splits'][split]['sha256']
    train=read_rows(args.dataset,'train');dev=read_rows(args.dataset,'validation');ood=[i for i,r in enumerate(dev) if r['challenge']!='legacy']
    model=TokenPerformancePlanner(cache_meta['hidden_dim']).cuda();optimizer=torch.optim.AdamW(model.parameters(),lr=3e-4,weight_decay=.025)
    weights={}
    for k,choices in CHOICES.items():
        labels=torch.tensor([choices.index(r['target'][k]) for r in train],device='cuda');weights[k]=(len(train)/torch.bincount(labels,minlength=len(choices)).clamp_min(1)).sqrt()
    def loss(pred,y,v):
        categorical=sum(F.cross_entropy(pred[k],y[k],weight=weights[k])*({'body':1.2,'emotion':1.1,'eye':.85,'arm_variant':.35,'body_variant':.35}.get(k,1.)) for k in CHOICES)
        mask=torch.ones_like(v)*.25;mask[:,0]=torch.where(y['body']>0,1.,.2);mask[:,1:7]=torch.where(v[:,1:7]>.05,4.,.3);mask[:,7]=torch.where(y['eye']>0,2.,.2)
        return categorical+4*(F.smooth_l1_loss(pred['values'],v,reduction='none')*mask).sum()/mask.sum()
    best=-float('inf');best_state=None;logs=[]
    # Uniform scene/history sampling and identical recipe for every ablation.
    for step in range(args.steps):
        indices=[random.randrange(len(train)) for _ in range(64)];x,mask,state,y,v=batch(train,features,indices,None,'cuda')
        model.train();pred=model(x,mask,state);cost=loss(pred,y,v);optimizer.zero_grad();cost.backward();torch.nn.utils.clip_grad_norm_(model.parameters(),2);optimizer.step()
        if (step+1)%200==0:
            output=predict_all(model,dev,features,None);all_metrics=metrics(output,dev,GATES);new_metrics=metrics(subset(output,ood),[dev[i] for i in ood],GATES)
            score=.65*new_metrics['mean_macro_f1']+.35*all_metrics['mean_macro_f1']-.1*all_metrics['mean_false_positive_rate']-.1*all_metrics['regression_mae']
            log={'step':step+1,'score':score,'all':all_metrics,'new_scenarios':new_metrics,'elapsed_s':round(time.perf_counter()-started,1)};logs.append(log)
            print(json.dumps({'stage':'train','step':step+1,'score':score,'new_macro_f1':new_metrics['mean_macro_f1'],'elapsed_s':log['elapsed_s']}),flush=True)
            if score>best:best=score;best_state={k:v.detach().cpu().clone() for k,v in model.state_dict().items()};selected=log
    saved={'schema':'performance.plan.v1','architecture':'token_attention','input_dim':cache_meta['hidden_dim'],'width':128,'representation':args.mode,
           'state_dict':best_state,'step':selected['step'],'seed':args.seed,'encoder_source_sha256':cache_meta['encoder_source_sha256'],
           'dataset_manifest_sha256':cache_meta['dataset_manifest_sha256']};torch.save(saved,out/'planner.pt')
    model.load_state_dict(best_state);output=predict_all(model,dev,features,None)
    by_challenge={}
    for name in sorted({r['challenge'] for r in dev}):
        idx=[i for i,r in enumerate(dev) if r['challenge']==name];by_challenge[name]=metrics(subset(output,idx),[dev[i] for i in idx],GATES)
    metadata={'schema':'performance.plan.v1','architecture':'token_attention','repo':cache_meta['repo'],'revision':cache_meta['revision'],
        'representation':args.mode,'input_dim':cache_meta['hidden_dim'],'parameters':sum(p.numel() for p in model.parameters()),'seed':args.seed,
        'steps':args.steps,'selected_step':selected['step'],'selection_score':selected['score'],'checkpoint_sha256':sha(out/'planner.pt'),
        'dataset_manifest_sha256':cache_meta['dataset_manifest_sha256'],'encoder_source_sha256':cache_meta['encoder_source_sha256'],
        'cache_sha256':cache_meta['tokens_sha256'],'execution_thresholds':GATES,'grass_threshold':.95,
        'validation':selected,'validation_raw':metrics(output,dev),'by_challenge':by_challenge,'test_used_for_selection':False,
        'recipe':{'batch':64,'lr':.0003,'weight_decay':.025,'class_weight_exponent':.5,'width':128,'eval_every':200},
        'encoder_ms':cache_meta['encoder_ms'],'elapsed_s':round(time.perf_counter()-started,2),'logs':logs}
    write(out/'metadata.json',metadata);print(json.dumps({'stage':'complete','score':best,'output':str(out)}),flush=True)

if __name__=='__main__':main()
