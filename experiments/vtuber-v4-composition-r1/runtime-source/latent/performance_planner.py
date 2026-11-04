"""Small multi-head policy over frozen Qwen semantics and actual acting history."""
import torch
from torch import nn
from planner_contract import ARMS,BODIES,EMOTIONS,EYES,FACES,STATE_DIM,SCHEMA

class PerformancePlanner(nn.Module):
    def __init__(self,architecture='nonlinear'):
        super().__init__();self.architecture=architecture;self.register_buffer('mean',torch.zeros(1024));self.register_buffer('scale',torch.ones(1024))
        self.semantic=nn.Sequential(nn.Linear(1024,192),nn.GELU(),nn.Dropout(.1))
        self.history=nn.Sequential(nn.Linear(STATE_DIM,64),nn.GELU())
        self.shared=nn.Sequential(nn.Linear(256,160),nn.GELU(),nn.Dropout(.08))
        self.heads=nn.ModuleDict({k:nn.Linear(1024+STATE_DIM if architecture=='linear' and k not in ['arm_variant','body_variant'] else 160,n) for k,n in [('arm',len(ARMS)),('body',len(BODIES)),('emotion',len(EMOTIONS)),('eye',len(EYES)),('arm_variant',3),('body_variant',3)]})
        self.regression=nn.Linear(160,12)
        if architecture=='body_binary':self.body_binary=nn.Linear(160,len(BODIES)-1)
    def forward(self,semantic,state):
        h=self.shared(torch.cat([self.semantic((semantic-self.mean)/self.scale),self.history(state)],-1))
        return {**{k:head(torch.cat([(semantic-self.mean)/self.scale,state],-1) if self.architecture=='linear' and k not in ['arm_variant','body_variant'] else h) for k,head in self.heads.items()},'values':self.regression(h).sigmoid(),**({'body_binary_logits':self.body_binary(h)} if self.architecture=='body_binary' else {})}

def class_probabilities(output,key):
    if key=='body' and 'body_binary_logits' in output:
        p=output['body_binary_logits'].sigmoid();return torch.cat([1-p.amax(-1,keepdim=True),p],-1)
    return output[key].softmax(-1)

class EnsemblePerformancePlanner(nn.Module):
    def __init__(self,architectures,sources):
        super().__init__();self.sources=sources;self.components=nn.ModuleDict({k:PerformancePlanner(v) for k,v in architectures.items()})
    def forward(self,semantic,state):
        results={k:model(semantic,state) for k,model in self.components.items()}
        return {key:results[source][key] for key,source in self.sources.items()}

def load_planner(saved):
    model=EnsemblePerformancePlanner(saved['architectures'],saved['head_sources']) if saved.get('architecture')=='ensemble' else PerformancePlanner(saved.get('architecture','nonlinear'))
    model.load_state_dict(saved['state_dict']);return model

def decode(output,thresholds=None):
    thresholds=thresholds or {};selected={};confidence={}
    for key,choices in [('arm',ARMS),('body',BODIES),('emotion',EMOTIONS),('eye',EYES)]:
        p=class_probabilities(output,key);i=int(p.argmax());confidence[key]=float(p[i]);selected[key]=choices[i] if i==0 or confidence[key]>=thresholds.get(key,.65) else choices[0]
    v=output['values'].detach().cpu().tolist()
    return {'schema':SCHEMA,'arm':selected['arm'],'body':selected['body'],'emotion':selected['emotion'],'eye':selected['eye'],
            'arm_variant':int(output['arm_variant'].argmax()),'body_variant':int(output['body_variant'].argmax()),
            'body_strength':round(v[0],4),'expressions':{name:round(v[i+1],4) for i,name in enumerate(FACES)},'eye_strength':round(v[7],4),
            'arm_hold_ms':round(600+v[8]*2400),'body_hold_ms':round(900+v[9]*3100),'face_hold_ms':round(1600+v[10]*6400),'onset_ms':round(80+v[11]*720),
            'confidence':confidence}
