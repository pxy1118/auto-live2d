"""Check matched blind recordings and create QA sheets without casting votes."""
import hashlib,json
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parents[2];DATA=ROOT/'datasets/vtuber-v4/review';FOLDER=DATA/'comparisons-composition-r1';OUT=ROOT/'test-results/v4-composition'
def read(p):return json.loads(p.read_text(encoding='utf-8'))
def main():
    key=read(ROOT/'experiments/vtuber-v4-composition-r1/blind-key.json');clips=[];OUT.mkdir(exist_ok=True)
    for i in range(24):
        inputs=[]
        for label in 'AB':
            p=FOLDER/f'{i:02}-{label}';source=p.with_suffix('.json');planned=read(source);done=read(p/'done.json');actual=read(p/'actual.json');a=np.asarray(actual['values']);ids=actual['parameter_ids'];assert np.isfinite(a).all() and done['actual_finite'];assert hashlib.sha256(source.read_bytes()).hexdigest()==done['input_sha256'];assert planned['hz']==60 and planned['image_hz']==30
            inputs.append(planned);model=next(m['model'] for m in key[i]['models'] if m['label']==label)
            right=np.abs(a[:,[ids.index(k) for k in ['Param36','Param39','Param41','Movement1','Movement3']]]).max(1);left=np.abs(a[:,[ids.index(k) for k in ['Param62','Param59','Param60','Movement2']]]).max(1);both=int(((right>.05)&(left>.05)).sum())
            wardrobe=float(np.abs(a[:,[ids.index(k) for k in ['key10','key11','key12','Clothes1','Clothes2','Clothes3','Clothes4','Clothes5']]]-a[0,[ids.index(k) for k in ['key10','key11','key12','Clothes1','Clothes2','Clothes3','Clothes4','Clothes5']]]).max())
            if model=='candidate':assert both==0 and wardrobe==0
            clips.append({'clip':p.name,'model':model,'frames':len(a),'two_raised_arm_frames':both,'wardrobe_max_change':wardrobe,'input_sha256':done['input_sha256']})
        assert len(inputs[0]['values'])==len(inputs[1]['values']);assert inputs[0]['mouth']==inputs[1]['mouth']
    for sheet in range(3):
        image=Image.new('RGB',(960,1560),'#edf2ef');draw=ImageDraw.Draw(image)
        for local in range(8):
            index=sheet*8+local
            for j,label in enumerate('AB'):
                files=sorted((FOLDER/f'{index:02}-{label}').glob('*.png'));frame=files[min(len(files)-1,60)]
                with Image.open(frame) as im:
                    rgba=im.convert('RGBA');bg=Image.new('RGBA',im.size,'#edf2ef');bg.alpha_composite(rgba);small=bg.convert('RGB').resize((240,360));x=(local%2)*480+j*240;y=(local//2)*390;image.paste(small,(x,y+25));draw.text((x+5,y+5),f'{index+1} {label}',fill='black')
        image.save(OUT/f'comparison-contact-{sheet+1}.png')
    result={'ok':True,'pairs':24,'clips':48,'same_pcm_and_duration':True,'both_30fps':True,'candidate_two_raised_arm_frames':sum(r['two_raised_arm_frames'] for r in clips if r['model']=='candidate'),'candidate_wardrobe_changes':sum(r['wardrobe_max_change']>0 for r in clips if r['model']=='candidate'),'records':clips,'human_votes_written':False}
    (OUT/'recordings.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8');print(json.dumps({k:v for k,v in result.items() if k!='records'}))
if __name__=='__main__':main()
