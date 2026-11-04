"""Body-only deployment of a frozen research head, sharing the 4B encoder."""
import json
import time
from functools import lru_cache
from pathlib import Path
import torch
from common import ROOT,sha
from semantic_tokens import TokenPerformancePlanner
from intent_study import BodyProbe,decide
from planner_contract import state_vector,BODIES
from context_prompts import prompt

class ContextBodyAdapter(torch.nn.Module):
    """Checkpoint-compatible copy; production does not import a training runner."""
    def __init__(self,input_dim,width=128):
        super().__init__();self.shared=TokenPerformancePlanner(input_dim,width);self.head=BodyProbe(width)
    def forward(self,tokens,mask,state):
        memory=self.shared.projection(tokens);query=self.shared.query[None]+self.shared.history(state)[:,None]
        attended,_=self.shared.attention(query,memory,memory,key_padding_mask=mask,need_weights=False)
        h=self.shared.mix(query+attended)
        return self.head(h[:,1],h.mean(1))

def bounded_context(tokenizer,text,context,mode,limit=512):
    """Keep the whole clause, facts prefix and latest context; report compression.

    Cuts are on Unicode character boundaries. The research inputs remain strict;
    this explicit policy is for long-running production sessions only.
    """
    def fits(value):return len(tokenizer(prompt(tokenizer,text,value,mode),add_special_tokens=False)['input_ids'])<=limit
    if fits(context):return context,False
    if not fits(''):raise ValueError('当前分句超过语义词元预算，请缩短分句')
    marker='\n[较早语境已省略]\n';prefix=context.split('\n',1)[0][:120]
    while prefix and not fits(prefix+marker):prefix=prefix[:-8]
    if not fits(prefix+marker):prefix='';marker=''
    lo,hi=0,len(context)
    while lo<hi:
        mid=(lo+hi+1)//2;candidate=prefix+marker+(context[-mid:] if mid else '')
        if fits(candidate):lo=mid
        else:hi=mid-1
    selected=prefix+marker+(context[-lo:] if lo else '')
    # Tokenization is not perfectly monotonic in character length.
    while not fits(selected) and lo:
        lo-=1;selected=prefix+marker+context[-lo:] if lo else prefix+marker
    if not fits(selected):selected=''
    return selected,True

class ContextBodyPlanner:
    def __init__(self,folder,spec,encoder,device='cuda'):
        self.encoder=encoder;self.device=device;self.mode=spec['mode'];self.spec=spec
        if self.mode!='task_context_first':raise ValueError('Unsupported deployed body prompt')
        if sha(ROOT/'latent/context_prompts.py')!=spec['prompt_sha256']:raise ValueError('身体语义提示指纹不匹配')
        checkpoint=Path(folder)/spec['checkpoint']
        if sha(checkpoint)!=spec['sha256']:raise ValueError('身体选择器权重指纹不匹配')
        saved=torch.load(checkpoint,map_location='cpu',weights_only=True)
        if saved['mode']!=self.mode or saved['dataset_sha256']!=spec['dataset_sha256'] or saved['protocol_sha256']!=spec['protocol_sha256']:
            raise ValueError('身体选择器训练契约不匹配')
        self.config=saved['config'];self.model=ContextBodyAdapter(spec['input_dim'],spec['width']).to(device).eval()
        self.model.load_state_dict(saved['state_dict']);self.model.requires_grad_(False);self.last_timing={}

    @lru_cache(maxsize=32)
    def semantic(self,text,context):
        context,truncated=bounded_context(self.encoder.tokenizer,text,context,self.mode)
        formatted=prompt(self.encoder.tokenizer,text,context,self.mode)
        encoded=self.encoder.tokenizer(formatted,return_tensors='pt',add_special_tokens=False).to(self.device)
        begin=time.perf_counter()
        with torch.inference_mode():h=self.encoder.backbone(**encoded,use_cache=False,return_dict=True).last_hidden_state[0]
        if self.device=='cuda':torch.cuda.synchronize()
        return h.detach(),dict(tokens=len(h),context_truncated=truncated,context_chars_used=len(context),encoder_ms=(time.perf_counter()-begin)*1000)

    @torch.inference_mode()
    def plan(self,text,context,state=None):
        begin=time.perf_counter();h,info=self.semantic(text,context)
        tokens=h.float()[None];mask=torch.zeros(tokens.shape[:2],device=self.device,dtype=torch.bool)
        output=self.model(tokens,mask,torch.tensor([state_vector(state)],device=self.device))
        pred,strength=decide(output['logits'],output['strength'],necessity=output['necessity'],**self.config)
        confidence=float(output['logits'].softmax(-1)[0,int(pred[0])])
        self.last_timing={**info,'total_ms':(time.perf_counter()-begin)*1000}
        return dict(body=BODIES[int(pred[0])],body_strength=round(float(strength[0]),4),confidence=confidence)

    def close(self):
        self.semantic.cache_clear();self.model=None;self.encoder=None
