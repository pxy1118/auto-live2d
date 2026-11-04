import json,subprocess,os
from pathlib import Path
from PIL import Image
ROOT=Path(__file__).resolve().parents[2];DATA=Path(os.environ.get('DATASET_ROOT',ROOT/'datasets/vtuber-v4'));REVIEW=DATA/'review';MEDIA=os.environ.get('MEDIA_DIR','comparisons');PAIRS=os.environ.get('PAIRS_FILE','comparison-pairs.json')
def main():
    pairs=json.loads((REVIEW/PAIRS).read_text(encoding='utf-8'))
    for i,pair in enumerate(pairs):
        for label,clip in zip([chr(65+j) for j in range(len(pair['clips']))],pair['clips']):
            id=Path(clip['media']).stem;frames=sorted((REVIEW/MEDIA/id).glob('*.png'))
            done=REVIEW/MEDIA/id/'done.json';hz=json.loads(done.read_text(encoding='utf-8')).get('image_hz',10)
            if not frames:raise RuntimeError('Missing rendered frames: '+id)
            target=REVIEW/MEDIA/f'{id}.webp'
            poster=target.with_name(target.stem+'-poster.webp');video=target.with_suffix('.mp4')
            if all(p.exists() and p.stat().st_mtime>=done.stat().st_mtime for p in [target,poster,video]):
                clip['poster']=MEDIA+'/'+poster.name;clip['video']=MEDIA+'/'+video.name
                continue
            images=[Image.open(p).convert('RGBA') for p in frames]
            images[0].save(target,save_all=True,append_images=images[1:],duration=round(1000/hz),loop=0,quality=80,method=3)
            images[min(len(images)-1,round(hz*1.2))].save(poster,quality=88)
            clip['poster']=MEDIA+'/'+poster.name
            for image in images:image.close()
            video=target.with_suffix('.mp4')
            if not video.exists() or (REVIEW/MEDIA/id/'done.json').stat().st_mtime>video.stat().st_mtime:
                concat=REVIEW/MEDIA/id/'frames.ffconcat'
                concat.write_text('ffconcat version 1.0\n'+''.join(f"file '{p.name}'\nduration {1/hz:.9f}\n" for p in frames)+f"file '{frames[-1].name}'\n",encoding='utf-8')
                subprocess.run(['ffmpeg','-y','-loglevel','error','-f','concat','-safe','0','-i',str(concat),'-i',str(DATA/clip['audio']),'-r',str(hz),'-c:v','libx264','-preset','fast','-pix_fmt','yuv420p','-c:a','aac','-af','apad','-t',str(len(frames)/hz),str(video)],check=True)
            clip['video']=MEDIA+'/'+video.name
        print(json.dumps({'encoded':i+1,'total':len(pairs)}),flush=True)
    (REVIEW/PAIRS).write_text(json.dumps(pairs,ensure_ascii=False),encoding='utf-8')
if __name__=='__main__':main()
