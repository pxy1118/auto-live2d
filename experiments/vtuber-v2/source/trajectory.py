import math
import numpy as np
from common import CHANNELS, PROFILE, HORIZON, HZ, RIGHT, LEFT


def compile_trajectory(values, right, left, provenance, profile=None, expressions=None):
    channels=(profile or PROFILE)['channels']
    array=np.asarray(values,dtype=np.float64)
    if array.shape!=(HORIZON,len(channels)) or not np.isfinite(array).all(): raise ValueError(f"轨迹必须为有限的 64×{len(channels)} 张量")
    lo=np.array([c['min'] for c in channels]); hi=np.array([c['max'] for c in channels])
    if ((array<lo-1e-6)|(array>hi+1e-6)).any(): raise ValueError("执行轨迹超出角色范围")
    if len(right)!=HORIZON or len(left)!=HORIZON or any(x not in range(3) for x in right) or any(x not in range(2) for x in left): raise ValueError("手势轨迹不合法")
    events=[{'at_ms':i*1000/HZ,'method':'parameters.set','params':{'values':{c['id']:round(float(array[i,j]),5) for j,c in enumerate(channels)},'duration_ms':1000/HZ,'stage':'pre'}} for i in range(HORIZON)]
    # This is transition scheduling, not an action-template lookup.
    accepted=[]; suppressed=0; candidates=0
    for side,labels,poses in [('right',right,RIGHT),('left',left,LEFT)]:
        current=0; last=-1300; i=0
        while i<HORIZON:
            label=int(labels[i]); end=i+1
            while end<HORIZON and int(labels[end])==label: end+=1
            if label!=current:
                candidates+=1; t=i*1000/HZ
                if end-i>=2 and t-last>=1300:
                    event={'at_ms':t,'method':'gesture.set','params':{'side':side,'pose':poses[label]}}
                    accepted.append(event); current=label; last=t
                else: suppressed+=1
            i=end
    expression_stats={'expression_events':0,'expression_flickers_suppressed':0,'exclusive_eye_conflicts_resolved':0,'expression_end_cleanup':0}
    names=(profile or PROFILE).get('expressions',[])
    if names:
        flags=np.asarray(expressions,dtype=float)
        if flags.shape!=(HORIZON,len(names)) or not np.isfinite(flags).all():raise ValueError('表情轨迹形状或数值不合法')
        flags=flags>.5
        exclusive=[names.index(name) for name in (profile or PROFILE).get('exclusive_eye_expressions',[]) if name in names]
        for frame in range(HORIZON):
            enabled=[index for index in exclusive if flags[frame,index]]
            if len(enabled)>1:
                keep=max(enabled,key=lambda index:float(expressions[frame][index]));flags[frame,enabled]=False;flags[frame,keep]=True
                expression_stats['exclusive_eye_conflicts_resolved']+=1
        for j,name in enumerate(names):
            current=False;last=-600.;i=0
            while i<HORIZON:
                label=bool(flags[i,j]);end=i+1
                while end<HORIZON and bool(flags[end,j])==label:end+=1
                if label!=current:
                    at=i*1000/HZ
                    if end-i>=2 and at-last>=300:
                        accepted.append({'at_ms':at,'method':'expressions.set','params':{'name':name,'enabled':label,'fade_ms':180}})
                        expression_stats['expression_events']+=1;current=label;last=at
                    else:expression_stats['expression_flickers_suppressed']+=1
                i=end
            if current:
                accepted.append({'at_ms':HORIZON*1000/HZ,'method':'expressions.set','params':{'name':name,'enabled':False,'fade_ms':180}})
                expression_stats['expression_events']+=1;expression_stats['expression_end_cleanup']+=1
    events+=accepted; events.sort(key=lambda e:e['at_ms'])
    duration=max(HORIZON*1000/HZ,max((e['at_ms']+1300 for e in accepted),default=0))
    if duration>8000: raise ValueError("手势退出超出 8 秒预算")
    return {'method':'trajectory.play','params':{'duration_ms':duration,'events':events,'provenance':provenance}}, {'gesture_candidates':candidates,'gesture_accepted':sum(e['method']=='gesture.set' for e in accepted),'gesture_suppressed':suppressed,**expression_stats}
