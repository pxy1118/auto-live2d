"""Rebuild every action target with floats; preserve both earlier failed datasets."""
import json,os,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent));import build_dataset as base
ROOT=base.ROOT;OLD=ROOT/'datasets/vtuber-v4';AUDIO=ROOT/'datasets/vtuber-v4-body/audio';OUT=ROOT/'datasets/vtuber-v4-body-float'
def read(path):return json.loads(path.read_text(encoding='utf-8'))
def main():
    OUT.mkdir(parents=True,exist_ok=True);(OUT/'audio').mkdir(exist_ok=True)
    profile=read(OLD/'profile.json');base.write(OUT/'profile.json',profile)
    for p in AUDIO.iterdir():
        target=OUT/'audio'/p.name
        if p.is_file() and not target.exists():os.link(p,target)
    source=read(OLD/'manifest.json');items=[]
    for item in source['items']:
        original=read(OLD/'clips'/f"{item['id']}.json")
        s={'id':original['scenario'],**{k:original[k] for k in ['text','context','emotion','intent','split']}}
        audio=read(OUT/original['audio'].replace('.wav','.json'));variant=int(original['id'].rsplit('v',1)[1])
        clip=base.make_clip(s,variant,profile,audio);clip['source']='synthetic_bootstrap_float_corrected'
        base.write(OUT/'clips'/f"{clip['id']}.json",clip);items.append({k:clip[k] for k in item.keys()})
    base.write(OUT/'manifest.json',{'seed':24041,'profile_sha256':profile['sha256'],'human_calibrated':False,'items':items,'correction':'float64 targets; no integer truncation'})
    base.write(OUT/'sequences.json',read(OLD/'sequences.json'));print(json.dumps({'regenerated_float_clips':len(items)}))
if __name__=='__main__':main()
