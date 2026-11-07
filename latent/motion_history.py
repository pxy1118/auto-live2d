"""Versioned action history. No emotion categories or facial-state inputs."""
import json,math
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
CONTRACT=json.loads((ROOT/'contracts/motion-history.json').read_text(encoding='utf-8'))
ACTION_IDS=tuple(CONTRACT['actions']);PHASES=tuple(CONTRACT['phases']);STATE_DIM=CONTRACT['dim']

def state_vector(state=None):
    state=state or {}
    if not isinstance(state,dict) or set(state)-{'last_action','last_variant','age_ms','phase'}:raise ValueError('动作历史字段不合法')
    action=state.get('last_action','none');variant=state.get('last_variant');phase=state.get('phase','idle');age=state.get('age_ms',10000)
    if not isinstance(action,str) or phase not in PHASES or (variant is not None and (isinstance(variant,bool) or not isinstance(variant,int) or not 0<=variant<=2)):raise ValueError('动作历史类型不合法')
    if isinstance(age,bool) or not isinstance(age,(int,float)) or not math.isfinite(age) or age<0:raise ValueError('动作历史时间不合法')
    encoded=action if action in ACTION_IDS else '<untrained>'
    result=[float(encoded==name) for name in ACTION_IDS]+[float(variant==i) for i in range(3)]+[min(1.,age/CONTRACT['age_scale_ms'])]+[float(phase==name) for name in PHASES]
    assert len(result)==STATE_DIM
    return result

def authored_history(state):
    """Project authored physical histories without their emotion/face fields."""
    candidates=[]
    for part in ['arm','body']:
        name=state.get('last_'+part,'none')
        if name=='none':continue
        age=max(0.,float(state.get(part+'_age_ms',10000)));active=bool(state.get(part+'_active',False))
        candidates.append((0 if active and part=='arm' else 1 if active else 2,age,name,state.get('last_'+part+'_variant'),active))
    if not candidates:return {'last_action':'none','last_variant':None,'age_ms':10000,'phase':'idle'}
    _,age,name,variant,active=min(candidates,key=lambda row:(row[0],row[1]))
    return {'last_action':name,'last_variant':variant,'age_ms':age,'phase':'hold' if active else 'idle'}
