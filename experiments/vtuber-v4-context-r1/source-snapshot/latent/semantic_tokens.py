"""Isolated research encoders; legacy SemanticEncoder remains byte-for-byte unchanged."""
import json
import time
from pathlib import Path
import torch
from transformers import AutoTokenizer, Qwen3_5ForConditionalGeneration
from common import ROOT, feature_message, sha

class FrozenTokenEncoder:
    def __init__(self, source, device='cuda'):
        self.source_path=Path(source);self.source=json.loads(self.source_path.read_text(encoding='utf-8'))
        self.device=device
        path=ROOT/'models'/self.source['repo_id'].split('/')[-1]
        for item in self.source['weights']:
            if sha(path/item['file'])!=item['sha256']:raise ValueError('Research encoder weight hash mismatch')
        self.tokenizer=AutoTokenizer.from_pretrained(path,local_files_only=True)
        self.wrapper=Qwen3_5ForConditionalGeneration.from_pretrained(path,local_files_only=True,
            dtype=torch.bfloat16 if device=='cuda' else torch.float32,attn_implementation='sdpa')
        self.backbone=self.wrapper.model.language_model.to(device).eval();self.wrapper.requires_grad_(False)
        self.hidden_size=self.backbone.config.hidden_size

    def encode(self,text,context='',style='natural'):
        begin=time.perf_counter()
        content=json.dumps(feature_message(text,context,style),ensure_ascii=False)
        prompt=self.tokenizer.apply_chat_template([{'role':'user','content':content}],tokenize=False,
                                                  add_generation_prompt=True,enable_thinking=False)
        encoded=self.tokenizer(prompt,return_tensors='pt').to(self.device)
        if encoded.input_ids.shape[1]>512:raise ValueError('Research input exceeds 512 tokens; no silent truncation')
        if self.device=='cuda':torch.cuda.synchronize()
        with torch.inference_mode():h=self.backbone(**encoded,use_cache=False,return_dict=True).last_hidden_state[0]
        if self.device=='cuda':torch.cuda.synchronize()
        return h.detach(),{'tokens':h.shape[0],'encoder_ms':(time.perf_counter()-begin)*1000}

def representation(tokens,mode):
    if mode=='tail16_mean':return tokens[-16:].float().mean(0,keepdim=True)
    if mode=='full_attention':return tokens.float()
    raise ValueError('Unknown semantic representation')

class TokenPerformancePlanner(torch.nn.Module):
    """Same four task queries in both ablations; one pooled token or all tokens."""
    def __init__(self,input_dim,width=128):
        super().__init__()
        from planner_contract import ARMS,BODIES,EMOTIONS,EYES,STATE_DIM
        self.input_dim=input_dim;self.width=width
        self.projection=torch.nn.Sequential(torch.nn.LayerNorm(input_dim),torch.nn.Linear(input_dim,width),torch.nn.GELU())
        self.history=torch.nn.Sequential(torch.nn.Linear(STATE_DIM,width),torch.nn.GELU())
        self.query=torch.nn.Parameter(torch.randn(4,width)*.02)
        self.attention=torch.nn.MultiheadAttention(width,4,dropout=.05,batch_first=True)
        self.mix=torch.nn.Sequential(torch.nn.LayerNorm(width),torch.nn.Linear(width,width*2),torch.nn.GELU(),torch.nn.Dropout(.1),torch.nn.Linear(width*2,width))
        self.heads=torch.nn.ModuleDict({k:torch.nn.Linear(width,len(v)) for k,v in [('arm',ARMS),('body',BODIES),('emotion',EMOTIONS),('eye',EYES)]})
        self.arm_variant=torch.nn.Linear(width,3);self.body_variant=torch.nn.Linear(width,3);self.regression=torch.nn.Linear(width,12)

    def forward(self,tokens,mask,state):
        memory=self.projection(tokens)
        query=self.query[None]+self.history(state)[:,None]
        attended,_=self.attention(query,memory,memory,key_padding_mask=mask,need_weights=False)
        h=self.mix(query+attended);pooled=h.mean(1)
        return {**{k:self.heads[k](h[:,i]) for i,k in enumerate(['arm','body','emotion','eye'])},
                'arm_variant':self.arm_variant(pooled),'body_variant':self.body_variant(pooled),
                'values':self.regression(pooled).sigmoid()}

def pad_features(features,device):
    lengths=torch.tensor([len(x) for x in features],device=device)
    tokens=torch.nn.utils.rnn.pad_sequence(features,batch_first=True).to(device=device,dtype=torch.float32)
    return tokens,torch.arange(tokens.shape[1],device=device)[None]>=lengths[:,None]
