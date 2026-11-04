"""Optional frozen generalization planner; legacy live runs do not instantiate it."""
import json
import time
from functools import lru_cache
from pathlib import Path
import torch
from common import ROOT,sha
from planner_contract import state_vector
from performance_planner import decode
from semantic_tokens import FrozenTokenEncoder,TokenPerformancePlanner,representation

class GeneralizationPlanner:
    def __init__(self,experiment,device='cuda'):
        self.folder=Path(experiment).resolve();self.device=device
        if not self.folder.is_relative_to(ROOT/'experiments'):raise ValueError('Research experiment must stay inside experiments')
        selected=json.loads((self.folder/'selected.json').read_text());self.metadata=json.loads((self.folder/'selected-metadata.json').read_text())
        checkpoint=self.folder/selected['checkpoint']
        if sha(checkpoint)!=selected['checkpoint_sha256']:raise ValueError('Selected planner fingerprint mismatch')
        self.checkpoint_sha256=selected['checkpoint_sha256']
        source=ROOT/selected['encoder_source']
        if sha(source)!=self.metadata['encoder_source_sha256']:raise ValueError('Planner encoder source mismatch')
        saved=torch.load(checkpoint,map_location='cpu',weights_only=True)
        self.mode=saved['representation'];self.encoder=FrozenTokenEncoder(source,device)
        self.model=TokenPerformancePlanner(saved['input_dim'],saved['width']).to(device).eval();self.model.load_state_dict(saved['state_dict'])
        self.thresholds=self.metadata['execution_thresholds']
        self.last_timing={}

    @lru_cache(maxsize=96)
    def semantic(self,text,context):
        h,info=self.encoder.encode(text,context);return h,info

    def close(self):
        # The method LRU also holds its instance. Clear it before a run reload
        # so an old 4B backbone cannot survive through cached hidden states.
        self.semantic.cache_clear();self.model=None;self.encoder=None

    @torch.inference_mode()
    def plan(self,text,context,state=None):
        begin=time.perf_counter();h,info=self.semantic(text,context)
        x=representation(h,self.mode)[None].to(self.device);mask=torch.zeros(x.shape[:2],dtype=torch.bool,device=self.device)
        output=self.model(x,mask,torch.tensor([state_vector(state)],device=self.device))
        if self.device=='cuda':torch.cuda.synchronize()
        self.last_timing={'total_ms':(time.perf_counter()-begin)*1000,'tokens':info['tokens']}
        return decode({k:v[0] for k,v in output.items()},self.thresholds)
