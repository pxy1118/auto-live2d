"""Fit only appearance classifiers on the sealed TRAIN split; preserve all other learned behavior."""
import argparse,copy,shutil,time
from pathlib import Path
import numpy as np
import torch
import torch.nn.functional as F
from common import ROOT,read,write,sha
from data import prepare,profile_for
from networks import ActionExpert


def main(base,output,dataset,steps):
    if output.exists():raise ValueError('Output already exists')
    torch.set_num_threads(4);torch.manual_seed(41)
    rows,manifest,data=prepare(dataset,'train');profile=profile_for(dataset)
    cache=torch.load(dataset/'features-train.pt',weights_only=True)
    assert cache['dataset_sha256']==manifest['sha256'] and cache['sample_ids']==[r['id'] for r in rows]
    device='cuda' if torch.cuda.is_available() else 'cpu';h=cache['features'].to(device);mask=cache['mask'].to(device);state=torch.from_numpy(data['state']).to(device);truth=torch.from_numpy(data['appearance']).to(device)
    groups=[torch.where(truth.max(-1).values==i)[0] for i in range(3)];assert all(len(g) for g in groups)
    output.mkdir(parents=True);run=read(base/'run.json');run.setdefault('appearance_class_weights',[1.,1.,1.]);write(output/'profile.json',profile);shutil.copy2(base/'dataset.json',output/'dataset.json');(output/'source').mkdir()
    for p in (ROOT/'latent').iterdir():
        if p.is_file() and p.suffix in ['.py','.json','.toml','.lock']:shutil.copy2(p,output/'source'/p.name)
    report={'selection':'train only','split_ids_sha256':manifest['selection']['ids_sha256'],'base':str(base.relative_to(ROOT)),'models':{}}
    for kind in ['regression','flow']:
        saved=torch.load(base/f'{kind}.pt',weights_only=True);model=ActionExpert(kind,saved['width'],saved['layers'],saved['action_dim'],saved['expression_dim'],saved['appearance_dim'],saved['native_dim']).to(device);model.load_state_dict(saved['state_dict']);model.eval()
        original={k:v.detach().clone() for k,v in model.state_dict().items()};model.requires_grad_(False);model.appearance.requires_grad_(True)
        with torch.no_grad():
            memory=torch.cat([model.semantic(h),model.state(state)[:,None]],1);valid=torch.cat([~mask,torch.ones(len(rows),1,dtype=torch.bool,device=device)],1).float();pooled=(memory*valid[:,:,None]).sum(1)/valid.sum(1,keepdim=True)
            inputs=torch.cat([model.query[None].expand(len(rows),-1,-1),pooled[:,None].expand(-1,64,-1)],-1).detach()
        opt=torch.optim.AdamW(model.appearance.parameters(),lr=.003,weight_decay=0.);started=time.perf_counter();best=None
        for step in range(steps):
            ids=torch.cat([g[torch.randint(len(g),(16 if i==0 else 4,),device=device)] for i,g in enumerate(groups)])
            logits=model.appearance(inputs[ids]);loss=F.cross_entropy(logits.transpose(1,2),truth[ids]);opt.zero_grad();loss.backward();opt.step()
            if (step+1)%200==0 or step+1==steps:
                with torch.no_grad():
                    pred=model.appearance(inputs).argmax(-1);positive=truth>0;recall=float((pred[positive]==truth[positive]).float().mean());fp=int(((pred>0)&(~positive)).sum());correct=int((pred==truth).sum())
                if best is None or correct>best[0]:best=(correct,copy.deepcopy(model.appearance.state_dict()))
                print({'kind':kind,'step':step+1,'train_nondefault_recall':recall,'train_false_positive_frames':fp},flush=True)
                if recall==1 and fp==0:break
        model.appearance.load_state_dict(best[1]);unchanged=all(torch.equal(v,model.state_dict()[k]) for k,v in original.items() if not k.startswith('appearance.'));assert unchanged
        saved['state_dict']={k:v.cpu() for k,v in model.state_dict().items()};torch.save(saved,output/f'{kind}.pt')
        restored=ActionExpert(kind,saved['width'],saved['layers'],saved['action_dim'],saved['expression_dim'],saved['appearance_dim'],saved['native_dim']);restored.load_state_dict(torch.load(output/f'{kind}.pt',weights_only=True)['state_dict'])
        assert all(torch.equal(v.cpu(),restored.state_dict()[k]) for k,v in model.state_dict().items())
        info=run['models'][kind];report['models'][kind]={'base_sha256':info['checkpoint_sha256'],'steps':step+1,'seconds':time.perf_counter()-started,'unchanged_nonappearance_weights':unchanged,'correct_training_frames':best[0],'total_training_frames':int(truth.numel())}
        info['checkpoint_sha256']=sha(output/f'{kind}.pt');info['appearance_refinement']=report['models'][kind]
    run['appearance_refinement']=report;write(output/'run.json',run);write(output/'appearance-fit.json',report)


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--base',default='experiments/vtuber-v3');p.add_argument('--output',required=True);p.add_argument('--dataset',default='datasets/vtuber-v3');p.add_argument('--steps',type=int,default=4000);a=p.parse_args();main(ROOT/a.base,ROOT/a.output,ROOT/a.dataset,a.steps)
