"""Train-only rare continuous-control refinement, with all categorical heads frozen."""
import argparse,shutil,time
from pathlib import Path
import torch
import torch.nn.functional as F
from common import ROOT,read,write,sha,SOURCE
from data import prepare,profile_for
from networks import ActionExpert


def main(base,output,dataset,steps):
    if output.exists():raise ValueError('Output exists')
    torch.set_num_threads(4);torch.manual_seed(41)
    rows,manifest,data=prepare(dataset,'train');profile=profile_for(dataset)
    cached=torch.load(dataset/'features-train.pt',weights_only=True);assert cached['dataset_sha256']==manifest['sha256'] and cached['sample_ids']==[r['id'] for r in rows] and cached['encoder_revision']==SOURCE['revision']
    device='cuda' if torch.cuda.is_available() else 'cpu';h=cached['features'].to(device);mask=cached['mask'].to(device);state=torch.from_numpy(data['state']).to(device);truth=torch.from_numpy(data['actions']).to(device)
    rare=torch.tensor([i for i,r in enumerate(rows) if r['family']=='config_lean'],device=device);assert len(rare)
    neutral=torch.tensor([2*(c['neutral']-c['min'])/(c['max']-c['min'])-1 for c in profile['channels']],device=device);axis=next(i for i,c in enumerate(profile['channels']) if c['id']=='LeanInput')
    output.mkdir(parents=True);run=read(base/'run.json');write(output/'profile.json',profile);shutil.copy2(base/'dataset.json',output/'dataset.json');(output/'source').mkdir()
    for p in (ROOT/'latent').iterdir():
        if p.is_file() and p.suffix in ['.py','.json','.toml','.lock']:shutil.copy2(p,output/'source'/p.name)
    report={'selection':'train only','reason':'large forward lean absent in trained explicit configuration example','base':str(base.relative_to(ROOT)),'models':{}}
    for kind in ['regression','flow']:
        saved=torch.load(base/f'{kind}.pt',weights_only=True);model=ActionExpert(kind,saved['width'],saved['layers'],saved['action_dim'],saved['expression_dim'],saved['appearance_dim'],saved['native_dim']).to(device);model.load_state_dict(saved['state_dict']);model.requires_grad_(False)
        model.decoder.requires_grad_(True);model.action.requires_grad_(True)
        if kind=='flow':model.noisy.requires_grad_(True);model.flow_time.requires_grad_(True)
        original={k:v.clone() for k,v in model.state_dict().items()};opt=torch.optim.AdamW([p for p in model.parameters() if p.requires_grad],lr=2e-4,weight_decay=1e-5);started=time.perf_counter()
        count=steps if kind=='regression' else int(steps*1.5)
        for step in range(count):
            ids=torch.cat([torch.randint(len(rows),(16,),device=device),rare[torch.randint(len(rare),(8,),device=device)]])
            a=truth[ids]
            if kind=='regression':end,_,_=model(h[ids],state[ids],mask[ids]);flow_loss=0
            else:
                noise=torch.randn_like(a);t=torch.rand(len(ids),device=device)*.98+.01;xt=(1-t[:,None,None])*noise+t[:,None,None]*a
                velocity,_,_=model(h[ids],state[ids],mask[ids],xt,t);end=xt+(1-t[:,None,None])*velocity;flow_loss=F.mse_loss(velocity,a-noise)
            error=(end-a).abs();motion=(a-neutral).abs()>.03
            balanced=(error*motion).sum((0,1))/motion.sum((0,1)).clamp_min(1)
            loss=flow_loss+balanced.mean()+2*error[:,:,axis].mean()+.2*error.mean()+.2*((end[:,1:]-end[:,:-1])-(a[:,1:]-a[:,:-1])).abs().mean()
            opt.zero_grad();loss.backward();torch.nn.utils.clip_grad_norm_([p for p in model.parameters() if p.requires_grad],1.);opt.step()
        model.eval()
        with torch.inference_mode():pred=model.sample(h[rare],state[rare],mask[rare])[0];peak=(pred[:,:,axis].clamp(-1,1)+1)/2*24-24
        frozen=all(torch.equal(v,model.state_dict()[k]) for k,v in original.items() if not k.startswith(('decoder.','action.','noisy.','flow_time.')));assert frozen
        saved['state_dict']={k:v.cpu() for k,v in model.state_dict().items()};torch.save(saved,output/f'{kind}.pt')
        entry={'steps':count,'seconds':time.perf_counter()-started,'frozen_semantic_and_categorical_weights_unchanged':frozen,'base_sha256':run['models'][kind]['checkpoint_sha256'],'train_lean_peak':float(peak.min())}
        report['models'][kind]=entry;run['models'][kind]['checkpoint_sha256']=sha(output/f'{kind}.pt');run['models'][kind]['motion_refinement']=entry
        # Earlier fit metrics describe the base; the new full split audit is computed separately.
        run['models'][kind]['base_training_set_metrics']=run['models'][kind].pop('training_set_metrics')
        print({'kind':kind,**entry},flush=True)
    run['motion_refinement']=report;write(output/'run.json',run);write(output/'motion-fit.json',report)


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--base',default='experiments/vtuber-v3');p.add_argument('--output',required=True);p.add_argument('--dataset',default='datasets/vtuber-v3');p.add_argument('--steps',type=int,default=1000);a=p.parse_args();main(ROOT/a.base,ROOT/a.output,ROOT/a.dataset,a.steps)
