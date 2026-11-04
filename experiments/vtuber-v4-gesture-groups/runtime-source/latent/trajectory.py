import math
import numpy as np
from common import CHANNELS, PROFILE, HORIZON, HZ, RIGHT, LEFT


def compile_trajectory(values, right, left, provenance, profile=None, expressions=None, appearance=None, native='none'):
    profile=profile or PROFILE
    if native!='none':
        if native not in profile.get('native_motions',[]):raise ValueError('未知原始动画')
        duration=profile['native_motion_duration_ms'][native]
        events=[{'at_ms':0,'method':'parameters.release','params':{}},{'at_ms':0,'method':'expressions.clear','params':{}},
                {'at_ms':0,'method':'motions.play','params':{'name':native,'loop':False}},
                {'at_ms':duration-100,'method':'motions.stop','params':{}}]
        return {'method':'trajectory.play','params':{'duration_ms':duration,'events':events,'provenance':provenance}}, {'native_motion':native,'generated_track_suspended':True,'gesture_accepted':0,'expression_events':0}
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
        thresholds=profile.get('expression_activation_thresholds',{})
        flags=flags>np.array([thresholds.get(name,thresholds.get('default',.5)) for name in names])
        exclusive=[names.index(name) for name in (profile or PROFILE).get('exclusive_eye_expressions',[]) if name in names]
        for frame in range(HORIZON):
            enabled=[index for index in exclusive if flags[frame,index]]
            if len(enabled)>1:
                keep=max(enabled,key=lambda index:float(expressions[frame][index]));flags[frame,enabled]=False;flags[frame,keep]=True
                expression_stats['exclusive_eye_conflicts_resolved']+=1
        for frame in range(HORIZON):
            for first,second in profile.get('expression_exclusions',[]):
                a,b=names.index(first),names.index(second)
                if flags[frame,a] and flags[frame,b]:flags[frame,b]=False
        for j,name in enumerate(names):
            current=False;last=-600.;i=0
            while i<HORIZON:
                label=bool(flags[i,j]);end=i+1
                while end<HORIZON and bool(flags[end,j])==label:end+=1
                if label!=current:
                    at=i*1000/HZ
                    if end-i>=2 and at-last>=300:
                        accepted.append({'at_ms':at,'method':'expressions.set','params':{'name':name,'enabled':label,'strength':profile.get('expression_strengths',{}).get(name,1),'fade_ms':180}})
                        expression_stats['expression_events']+=1;current=label;last=at
                    else:expression_stats['expression_flickers_suppressed']+=1
                i=end
            if current:
                accepted.append({'at_ms':HORIZON*1000/HZ,'method':'expressions.set','params':{'name':name,'enabled':False,'fade_ms':180}})
                expression_stats['expression_events']+=1;expression_stats['expression_end_cleanup']+=1
    if appearance is not None:
        poses=profile.get('appearance_poses',[])
        if len(appearance)!=HORIZON or any(i not in range(len(poses)) for i in appearance):raise ValueError('体型轨迹不合法')
        current=0;last=-500
        for i,value in enumerate(appearance):
            if value!=current and i*100-last>=300 and i+1<HORIZON and appearance[i+1]==value:
                accepted.append({'at_ms':i*100,'method':'appearance.set','params':{'body':poses[value]}});current=value;last=i*100
        if current:accepted.append({'at_ms':HORIZON*100,'method':'appearance.set','params':{'body':'default'}})
    events+=accepted; events.sort(key=lambda e:e['at_ms'])
    duration=max(HORIZON*1000/HZ,max((e['at_ms']+1300 for e in accepted),default=0))
    if duration>8000: raise ValueError("手势退出超出 8 秒预算")
    return {'method':'trajectory.play','params':{'duration_ms':duration,'events':events,'provenance':provenance}}, {'gesture_candidates':candidates,'gesture_accepted':sum(e['method']=='gesture.set' for e in accepted),'gesture_suppressed':suppressed,**expression_stats}
