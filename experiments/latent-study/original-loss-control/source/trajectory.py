import math
import numpy as np
from common import CHANNELS, HORIZON, HZ, RIGHT, LEFT


def compile_trajectory(values, right, left, provenance):
    array=np.asarray(values,dtype=np.float64)
    if array.shape!=(HORIZON,12) or not np.isfinite(array).all(): raise ValueError("轨迹必须为有限的 64×12 张量")
    lo=np.array([c['min'] for c in CHANNELS]); hi=np.array([c['max'] for c in CHANNELS])
    if ((array<lo-1e-6)|(array>hi+1e-6)).any(): raise ValueError("执行轨迹超出角色范围")
    if len(right)!=HORIZON or len(left)!=HORIZON or any(x not in range(3) for x in right) or any(x not in range(2) for x in left): raise ValueError("手势轨迹不合法")
    events=[{'at_ms':i*1000/HZ,'method':'parameters.set','params':{'values':{c['id']:round(float(array[i,j]),5) for j,c in enumerate(CHANNELS)},'duration_ms':1000/HZ,'stage':'pre'}} for i in range(HORIZON)]
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
    events+=accepted; events.sort(key=lambda e:e['at_ms'])
    duration=max(HORIZON*1000/HZ,max((e['at_ms']+1300 for e in accepted),default=0))
    if duration>8000: raise ValueError("手势退出超出 8 秒预算")
    return {'method':'trajectory.play','params':{'duration_ms':duration,'events':events,'provenance':provenance}}, {'gesture_candidates':candidates,'gesture_accepted':len(accepted),'gesture_suppressed':suppressed}
