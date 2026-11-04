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
        self.last_timing={};self.body_planner=None;self.bounded_context=False

    def install_body(self,folder,spec):
        from body_intent_runtime import ContextBodyPlanner
        self.body_planner=ContextBodyPlanner(folder,spec,self.encoder,self.device)
        self.bounded_context=True

    @lru_cache(maxsize=96)
    def semantic(self,text,context):
        truncated=False
        if getattr(self,'bounded_context',False):
            from body_intent_runtime import bounded_context
            context,truncated=bounded_context(self.encoder.tokenizer,text,context,'legacy_json')
        h,info=self.encoder.encode(text,context);return h,{**info,'context_truncated':truncated}

    def close(self):
        # The method LRU also holds its instance. Clear it before a run reload
        # so an old 4B backbone cannot survive through cached hidden states.
        if getattr(self,'body_planner',None):self.body_planner.close();self.body_planner=None
        self.semantic.cache_clear();self.model=None;self.encoder=None

    @torch.inference_mode()
    def plan(self,text,context,state=None):
        begin=time.perf_counter();h,info=self.semantic(text,context)
        x=representation(h,self.mode)[None].to(self.device);mask=torch.zeros(x.shape[:2],dtype=torch.bool,device=self.device)
        output=self.model(x,mask,torch.tensor([state_vector(state)],device=self.device))
        if self.device=='cuda':torch.cuda.synchronize()
        self.last_timing={'total_ms':(time.perf_counter()-begin)*1000,'tokens':info['tokens']}
        plan=decode({k:v[0] for k,v in output.items()},self.thresholds)
        self.last_timing['context_truncated']=info.get('context_truncated',False)
        if getattr(self,'body_planner',None):
            body=self.body_planner.plan(text,context,state)
            plan.update(body=body['body'],body_strength=body['body_strength'])
            plan['confidence']['body']=body['confidence']
            self.last_timing.update(body=self.body_planner.last_timing,total_ms=(time.perf_counter()-begin)*1000)
            self.last_timing['context_truncated']|=self.body_planner.last_timing['context_truncated']
        return plan
