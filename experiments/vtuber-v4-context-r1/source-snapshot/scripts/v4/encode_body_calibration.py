"""Encode actual captured reference frames; no generated animation or user votes."""
import hashlib
import json
import subprocess
from pathlib import Path
from PIL import Image,ImageDraw

ROOT=Path(__file__).resolve().parents[2];SOURCE=ROOT/'test-results/v4-context-study/body-calibration'
OUT=ROOT/'datasets/vtuber-v4/review/body-strength-references'
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    manifest=json.loads((SOURCE/'manifest.json').read_text(encoding='utf-8'));assert manifest['ok'];OUT.mkdir(parents=True,exist_ok=True)
    contact=Image.new('RGB',(720,6*390),'#edf2ef');draw=ImageDraw.Draw(contact)
    for i,clip in enumerate(manifest['clips']):
        folder=SOURCE/clip['id'];video=OUT/(clip['id']+'.mp4');poster=OUT/(clip['id']+'.webp')
        with Image.open(folder/'0000.png') as first:width,height=first.size
        subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','lavfi','-i',f'color=c=0xedf2ef:s={width}x{height}:r=20',
            '-framerate','20','-i',str(folder/'%04d.png'),'-filter_complex','[0:v][1:v]overlay=shortest=1:format=auto,format=yuv420p',
            '-c:v','libx264','-crf','20','-an','-movflags','+faststart',str(video)],check=True)
        params=json.loads((folder/'input.json').read_text(encoding='utf-8'))
        peak=max(range(len(params['values'])),key=lambda f:sum(v*v for v in params['values'][f]))
        poster_index=min(83,round(peak/3));clip['poster_parameter_frame']=poster_index*3
        with Image.open(folder/f'{poster_index:04d}.png') as captured:
            image=Image.new('RGBA',captured.size,'#edf2ef');image.alpha_composite(captured.convert('RGBA'));image=image.convert('RGB')
            image.save(poster);x=(i%3)*240;y=(i//3)*390;contact.paste(image.resize((240,360)),(x,y+25))
            draw.text((x+6,y+5),f"{clip['name']} {clip['strength']:.2f}",fill='#203e30')
        info=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','json',str(video)],text=True))
        assert abs(float(info['format']['duration'])-4.2)<.06
        clip.update(video='body-strength-references/'+video.name,poster='body-strength-references/'+poster.name,video_sha256=sha(video),poster_sha256=sha(poster))
    contact.save(OUT/'contact.png');(OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(dict(clips=len(manifest['clips']),actual_parameter_frames=sum(c['frames'] for c in manifest['clips']),contact=str(OUT/'contact.png'))))
if __name__=='__main__':main()
