"""Stitch synthetic clips with real PCM, continuous incoming poses, and pauses."""
import hashlib,json,math,wave,sys,os
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[2];DATA=Path(os.environ.get('DATASET_ROOT',ROOT/'datasets/vtuber-v4'))
sys.path.insert(0,str(ROOT))
from speech.features import SpeechFeatures
def read(path):return json.loads(path.read_text(encoding='utf-8'))
def main():
    profile=read(DATA/'profile.json');lo=np.array([p['min'] for p in profile['channels']]);hi=np.array([p['max'] for p in profile['channels']])
    out=DATA/'dialogues';out.mkdir(exist_ok=True)
    for seq in read(DATA/'sequences.json'):
        chunks=[];faces=[];eyes=[];pcm=[];clauses=[];cursor=0;rate=None;last=None
        for i,id in enumerate(seq['clips']):
            c=read(DATA/'clips'/f'{id}.json')
            with wave.open(str(DATA/c['audio']),'rb') as f:rate=f.getframerate();sound=np.frombuffer(f.readframes(f.getnframes()),dtype='<i2')
            if seq['interrupt_after_ms'] and i==1:sound=sound[:round(seq['interrupt_after_ms']/1000*rate)]
            n=math.ceil(len(sound)/rate*20);v=np.asarray(c['values'])[:n].copy();face=np.asarray(c['face'])[:n].copy()
            if last is not None:
                offset=last-v[0];v+=offset[None]*np.maximum(0,1-np.arange(len(v))/8)[:,None]
            v=np.clip(v,lo,hi);chunks.extend(v.tolist());faces.extend(face.tolist());eyes.extend([c['eye']]*len(v));last=v[-1]
            clauses.append({'clip':id,'at_ms':cursor/rate*1000,'text':c['text'],'interrupted':bool(seq['interrupt_after_ms'] and i==1)})
            pad=n*rate//20-len(sound);pcm.extend([sound,np.zeros(max(0,pad),dtype='<i2')]);cursor+=len(sound)+max(0,pad)
            if i<3:
                gap=round(seq['pauses_ms'][i]/50);chunks.extend([last.tolist()]*gap);faces.extend([face[-1].tolist()]*gap);eyes.extend([c['eye']]*gap);pcm.append(np.zeros(gap*rate//20,dtype='<i2'));cursor+=gap*rate//20
        audio=out/(seq['id']+'.wav')
        with wave.open(str(audio),'wb') as f:f.setnchannels(1);f.setsampwidth(2);f.setframerate(rate);f.writeframes(np.concatenate(pcm).tobytes())
        features=SpeechFeatures().push(np.concatenate(pcm).astype(np.float32)/32768,rate)
        result={**seq,'hz':20,'values':chunks,'face':faces,'eye':eyes,'mouth':features['values'],'audio':'dialogues/'+audio.name,'audio_sha256':hashlib.sha256(audio.read_bytes()).hexdigest(),'clauses':clauses,'source':'stitched_real_tts_synthetic_motion'}
        (out/(seq['id']+'.json')).write_text(json.dumps(result,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    print(json.dumps({'dialogues':240,'real_audio':True,'human_review':'pending'}))
if __name__=='__main__':main()
