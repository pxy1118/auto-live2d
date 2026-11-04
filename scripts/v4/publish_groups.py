"""Publish actual Cubism action-group recordings without modifying review votes."""
import json
import shutil
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'datasets/vtuber-v4-native'
REVIEW = ROOT / 'datasets/vtuber-v4/review'

def main():
    pairs = json.loads((SOURCE / 'review/action-group-pairs-v6.json').read_text(encoding='utf-8'))
    output = REVIEW / 'body-groups-v6'
    output.mkdir(parents=True, exist_ok=True)
    sheet = Image.new('RGB', (960, ((len(pairs)+3)//4)*390), '#edf2ef')
    draw = ImageDraw.Draw(sheet)
    for i, pair in enumerate(pairs):
        first_frames = (SOURCE / 'review' / pair['clips'][0]['media']).with_suffix('')
        for clip in pair['clips']:
            if 'poster' not in clip:
                media = Path(clip['media'])
                clip['poster'] = (media.parent / (media.stem+'-poster.webp')).as_posix()
            for key in ('media', 'video', 'poster'):
                source = SOURCE / 'review' / clip[key]
                assert source.is_file(), source
                shutil.copy2(source, output / source.name)
                clip[key] = 'body-groups-v6/' + source.name
            audio = SOURCE / clip['audio']
            target = REVIEW.parent / clip['audio']
            target.parent.mkdir(parents=True, exist_ok=True)
            if not target.exists():
                shutil.copy2(audio, target)
        frames = sorted(first_frames.glob('*.png'))
        assert frames
        # Sample a visible middle frame; full videos remain the review evidence.
        frame = frames[min(len(frames)-1, 54)]
        with Image.open(frame) as image:
            image = image.convert('RGB').resize((240, 360))
            x, y = (i % 4)*240, (i // 4)*390
            sheet.paste(image, (x, y+25))
            draw.text((x+8, y+5), f'{i+1}: '+pair['name'], fill='#203e30')
    evidence = ROOT / 'test-results/v4-groups-r6'
    evidence.mkdir(parents=True, exist_ok=True)
    sheet.save(evidence / 'action-groups-contact.png')
    (REVIEW / 'body-pairs.json').write_text(json.dumps(pairs, ensure_ascii=False), encoding='utf-8')
    print(json.dumps({'published_groups':len(pairs),'variants':sum(len(p['clips']) for p in pairs),'ratings_modified':False}))

if __name__ == '__main__':
    main()
