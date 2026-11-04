"""Shared, versioned contract for learned clause-level acting decisions."""
import math
ARMS=['none','wave','chest','grass','point','thanks','explain','refuse']
BODIES=['none','lean','sway','nod','tilt','turn','cajole']
EMOTIONS=['keep','neutral','happy','angry','shy','sad','surprised','confused']
FACES=['黑脸','流泪','脸红','加载','兔牙','流冷汗']
EYES=['normal','＞＜','圈圈眼','爱心眼','屑屑眼']
SCHEMA='performance.plan.v1'
STATE_DIM=44
REGRESSION=['body_strength',*FACES,'eye_strength','arm_hold','body_hold','face_hold','onset']
REGRESSION_SCALES=[1.]*8+[3000.,4000.,8000.,1000.]

def state_vector(state=None):
    s=state or {};result=[]
    def hot(value,choices):return [float(value==c) for c in choices]
    def bounded(value,lo=0.,hi=1.):
        if isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value):raise ValueError('表演历史必须为有限数值')
        return max(lo,min(hi,float(value)))
    result+=hot(s.get('emotion','neutral'),EMOTIONS[1:])
    face=s.get('face_state',[0.]*12)
    if not isinstance(face,list) or len(face)!=12:raise ValueError('face_state 需要 12 个值')
    result += [bounded(v) for v in face]
    result += hot(s.get('last_arm','none'),ARMS)+hot(s.get('last_body','none'),BODIES)
    result += hot(s.get('last_arm_variant'),[0,1,2])+hot(s.get('last_body_variant'),[0,1,2])
    result += [bounded(s.get('arm_age_ms',6000)/6000),bounded(s.get('body_age_ms',4000)/4000)]
    result += [float(bool(s.get('arm_active',False))),float(bool(s.get('body_active',False)))]
    assert len(result)==STATE_DIM
    return result

def target_values(plan):
    return [plan.get('body_strength',0.),*[plan.get('expressions',{}).get(k,0.) for k in FACES],plan.get('eye_strength',0.),
            (plan.get('arm_hold_ms',1400)-600)/2400,(plan.get('body_hold_ms',2200)-900)/3100,(plan.get('face_hold_ms',3500)-1600)/6400,(plan.get('onset_ms',180)-80)/720]
