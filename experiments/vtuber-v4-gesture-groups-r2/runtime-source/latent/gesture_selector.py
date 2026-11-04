import torch
from torch import nn
LABELS=['none','wave','cheer','chest','grass','point','thanks','explain','refuse']
class GestureSelector(nn.Module):
    def __init__(self):
        super().__init__();self.register_buffer('mean',torch.zeros(1024));self.register_buffer('scale',torch.ones(1024));self.net=nn.Sequential(nn.Linear(1024,96),nn.GELU(),nn.Dropout(.1),nn.Linear(96,len(LABELS)))
    def forward(self,features,mask):
        weights=(~mask).float();pooled=(features*weights[:,:,None]).sum(1)/weights.sum(1,keepdim=True).clamp_min(1)
        return self.net((pooled-self.mean)/self.scale)
