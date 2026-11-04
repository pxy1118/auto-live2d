"""Cache one real spoken example for the cajole showcase, outside training splits."""
import hashlib,json,urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];DATA=ROOT/'datasets/vtuber-v4-native'
def main():
    target=DATA/'clips/showcase-cajole-v6.json'
    if target.exists():return print('Cajole showcase audio already cached.')
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
    text='拜托啦，再陪我一会儿，好不好？'
    request=urllib.request.Request('http://127.0.0.1:8765/api/speech/prepare',json.dumps({'text':text,'with_motion':False,'seed':41},ensure_ascii=False).encode(),{'Content-Type':'application/json'})
    with opener.open(request,timeout=180) as response:result=json.load(response)
    with opener.open('http://127.0.0.1:8765'+result['audio_url'],timeout=20) as response:pcm=response.read()
    digest=hashlib.sha256(pcm).hexdigest();assert digest==result['audio_sha256']
    name='audio/cajole-v6-'+digest[:20]+'.wav';(DATA/name).write_bytes(pcm)
    meta={'file':name,'sha256':digest,'duration_ms':result['duration_ms'],'sample_rate':result['sample_rate'],'features':result['mouth'],'source':'real TTS PCM; showcase only, not added to training manifest','voice_checkpoint_sha256':result['checkpoint_sha256']}
    (DATA/name).with_suffix('.json').write_text(json.dumps(meta,ensure_ascii=False),encoding='utf-8')
    target.write_text(json.dumps({'text':text,'audio':name,'duration_ms':result['duration_ms'],'source':'cajole review showcase only'},ensure_ascii=False),encoding='utf-8')
    print(json.dumps({'audio_cached':True,'duration_ms':result['duration_ms']}))
if __name__=='__main__':main()
