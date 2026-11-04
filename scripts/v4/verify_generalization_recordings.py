import json
import math
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
ROOT=Path(__file__).resolve().parents[2];MEDIA=ROOT/'datasets/vtuber-v4/review/generalization-r1';OUT=ROOT/'test-results/v4-generalization'

def main():
    report={'ok':False,'runtime_version':'v4.13.0-clause-plan','clips':[]};panels=[]
    names=['迎接回来','真心夸奖','生气反讽','撒娇请求','强调重点','转述他人']
    font=ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',18)
    for i in range(6):
        name=f'{i:02}-A';p=json.loads((MEDIA/(name+'.json')).read_text());a=json.loads((MEDIA/name/'actual.json').read_text());d=json.loads((MEDIA/name/'done.json').read_text());ids=a['parameter_ids']
        assert d['runtime_revision']==report['runtime_version'];assert len(a['values'])==len(p['values'])
        eyes=[ids.index(k) for k in ['key3','key4','key5','key6']]
        checks=['Param36','Param39','Param41','Param42','Param62','Param59','Param60','Movement1','Movement2','Movement3','key1','key7','key5','key6']
        error=0.;both=0
        for expected,actual in zip(p['values'],a['values']):
            assert all(math.isfinite(v) for v in actual)
            assert all(actual[j] in [0,1] for j in eyes) and sum(actual[j] for j in eyes)<=1
            right=max(abs(actual[ids.index(k)]) for k in ['Param36','Param39','Param41','Movement1','Movement3'])
            left=max(abs(actual[ids.index(k)]) for k in ['Param62','Param59','Param60','Movement2'])
            both+=right>.05 and left>.05
            for k in checks:error=max(error,abs(expected[p['channels'].index(k)]-actual[ids.index(k)]))
        assert both==0 and error<.00002
        pngs=sorted((MEDIA/name).glob('*.png'));assert len(pngs)==d['frames']==math.ceil(len(p['values'])/2)
        panel=Image.new('RGB',(260,420),'#f3f6f3');frame=Image.open(pngs[min(len(pngs)-1,51)]).convert('RGB');frame.thumbnail((260,390));panel.paste(frame,((260-frame.width)//2,28));ImageDraw.Draw(panel).text((12,4),names[i],font=font,fill='#233a31');panels.append(panel)
        report['clips'].append({'name':name,'frames':len(a['values']),'two_raised_arm_frames':both,'fractional_special_eye_frames':0,'maximum_replay_parameter_error':error})
    sheet=Image.new('RGB',(780,840),'white')
    for i,panel in enumerate(panels):sheet.paste(panel,((i%3)*260,(i//3)*420))
    sheet.save(OUT/'contact-sheet.jpg',quality=92);report['ok']=True;(OUT/'recordings.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print(json.dumps({'ok':True,'clips':6,'frames':sum(r['frames'] for r in report['clips'])}))

if __name__=='__main__':main()
