import argparse
import json
from pathlib import Path
import random
import time
import shutil
import numpy as np
import torch
import torch.nn.functional as F
from common import ROOT, CHANNELS, SOURCE, PROFILE, HORIZON, HZ, write, read, sha, digest
from data import prepare, profile_for
from encoder import SemanticEncoder
from networks import ActionExpert


def features_for(rows, manifest, cache, device):
    if cache.exists():
        saved=torch.load(cache,map_location="cpu",weights_only=True)
        if saved['dataset_sha256']!=manifest['sha256'] or saved['encoder_revision']!=SOURCE['revision']: raise ValueError("特征缓存来源不匹配")
        if saved.get('sample_ids',[r['id'] for r in rows])!=[r['id'] for r in rows] or len(saved['features'])!=len(rows):raise ValueError('缓存的样本拆分不匹配')
        return saved
    encoder=SemanticEncoder(device); features=[]; masks=[]; times=[]
    for i,row in enumerate(rows):
        a=row['annotation']; h,mask,measurement=encoder.encode(a['utterance'],a.get('context',''),a.get('style','natural'))
        features.append(h.cpu()); masks.append(mask.cpu()); times.append(measurement)
        if (i+1)%20==0: print(json.dumps({'encoded':i+1,'total':len(rows)}),flush=True)
    saved={'features':torch.stack(features),'mask':torch.stack(masks),'dataset_sha256':manifest['sha256'],'encoder_revision':SOURCE['revision'],'sample_ids':[r['id'] for r in rows],'measurements':times}
    cache.parent.mkdir(parents=True,exist_ok=True); torch.save(saved,cache)
    del encoder
    if device=='cuda': torch.cuda.empty_cache()
    return saved


def regression_metrics(model, features, state, mask, targets, active_axes, channels=CHANNELS):
    predicted,rr,ll=model.sample(features,state,mask)
    shuffled,_,_=model.sample(features.roll(1,0),state,mask.roll(1,0))
    y=targets['actions']; clipped=predicted.clamp(-1,1)
    neutral=torch.tensor([2*(c['neutral']-c['min'])/(c['max']-c['min'])-1 for c in channels],device=y.device)
    motion=(y-neutral).abs()>.03
    return {'all_axis_normalized_mae':float((clipped-y).abs().mean()),
            'motion_only_normalized_mae':float(((clipped-y).abs()*motion).sum()/motion.sum().clamp_min(1)),
            'observed_axis_normalized_mae':float((clipped[:,:,active_axes]-y[:,:,active_axes]).abs().mean()),
            'shuffled_features_observed_axis_mae':float((shuffled.clamp(-1,1)[:,:,active_axes]-y[:,:,active_axes]).abs().mean()),
            'raw_out_of_range_fraction':float(((predicted < -1)|(predicted > 1)).float().mean()),
            'right_frame_accuracy':float((rr.argmax(-1)==targets['right']).float().mean()),
            'left_frame_accuracy':float((ll.argmax(-1)==targets['left']).float().mean())}


