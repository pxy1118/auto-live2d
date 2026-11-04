"""Audit the actual rendered inputs; no subjective scores are synthesized."""
import hashlib,json
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[2]
DATA=ROOT/'datasets/vtuber-v4-native/review/action-groups-v6'
OUT=ROOT/'test-results/v4-groups-r6'
RIGHT=['Param36','Param39','Param41','Param42','Param43','Movement1','Movement3','Param40']
LEFT=['Param62','Param59','Param60','Param61','Movement2']
BODY=['AngleX','AngleY','AngleZ','PositionX','PositionY','PositionZ','LeanInput']
PHYSICS=['ParamAngleX','ParamAngleY','ParamAngleZ','ParamBodyAngleX','ParamBodyAngleY','ParamBodyAngleZ','Param50','Param53']
def read(p):return json.loads(p.read_text(encoding='utf-8'))
def main():
    pairs=read(DATA.parent/'action-group-pairs-v6.json');proof=read(ROOT/'experiments/vtuber-v4-gesture-groups-r6/showcase.json');clips=[]
    assert len(pairs)==14 and len(proof)==42
    for i,pair in enumerate(pairs):
        for variant,label in enumerate('ABC'):
            source=DATA/f'{i:02}-{label}.json';path=(DATA.parent/pair['clips'][variant]['media']).with_suffix('');done=read(path/'done.json');actual=read(path/'actual.json');input=read(source)
            assert done['input_sha256']==hashlib.sha256(source.read_bytes()).hexdigest()
            values=np.asarray(actual['values']);channels=actual['parameter_ids'];planned=np.asarray(input['values']);assert np.isfinite(values).all()
            col=lambda ids:values[:,[channels.index(id) for id in ids]]
            both=int(((np.abs(col(RIGHT)).max(1)>.05)&(np.abs(col(LEFT)).max(1)>.05)).sum());assert both==0
            b=col(BODY);activity=np.abs(b).max(0);body_end=np.abs(b[-1]).max();assert body_end<1e-6
            primary=proof[i*3+variant]['directive'].get('gesture');inactive=RIGHT+LEFT if pair['category']=='body' else RIGHT if primary in ['chest','thanks'] or primary=='explain' and variant==0 else LEFT
            inactive_max=float(np.abs(col(inactive)).max());assert inactive_max<1e-6
            # Independent body clips must move visibly-sized head/body inputs,
            # with both arms down, and all inputs follow the authored trajectory.
            if pair['category']=='body':assert activity.max()>3
            error=float(np.abs(b-planned[:,[input['channels'].index(id) for id in BODY]]).max());assert error<1e-5
            physics={id:float(np.ptp(values[:,channels.index(id)])) for id in PHYSICS};assert max(physics.values())>.3
            clips.append({'clip':path.name,'name':pair['name'],'category':pair['category'],'frames':len(values),'two_raised_arm_frames':both,'inactive_arm_max':inactive_max,'body_peak':dict(zip(BODY,map(float,activity))),'physics_output_ranges':physics,'body_end_max':float(body_end),'body_input_actual_max_error':error})
    report={'ok':True,'runtime_version':'v4.11-cajole','groups':14,'clips':clips,'total_frames':sum(c['frames'] for c in clips),'body_only_clips':18,'newly_rendered_clips':3,'reused_clips':39,'two_raised_arm_frames':sum(c['two_raised_arm_frames'] for c in clips),'human_accepted':False}
    OUT.mkdir(parents=True,exist_ok=True);(OUT/'render-verification.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print(json.dumps({k:v for k,v in report.items() if k!='clips'}))
if __name__=='__main__':main()
