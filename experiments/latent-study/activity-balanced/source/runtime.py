from pathlib import Path
import time
import numpy as np
import torch
from common import ROOT, CHANNELS, PROFILE, ASSET_HASH, SOURCE, RIGHT, LEFT, read, sha
from encoder import SemanticEncoder
from networks import ActionExpert
from trajectory import compile_trajectory


class LatentPolicy:
    def __init__(self, experiment=None, device='cuda'):
        torch.set_num_threads(4)
        self.folder=Path(experiment) if experiment else ROOT/read(ROOT/'latent/default-run.json')['path']
        self.report=read(self.folder/'run.json'); self.device=device
        if self.report['profile_sha256']!=PROFILE['sha256'] or self.report['encoder']['revision']!=SOURCE['revision']: raise ValueError("模型来源不匹配")
        self.encoder=SemanticEncoder(device); self.models={}
        for kind in ['regression','flow']:
            file=self.folder/self.report['models'][kind]['checkpoint']
            if sha(file)!=self.report['models'][kind]['checkpoint_sha256']: raise ValueError("检查点指纹不匹配")
            saved=torch.load(file,map_location='cpu',weights_only=True)
            model=ActionExpert(kind,saved['width'],saved['layers']); model.load_state_dict(saved['state_dict']); self.models[kind]=model.to(device).eval()
        self.lo=torch.tensor([c['min'] for c in CHANNELS],device=device); self.hi=torch.tensor([c['max'] for c in CHANNELS],device=device)
        u0=torch.tensor([c['neutral'] for c in CHANNELS],device=device); normalized=(u0-self.lo)/(self.hi-self.lo)*2-1
        self.state=torch.cat([normalized,torch.tensor([1,0,0,1,0],device=device)])[None]

    def info(self):
        return {'ready':True,'encoder':SOURCE['repo_id'],'encoder_revision':SOURCE['revision'],'profile_sha256':PROFILE['sha256'],'asset_hash':ASSET_HASH,
                'experiment':str(self.folder.relative_to(ROOT)) if self.folder.is_relative_to(ROOT) else str(self.folder),'models':list(self.models),'supervision':self.report['supervision'],
                'held_out_evaluation':False,'neutral_start_only':True,'output_shape':[64,12],'sample_hz':10}

    def predict(self,text,context='',style='natural',kind='regression',seed=41):
        if kind not in self.models: raise ValueError("请选择 regression 或 flow")
        if not isinstance(seed,int) or isinstance(seed,bool) or not 0<=seed<2**31: raise ValueError("seed 不合法")
        begin=time.perf_counter(); features,mask,timing=self.encoder.encode(text,context,style)
        if self.device=='cuda': torch.cuda.synchronize()
        head_start=time.perf_counter()
        with torch.inference_mode(): raw,rr,ll=self.models[kind].sample(features[None],self.state,mask[None],steps=8,seed=seed)
        if not torch.isfinite(raw).all(): raise ValueError("预测出现非有限数值")
        if self.device=='cuda': torch.cuda.synchronize()
        timing['head_ms']=(time.perf_counter()-head_start)*1000
        excess=(raw.abs()-1).clamp_min(0)
        clipped=raw.clamp(-1,1); physical=((clipped[0]+1)/2*(self.hi-self.lo)+self.lo).cpu().numpy().astype(np.float64)
        # Only tiny serialization rounding follows the explicitly reported clipping step.
        physical=np.round(physical,5)
        right=rr[0].argmax(-1).cpu().tolist(); left=ll[0].argmax(-1).cpu().tolist()
        provenance={'source':'latent_policy','kind':kind,'checkpoint_sha256':self.report['models'][kind]['checkpoint_sha256'],
                    'dataset_sha256':self.report['dataset_sha256'],'supervision':self.report['supervision'],'seed':seed}
        command,post=compile_trajectory(physical,right,left,provenance)
        timing['total_compute_ms']=(time.perf_counter()-begin)*1000
        return {'profile_sha256':PROFILE['sha256'],'asset_hash':ASSET_HASH,'kind':kind,'experimental_only':True,'neutral_start_only':True,'timing':timing,
                'values':physical.tolist(),'right':right,'left':left,'command':command,
                'constraints':{'raw_out_of_range_fraction':float((excess>0).float().mean()),'raw_normalized_excess_mean':float(excess.mean()),'raw_normalized_excess_max':float(excess.max()),**post},
                'provenance':provenance}
