"""Train composition heads on frozen semantics. Test labels are not consulted."""
import argparse,hashlib,json,time,random
from pathlib import Path
import numpy as np
import torch
from torch.nn import functional as F
from encoder import SemanticEncoder
from performance_planner import PerformancePlanner,decode,class_probabilities
from planner_contract import ARMS,BODIES,EMOTIONS,EYES,SCHEMA,target_values
ROOT=Path(__file__).resolve().parents[1]
CHOICES={'arm':ARMS,'body':BODIES,'emotion':EMOTIONS,'eye':EYES,'arm_variant':list(range(3)),'body_variant':list(range(3))}
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(p,d):p.write_text(json.dumps(d,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf-8')
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--dataset',type=Path,default=ROOT/'datasets/vtuber-v4-planner-v2');parser.add_argument('--output',type=Path,required=True);parser.add_argument('--steps',type=int,default=3200);parser.add_argument('--cache-from',type=Path);parser.add_argument('--architecture',choices=['linear','nonlinear','body_binary'],default='nonlinear');parser.add_argument('--class-weight-exponent',type=float,default=1.);parser.add_argument('--none-weight',type=float,default=1.);parser.add_argument('--selection',choices=['macro','loss'],default='macro');parser.add_argument('--threshold-min',type=float,default=.35);args=parser.parse_args();out=args.output.resolve();out.mkdir(parents=True,exist_ok=True)
    if (out/'performance-planner.pt').exists():raise RuntimeError('Refusing to overwrite a trained planner candidate')
    torch.set_num_threads(3);torch.manual_seed(7137);random.seed(7137);started=time.perf_counter()
    raw=args.dataset/'records.jsonl';manifest=json.loads((args.dataset/'manifest.json').read_text(encoding='utf-8'));assert sha(raw)==manifest['records_sha256']
    rows=[json.loads(line) for line in raw.read_text(encoding='utf-8').splitlines()];keys=sorted({r['text']+'\n'+r['context'] for r in rows})
    cachefile=out/'semantic-cache.pt';source_cache=cachefile if cachefile.exists() else args.cache_from;cache=torch.load(source_cache,map_location='cpu',weights_only=True) if source_cache else {};missing=[k for k in keys if k not in cache]
    if not missing and not cachefile.exists():torch.save(cache,cachefile)
    if missing:
        encoder=SemanticEncoder('cuda')
        for i,key in enumerate(missing):
            text,context=key.split('\n',1);h,m,_=encoder.encode(text,context,'natural');weights=(~m).float();cache[key]=((h*weights[:,None]).sum(0)/weights.sum().clamp_min(1)).cpu()
            if (i+1)%64==0 or i+1==len(missing):
                torch.save(cache,cachefile);print(json.dumps({'stage':'encode','completed':i+1,'total':len(missing),'elapsed_s':round(time.perf_counter()-started,1)}),flush=True)
        del encoder;torch.cuda.empty_cache()
    tensors={}
    for split in ['train','validation']:
        rr=[r for r in rows if r['split']==split];x=torch.stack([cache[r['text']+'\n'+r['context']] for r in rr]).cuda();state=torch.tensor([r['state_vector'] for r in rr],device='cuda')
        labels={k:torch.tensor([choices.index(r['target'].get(k,0)) for r in rr],device='cuda') for k,choices in CHOICES.items()};values=torch.tensor([target_values(r['target']) for r in rr],device='cuda').clamp(0,1)
        tensors[split]=(x,state,labels,values)
    model=PerformancePlanner(args.architecture).cuda();x,state,labels,values=tensors['train'];model.mean.copy_(x.mean(0));model.scale.copy_(x.std(0).clamp_min(.05))
    weights={k:(len(v)/torch.bincount(v,minlength=len(CHOICES[k])).clamp_min(1)).pow(args.class_weight_exponent) for k,v in labels.items()}
    for k in ['arm','body','emotion','eye']:weights[k][0]*=args.none_weight
    body_positive=torch.bincount(labels['body'],minlength=len(BODIES))[1:].float().clamp_min(1);body_weight=(len(x)-body_positive)/body_positive
    optimizer=torch.optim.AdamW(model.parameters(),lr=4e-4,weight_decay=.025);best=float('inf');logs=[]
    def loss(output,y,v):
        categorical=sum(F.cross_entropy(output[k],y[k],weight=weights[k])*({'body':1.2,'emotion':1.1,'eye':.85,'arm_variant':.35,'body_variant':.35}.get(k,1.)) for k in CHOICES if k!='body' or args.architecture!='body_binary')
        if args.architecture=='body_binary':categorical+=1.2*F.binary_cross_entropy_with_logits(output['body_binary_logits'],F.one_hot(y['body'],len(BODIES))[:,1:].float(),pos_weight=body_weight)
        mask=torch.ones_like(v)*.25;mask[:,0]=torch.where(y['body']>0,1.,.2);mask[:,1:7]=torch.where(v[:,1:7]>.05,4.,.3);mask[:,7]=torch.where(y['eye']>0,2.,.2);mask[:,8]=torch.where(y['arm']>0,1.,.1);mask[:,9]=torch.where(y['body']>0,1.,.1);mask[:,10]=torch.where((y['emotion']>0)|(y['eye']>0),1.,.1);mask[:,11]=torch.where((y['body']>0)|(y['arm']>0),1.,.1)
        return categorical+4*(F.smooth_l1_loss(output['values'],v,reduction='none')*mask).sum()/mask.sum()
    for step in range(args.steps):
        model.train();j=torch.randint(len(x),(128,),device='cuda');prediction=model(x[j],state[j]);cost=loss(prediction,{k:v[j] for k,v in labels.items()},values[j]);optimizer.zero_grad();cost.backward();torch.nn.utils.clip_grad_norm_(model.parameters(),2);optimizer.step()
        if (step+1)%100==0:
            model.eval();a,b,c,d=tensors['validation']
            with torch.inference_mode():p=model(a,b);score=float(loss(p,c,d));accuracy={k:float((class_probabilities(p,k).argmax(-1)==c[k]).float().mean()) for k in CHOICES}
            macro={}
            for k in ['arm','body','emotion','eye']:
                idx=class_probabilities(p,k).argmax(-1);f1=[]
                for n in range(len(CHOICES[k])):
                    tp=((idx==n)&(c[k]==n)).sum();fp=((idx==n)&(c[k]!=n)).sum();fn=((idx!=n)&(c[k]==n)).sum();f1.append(float(2*tp/(2*tp+fp+fn).clamp_min(1)))
                macro[k]=sum(f1)/len(f1)
            selection=score if args.selection=='loss' else -(sum(macro.values())/4-.15*float((p['values']-d).abs().mean()))
            record={'step':step+1,'validation_loss':score,'accuracy':accuracy,'macro_f1':macro,'selection_score':-selection,'elapsed_s':round(time.perf_counter()-started,2)};logs.append(record);print(json.dumps({'stage':'train',**record}),flush=True)
            if selection<best:best=selection;torch.save({'schema':SCHEMA,'architecture':args.architecture,'state_dict':model.state_dict(),'dataset_sha256':sha(raw),'step':step+1},out/'performance-planner.pt')
    saved=torch.load(out/'performance-planner.pt',weights_only=True);model.load_state_dict(saved['state_dict']);model.eval();a,b,c,d=tensors['validation']
    with torch.inference_mode():prediction=model(a,b)
    thresholds={};metrics={}
    for k in ['arm','body','emotion','eye']:
        conf,idx=class_probabilities(prediction,k).max(-1);negative=c[k]==0;options=[]
        for t in [.35,.4,.45,.5,.55,.6,.65,.7,.75,.8,.85,.9,.95]:
            if t<args.threshold_min:continue
            selected=torch.where((idx>0)&(conf<t),0,idx);active=selected>0;positive=~negative
            options.append({'threshold':t,'accuracy':float((selected==c[k]).float().mean()),'false_positive_rate':float((active&negative).sum()/negative.sum().clamp_min(1)),'correct_active_recall':float(((selected==c[k])&positive).sum()/positive.sum().clamp_min(1))})
        valid=[r for r in options if r['false_positive_rate']<=(.04 if k in ['arm','body'] else .06)];chosen=max(valid or options,key=lambda r:(r['correct_active_recall'],-r['false_positive_rate'],r['accuracy'],r['threshold']));thresholds[k]=chosen['threshold'];metrics[k]=chosen
    metrics['regression_mae']=float((prediction['values']-d).abs().mean());metrics['arm_variant_accuracy']=float((prediction['arm_variant'].argmax(-1)==c['arm_variant']).float().mean());metrics['body_variant_accuracy']=float((prediction['body_variant'].argmax(-1)==c['body_variant']).float().mean())
    metadata={'schema':SCHEMA,'architecture':args.architecture,'checkpoint':'performance-planner.pt','sha256':sha(out/'performance-planner.pt'),'dataset':args.dataset.relative_to(ROOT).as_posix(),'dataset_sha256':sha(raw),'semantic_cache_sha256':sha(cachefile),'encoder_source_sha256':sha(ROOT/'latent/encoder-source.json'),'labels':CHOICES,'thresholds':thresholds,'selected_step':saved['step'],'parameters':sum(p.numel() for p in model.parameters()),'validation':metrics,'training_log':logs,'test_used_for_selection':False,'source':'synthetic authored scenario families and frozen Qwen semantics; no human preference scores','elapsed_s':round(time.perf_counter()-started,2)}
    write(out/'performance-planner.json',metadata);print(json.dumps({'stage':'complete','validation':metrics,'selected_step':saved['step']}),flush=True)
if __name__=='__main__':main()
