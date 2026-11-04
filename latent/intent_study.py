"""Body-only decision probes and set-aware metrics, separate from production runtime."""
import math
import torch
from torch.nn import functional as F
from planner_contract import BODIES

NECESSITY=['forbidden','optional','required']

class BodyProbe(torch.nn.Module):
    def __init__(self,width=128):
        super().__init__();self.kind=torch.nn.Linear(width,len(BODIES));self.strength=torch.nn.Linear(width,1)
        self.necessity=torch.nn.Sequential(torch.nn.Linear(width,64),torch.nn.GELU(),torch.nn.Linear(64,3))
    def initialize(self,base):
        self.kind.load_state_dict({k:base['heads.body.'+k] for k in ['weight','bias']})
        self.strength.load_state_dict({k:base['regression.'+k][0:1] for k in ['weight','bias']})
    def forward(self,body_h,pooled_h):
        return dict(logits=self.kind(body_h),strength=self.strength(pooled_h).sigmoid()[:,0],necessity=self.necessity(body_h))

def labels(rows):
    aa=[r['body_annotation'] for r in rows]
    return dict(preferred=torch.tensor([BODIES.index(a['preferred']) for a in aa]),
                acceptable=torch.tensor([[b in a['acceptable'] for b in BODIES] for a in aa]),
                necessity=torch.tensor([NECESSITY.index(a['necessity']) for a in aa]),
                interval=torch.tensor([a['active_strength_interval'] for a in aa]))

def set_loss(logits,acceptable):
    """Probability mass of all genuinely acceptable actions, not latent true labels."""
    if (~acceptable.any(-1)).any():raise ValueError('Empty acceptable set')
    return -logits.log_softmax(-1).masked_fill(~acceptable,-torch.inf).logsumexp(-1).mean()

def type_strength_loss(output,target,method):
    if method=='preferred':categorical=F.cross_entropy(output['logits'],target['preferred'])
    elif method=='acceptable':categorical=set_loss(output['logits'],target['acceptable'])+.25*F.cross_entropy(output['logits'],target['preferred'])
    else:raise ValueError('Unknown objective')
    active=target['necessity']!=0;lo,hi=target['interval'].unbind(-1);value=output['strength']
    if method=='preferred':error=(value-(lo+hi)/2).square()
    else:error=(lo-value).clamp_min(0).square()+(value-hi).clamp_min(0).square()
    conditional=error[active].mean() if active.any() else value.sum()*0
    return categorical+4*conditional

def decide(logits,strength,active_threshold=0.,necessity=None,temperature=1.,forbidden_threshold=.7,required_threshold=.7):
    prob=logits.softmax(-1);confidence,pred=prob.max(-1)
    pred=torch.where((pred>0)&(confidence<active_threshold),0,pred)
    if necessity is not None:
        intent=(necessity/temperature).softmax(-1)
        required=intent[:,2]>=required_threshold
        best_active=logits[:,1:].argmax(-1)+1
        pred=torch.where(required,best_active,pred)
        pred=torch.where(intent[:,0]>=forbidden_threshold,0,pred)
    amplitude=torch.where(pred>0,strength,0.)
    return pred,amplitude

def metrics(rows,pred,amplitude):
    y=labels(rows);pred=torch.as_tensor(pred);amplitude=torch.as_tensor(amplitude)
    accepted=y['acceptable'].gather(1,pred[:,None])[:,0];active=pred>0
    forbidden=y['necessity']==0;optional=y['necessity']==1;required=y['necessity']==2
    lo,hi=y['interval'].unbind(-1);out_of_range=(amplitude<lo-1e-6)|(amplitude>hi+1e-6)
    def rate(v,subset):return float(v[subset].float().mean()) if subset.any() else None
    return dict(samples=len(rows),families=len({r['family'] for r in rows}),
        forbidden_samples=int(forbidden.sum()),required_samples=int(required.sum()),optional_samples=int(optional.sum()),
        forbidden_activation=rate(active,forbidden),required_success=rate(accepted,required),
        required_any_activity=rate(active,required),acceptable_rate=float(accepted.float().mean()),
        preferred_match=float((pred==y['preferred']).float().mean()),
        optional_activity=rate(active,optional),optional_unacceptable=rate(~accepted,optional),
        active_amplitude_outside=rate(out_of_range,active),
        accepted_active_amplitude_outside=rate(out_of_range,active&accepted))

def calibration_objective(m):
    return .5*m['required_success']+.5*(1-m['forbidden_activation'])-.1*m['optional_unacceptable']

def necessity_metrics(logits,rows,temperature=1.):
    target=labels(rows)['necessity'];p=(logits/temperature).softmax(-1)
    return dict(nll=float(F.cross_entropy(logits/temperature,target)),
                brier=float((p-F.one_hot(target,3)).square().sum(-1).mean()),
                accuracy=float((p.argmax(-1)==target).float().mean()))
