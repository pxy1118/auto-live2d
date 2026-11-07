"""One event: none, a coordinated gesture, or a standalone body beat."""
import torch
from torch import nn
from emotion_config import AFFECT_DIM
from motion_history import STATE_DIM

SCHEMA='vtuber.v6.event.v2'
HOLD_MIN_MS=400.;HOLD_SPAN_MS=3600.;ONSET_MIN_MS=40.;ONSET_SPAN_MS=760.

class EventExpert(nn.Module):
    def __init__(self,classes,width=192,dropout=.1):
        super().__init__();self.classes=classes;self.width=width
        self.semantic=nn.Sequential(nn.Linear(1024,width),nn.GELU(),nn.Dropout(dropout))
        self.affect=nn.Linear(AFFECT_DIM,width);self.history=nn.Linear(STATE_DIM,width)
        self.shared=nn.Sequential(nn.Linear(width*3,width),nn.GELU(),nn.Dropout(dropout/2))
        self.action=nn.Linear(width,classes);self.variant=nn.Linear(width,3);self.values=nn.Linear(width,3)
    def forward(self,semantic,affect,history):
        if semantic.ndim!=2 or semantic.shape[1]!=1024 or affect.shape!=(len(semantic),AFFECT_DIM) or history.shape!=(len(semantic),STATE_DIM):raise ValueError('动作头输入形状不合法')
        if not all(torch.isfinite(value).all() for value in (semantic,affect,history)):raise ValueError('动作头输入含非有限数值')
        h=self.shared(torch.cat([self.semantic(semantic),self.affect(affect),self.history(history)],-1))
        return {'action':self.action(h),'variant':self.variant(h),'values':self.values(h).sigmoid()}

def project_target(target):
    gesture=target.get('arm','none');body=target.get('body','none');name=gesture if gesture!='none' else body;part='arm' if gesture!='none' else 'body'
    return {'id':name,'variant':int(target.get(part+'_variant',0)),
            'strength':float(target.get('action_strength',1.)) if gesture!='none' else float(target.get('body_strength',0.)),
            'hold_ms':float(target.get(part+'_hold_ms',1400)),'onset_ms':float(target.get('onset_ms',180))}

def values_target(target):
    clip=lambda value:max(0.,min(1.,float(value)))
    return [clip(target['strength']),clip((target['hold_ms']-HOLD_MIN_MS)/HOLD_SPAN_MS),clip((target['onset_ms']-ONSET_MIN_MS)/ONSET_SPAN_MS)]

def decode(output,action_ids,catalog_by_id,threshold=0.):
    probability=output['action'].softmax(-1);index=int(probability.argmax());confidence=float(probability[index])
    if index and confidence<threshold:index=0
    entry=catalog_by_id[action_ids[index]];values=output['values'].detach().cpu().tolist()
    return {'action':{'id':entry['id'],'variant':int(output['variant'].argmax())%entry['variants'],
                      'strength':round(max(entry['intensity'][0],min(entry['intensity'][1],values[0])),4),
                      'hold_ms':round(HOLD_MIN_MS+values[1]*HOLD_SPAN_MS,1),'onset_ms':round(ONSET_MIN_MS+values[2]*ONSET_SPAN_MS,1)},
            'confidence':{'action':round(confidence,6)}}

def save_event(path,model,metadata):
    torch.save({'schema':SCHEMA,'state_dict':model.state_dict(),'classes':model.classes,'width':model.width,'history_dim':STATE_DIM,**metadata},path)

def load_event(path,device='cpu'):
    saved=torch.load(path,map_location=device,weights_only=True)
    if saved.get('schema')!=SCHEMA or saved.get('history_dim')!=STATE_DIM:raise ValueError('事件检查点契约不匹配')
    model=EventExpert(saved['classes'],saved['width']);model.load_state_dict(saved['state_dict'])
    return model.to(device).eval(),saved
