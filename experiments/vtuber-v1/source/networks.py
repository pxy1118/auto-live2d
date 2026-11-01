import math
import torch
from torch import nn
from common import HORIZON


class ActionExpert(nn.Module):
    def __init__(self, kind="regression", width=128, layers=2, action_dim=12):
        super().__init__(); self.kind=kind; self.width=width; self.layers=layers; self.action_dim=action_dim
        self.semantic=nn.Sequential(nn.Linear(1024,width),nn.LayerNorm(width))
        self.state=nn.Linear(action_dim+5,width)
        self.query=nn.Parameter(torch.randn(HORIZON,width)*.02)
        block=nn.TransformerDecoderLayer(width,4,width*4,dropout=.05,batch_first=True,norm_first=True)
        self.decoder=nn.TransformerDecoder(block,layers,norm=nn.LayerNorm(width))
        self.action=nn.Linear(width,action_dim)
        self.gesture=nn.Sequential(nn.Linear(width*2,width),nn.GELU(),nn.Linear(width,5))
        if kind=="flow":
            self.noisy=nn.Linear(action_dim,width)
            self.flow_time=nn.Sequential(nn.Linear(16,width),nn.SiLU(),nn.Linear(width,width))

    def forward(self, features, state, mask, noisy=None, time=None):
        memory=self.semantic(features)
        memory=torch.cat([memory,self.state(state)[:,None]],1)
        memory_mask=torch.cat([mask,torch.zeros(len(state),1,dtype=torch.bool,device=state.device)],1)
        query=self.query[None].expand(len(state),-1,-1)
        if self.kind=="flow":
            freq=torch.exp(torch.arange(8,device=state.device)*(-math.log(10000)/7))
            angle=time[:,None]*freq[None]*1000
            embedding=self.flow_time(torch.cat([angle.sin(),angle.cos()],-1))
            query=query+self.noisy(noisy)+embedding[:,None]
        hidden=self.decoder(query,memory,memory_key_padding_mask=memory_mask)
        actions=self.action(hidden)
        if self.kind=="regression": actions=actions.tanh()
        weights=(~memory_mask).float(); pooled=(memory*weights[:,:,None]).sum(1)/weights.sum(1,keepdim=True)
        aux=self.gesture(torch.cat([self.query[None].expand(len(state),-1,-1),pooled[:,None].expand(-1,HORIZON,-1)],-1))
        return actions,aux[:,:,:3],aux[:,:,3:]

    @torch.inference_mode()
    def sample(self, features, state, mask, steps=8, seed=41):
        if self.kind=="regression": return self(features,state,mask)
        generator=torch.Generator(device=state.device).manual_seed(seed)
        x=torch.randn(len(state),HORIZON,self.action_dim,device=state.device,generator=generator)
        for i in range(steps):
            t=torch.full((len(state),),(i+.0)/steps,device=state.device)
            velocity,right,left=self(features,state,mask,x,t)
            x=x+velocity/steps
        return x,right,left
