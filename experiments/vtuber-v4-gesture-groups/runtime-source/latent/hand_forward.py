"""Differentiable surrogate of actual Cubism palm geometry, used only during training."""
import torch
from torch import nn
class HandForward(nn.Module):
    def __init__(self):
        super().__init__();self.net=nn.Sequential(nn.Linear(4,64),nn.Tanh(),nn.Linear(64,64),nn.Tanh(),nn.Linear(64,1))
    def forward(self,x):return self.net(x).squeeze(-1)
