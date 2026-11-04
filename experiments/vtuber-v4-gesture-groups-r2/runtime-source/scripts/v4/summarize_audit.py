"""Use rendered pixels, not hidden mesh vertices, to report visible changes."""
import json,urllib.request
from pathlib import Path
from PIL import Image,ImageChops
import numpy as np
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'test-results/v4/audit'
def main():
    path=OUT/'capabilities.json';data=json.loads(path.read_text(encoding='utf-8'))
    for p in data['parameters']:
        reference=next(s for s in p['samples'] if s['requested']==p['default'])
        with Image.open(OUT/reference['image']) as image:base=np.asarray(image.convert('RGBA')).astype(np.int16)
        for sample in p['samples']:
            with Image.open(OUT/sample['image']) as image:other=np.asarray(image.convert('RGBA')).astype(np.int16)
            diff=np.abs(other-base);sample['changed_pixels_vs_own_default']=int(np.count_nonzero(diff.max(-1)>8))
        p['mesh_change']=p.pop('visible_change',False);p['visible_change']=any(s['changed_pixels_vs_own_default']>20 for s in p['samples'])
        p['effective_range']=[p['min'],p['max']] if p['visible_change'] else None
        p['range_note']='isolated native range tested; not an assertion that all combinations are aesthetically valid'
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open('http://127.0.0.1:8765/api/manifest') as r:data['asset_hash']=json.load(r)['assetHash']
    data['visible_change_method']='>20 pixels change by >8/255 RGBA relative to the same parameter explicitly at its default; hidden mesh motion is not sufficient'
    path.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8')
    target=ROOT/'datasets/vtuber-v4/review/capabilities.json';target.write_bytes(path.read_bytes())
    print(json.dumps({'parameters':len(data['parameters']),'visible_changes':sum(p['visible_change'] for p in data['parameters']),'finite':all(s['finite'] for p in data['parameters'] for s in p['samples'])}))
if __name__=='__main__':main()