def main(args):
    output=Path(args.output)
    if output.exists(): raise ValueError("实验目录已存在；不覆盖历史")
    device='cuda' if torch.cuda.is_available() else 'cpu'
    torch.manual_seed(41); np.random.seed(41); random.seed(41); torch.set_num_threads(4)
    rows,manifest,data=prepare(args.dataset,args.split)
    profile=profile_for(args.dataset);channels=profile['channels']
    cache_name='features-'+manifest['selection']['split']+'.pt' if 'selection' in manifest else 'features.pt'
    cached=features_for(rows,manifest,Path(args.dataset)/cache_name,device)
    features=cached['features'].to(device); mask=cached['mask'].to(device)
    targets={k:torch.from_numpy(v).to(device) for k,v in data.items()}; state=targets['state']; y=targets['actions']
    neutral=torch.tensor([2*(c['neutral']-c['min'])/(c['max']-c['min'])-1 for c in channels],device=device)
    active_axes=((y-neutral).abs().amax((0,1))>.03)
    output.mkdir(parents=True,exist_ok=False); write(output/'dataset.json',manifest);write(output/'profile.json',profile)
    (output/'source').mkdir()
    for source in (ROOT/'latent').iterdir():
        if source.is_file() and source.suffix in ['.py','.json','.toml','.lock']: shutil.copy2(source,output/'source'/source.name)
    summary={'schema':'latent_pilot.v1','supervision':manifest['supervision'],'experimental_only':True,'held_out_evaluation':False,
             'dataset_path':str(Path(args.dataset)),'selection':manifest.get('selection',{'split':'all'}),'dataset_sha256':manifest['sha256'],'encoder':SOURCE,'profile_sha256':profile['sha256'],'asset_hash':manifest['asset_hash'],
             'samples':len(rows),'seed':41,'input_fields':['utterance','context','style','initial_control_and_gesture_state'],
             'target_not_in_encoder_input':['primary_action','intensity','command_log','sample_id'], 'horizon':HORIZON,'sample_hz':HZ,
             'action_dim':len(channels),'observed_axes':[c['id'] for c,a in zip(channels,active_axes) if a],'loss_variant':args.loss,'models':{}}
    for kind in ['regression','flow']:
        model=ActionExpert(kind,action_dim=len(channels)).to(device); opt=torch.optim.AdamW(model.parameters(),lr=8e-4,weight_decay=1e-4)
        steps=args.steps if kind=='regression' else int(args.steps*1.5)
        losses=[]; started=time.perf_counter()
        for step in range(steps):
            model.train(); ids=torch.randint(len(rows),(min(24,len(rows)),),device=device)
            a=y[ids]; padding_weight=targets['valid'][ids].float()[:,:,None]*.8+.2
            activity=1+5*((a-neutral).abs()>.03).float()
            if kind=='regression':
                estimate,rr,ll=model(features[ids],state[ids],mask[ids])
                main_loss=((estimate-a).abs()*activity*padding_weight).mean()
                end=estimate
            else:
                noise=torch.randn_like(a); t=torch.rand(len(ids),device=device)*.98+.01
                xt=(1-t[:,None,None])*noise+t[:,None,None]*a
                velocity,rr,ll=model(features[ids],state[ids],mask[ids],xt,t)
                end=xt+(1-t[:,None,None])*velocity
                main_loss=F.mse_loss(velocity,a-noise)+.5*((end-a).abs()*activity*padding_weight).mean()
            if args.loss=='balanced':
                motion=((a-neutral).abs()>.03).float(); error=(end-a).abs()
                counts=motion.sum((0,1)); observed=counts>0
                motion_loss=((error*motion).sum((0,1))/counts.clamp_min(1))[observed].mean() if observed.any() else error.new_tensor(0.)
                rest=1-motion; rest_loss=(error*rest*padding_weight).sum()/(rest*padding_weight).sum().clamp_min(1)
                balanced=motion_loss+.25*rest_loss
                main_loss=balanced if kind=='regression' else F.mse_loss(velocity,a-noise)+.5*balanced
            speed=((end[:,1:]-end[:,:-1])-(a[:,1:]-a[:,:-1])).abs().mean()
            right_weight=torch.tensor([1.,8.,1.],device=device); left_weight=torch.tensor([1.,8.],device=device)
            gesture=F.cross_entropy(rr.transpose(1,2),targets['right'][ids],weight=right_weight)+F.cross_entropy(ll.transpose(1,2),targets['left'][ids],weight=left_weight)
            loss=main_loss+.2*speed+.25*gesture
            if not torch.isfinite(loss): raise ValueError("训练出现非有限损失")
            opt.zero_grad(set_to_none=True); loss.backward(); torch.nn.utils.clip_grad_norm_(model.parameters(),1.); opt.step()
            if step%100==0 or step==steps-1:
                losses.append({'step':step+1,'loss':float(loss.detach())}); print(json.dumps({'model':kind,**losses[-1]}),flush=True)
        model.eval()
        with torch.inference_mode(): metrics=regression_metrics(model,features,state,mask,targets,active_axes,channels)
        checkpoint={'schema':'latent_expert.v1','state_dict':{k:v.cpu() for k,v in model.state_dict().items()},'kind':kind,'width':model.width,'layers':model.layers,
                    'action_dim':len(channels),'profile_sha256':profile['sha256'],'dataset_sha256':manifest['sha256'],'encoder_revision':SOURCE['revision'],'experimental_only':True}
        file=output/f'{kind}.pt'; torch.save(checkpoint,file)
        restored=ActionExpert(kind,action_dim=len(channels)); restored.load_state_dict(torch.load(file,weights_only=True)['state_dict'])
        summary['models'][kind]={'parameters':sum(p.numel() for p in model.parameters()),'steps':steps,'losses':losses,'training_set_metrics':metrics,
                                  'seconds':time.perf_counter()-started,'checkpoint':file.name,'checkpoint_sha256':sha(file),'weights_roundtrip':all(torch.equal(v.cpu(),restored.state_dict()[k]) for k,v in model.state_dict().items())}
        write(output/'run.json',summary)
        del model,opt
        if device=='cuda': torch.cuda.empty_cache()
    write(output/'run.json',summary)
    print(json.dumps({'ok':True,'experiment':str(output),'claim':'program-supervised training fit only; no independent language generalization evidence'}),flush=True)


if __name__=='__main__':
    default_dataset=read(ROOT/'latent/training-set.json')['dataset'] if (ROOT/'latent/training-set.json').exists() else 'datasets/pilot-v1'
    parser=argparse.ArgumentParser(); parser.add_argument('--dataset',default=default_dataset); parser.add_argument('--output',required=True); parser.add_argument('--steps',type=int,default=2000)
    parser.add_argument('--split',choices=['train','all'],default=None)
    parser.add_argument('--loss',choices=['original','balanced'],default='balanced')
    args=parser.parse_args()
    if not 1<=args.steps<=10000: parser.error('steps must be 1..10000')
    main(args)
