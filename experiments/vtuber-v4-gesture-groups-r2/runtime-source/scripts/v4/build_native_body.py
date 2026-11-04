"""Versioned continuous teachers calibrated against native Cubism joint combinations."""
import hashlib,json,math,os,sys,wave
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).parent));import build_body as old
sys.path.insert(0,str(old.ROOT));from speech.features import SpeechFeatures
ROOT=old.ROOT;BASE=ROOT/'datasets/vtuber-v4-body-float';OUT=ROOT/'datasets/vtuber-v4-native'
def read(p):return json.loads(p.read_text(encoding='utf-8'))
def write(p,d):p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(d,ensure_ascii=False),encoding='utf-8')
def link(a,b):
    b.parent.mkdir(parents=True,exist_ok=True)
    if not b.exists():os.link(a,b)
def smooth(t):t=np.clip(t,0,1);return t*t*t*(10+t*(-15+6*t))
def native(name,t,id):
    d=read(ROOT/'test-results/v4-native-reference/native-curves.json')[name];j=d['channels'].index(id)
    return np.interp(np.asarray(t)*60,np.arange(len(d['values'])),np.asarray(d['values'])[:,j])
def main():
    if (OUT/'manifest.json').exists():raise RuntimeError('Refusing to overwrite native teacher version')
    OUT.mkdir(parents=True,exist_ok=True);profile=read(BASE/'profile.json');write(OUT/'profile.json',profile)
    source=read(BASE/'manifest.json');items=[]
    for item in source['items']:
        if item['id'].startswith('body-'):continue
        for relative in [f"clips/{item['id']}.json",f"recordings/{item['id']}.json.gz",item['audio'],item['audio'].replace('.wav','.json')]:link(BASE/relative,OUT/relative)
        items.append(item)
    seqs=read(BASE/'sequences.json');write(OUT/'sequences.json',seqs)
    for seq in seqs:
        for relative in [f"dialogues/{seq['id']}.json",f"dialogues/{seq['id']}.wav",f"dialogue-recordings/{seq['id']}.json.gz"]:link(BASE/relative,OUT/relative)
    ids=[p['id'] for p in profile['channels']];defaults=np.array([p['default'] for p in profile['channels']],float)
    lo=np.array([p['min'] for p in profile['channels']],float);hi=np.array([p['max'] for p in profile['channels']],float)
    for original in source['items']:
        if not original['id'].startswith('body-'):continue
        c=read(BASE/'clips'/f"{original['id']}.json");family=c['intent'];variant=int(c['id'][-1]);number=int(c['id'].split('-')[2]);rng=np.random.default_rng(71000+number*13+variant)
        duration=3.05+variant*.06;amplitude=[.86,.92,.97,1.][variant]
        sound=BASE/c['audio'];audio_name='audio/native-'+sound.name
        if not (OUT/audio_name).exists():
            with wave.open(str(sound),'rb') as f:sr=f.getframerate();pcm=f.readframes(f.getnframes())
            samples=np.frombuffer(pcm,dtype='<i2');padding=max(0,math.ceil((3.6-len(samples)/sr)*sr));samples=np.r_[samples,np.zeros(padding,dtype=np.int16)]
            (OUT/'audio').mkdir(exist_ok=True)
            with wave.open(str(OUT/audio_name),'wb') as f:f.setnchannels(1);f.setsampwidth(2);f.setframerate(sr);f.writeframes(samples.astype('<i2').tobytes())
            features=SpeechFeatures().push(samples.astype(np.float32)/32768,sr)
            write((OUT/audio_name).with_suffix('.json'),{'file':audio_name,'sha256':hashlib.sha256((OUT/audio_name).read_bytes()).hexdigest(),'duration_ms':len(samples)/sr*1000,'sample_rate':sr,'features':features,'source_audio_sha256':original['audio_sha256'],'trailing_silence_only':True})
        audio=read((OUT/audio_name).with_suffix('.json'));n=math.ceil(audio['duration_ms']/50)+1;t=np.arange(n)*.05;u=t/duration
        # Native entry takes about 0.8 s; adjacent joints follow 30-100 ms later.
        env=lambda delay=0:smooth((t-.08-delay)/.66)*(1-smooth((t-(duration-.78)-delay)/.78))
        e=env();fore=env(.055);wenv=env(.11);phase=np.maximum(0,t-.65)
        values=np.tile(defaults,(n,1));faces=np.zeros((n,7));index={id:i for i,id in enumerate(ids)}
        def put(id,v):values[:,index[id]]=v
        beat=np.interp(t,np.arange(len(audio['features']['beats']))/60,audio['features']['beats'])
        # Anticipation, a small body response, and a delayed head response, not a shared sine on all joints.
        put('AngleX',1.7*np.sin(phase*.9)*env(.12));put('AngleY',(-1.3-1.2*beat)*env(.09));put('AngleZ',(-2.3 if family=='wave' else 1.6)*env(.1))
        put('PositionX',(-.8 if family=='wave' else .35)*e);put('PositionY',-.9*e-.6*beat*fore);put('PositionZ',.7*fore);put('LeanInput',-.6*e)
        put('ParamMouthForm',(.45 if family in ['wave','cheer','chest'] else .05)*e)
        if family=='wave':
            put('Param36',amplitude*(.94+.035*np.sin(phase*2.1))*e);put('Param39',.055*fore)
            put('Param41',.045*np.sin(phase*2.4+.5)*fore)
            put('Param42',.31*np.sin(phase*7.0)*wenv);put('Param43',.06*np.sin(phase*3)*wenv)
        elif family=='cheer':
            pulse=.97+.03*np.sin(phase*6.2)*smooth(phase/.25)
            put('Param36',amplitude*pulse*e);put('Param62',amplitude*pulse*env(.07))
            put('Param39',.025*fore);put('Param59',-.025*fore)
            put('Param41',.045*np.sin(phase*4)*fore);put('Param60',-.045*np.sin(phase*4+.3)*env(.12))
            put('Param42',.17*np.sin(phase*6)*wenv);put('Param61',-.18*np.sin(phase*6+.35)*env(.16))
            put('PositionY',(-1.9-.85*np.sin(phase*6.2)*smooth(phase/.3))*e);put('AngleY',(-3.3-.8*beat)*env(.12))
        elif family in ['point','chest']:
            enter='竖手指切出来动画' if family=='point' else '默认手切举手';leave='竖手指切回默认' if family=='point' else '举手切默认手'
            joints=['Movement3','Param40','Param36','Param39','Param41','Param42','Param43'] if family=='point' else ['Movement2','Param62','Param59','Param60','Param61']
            for id in joints:
                a=native(enter,np.minimum(t,1.25 if family=='point' else 1.133),id)
                b=native(leave,np.maximum(0,t-(duration-1.12)),id)
                v=np.where(t<duration-1.12,a,b)
                if id not in ['Movement2','Movement3','Param40']:v*=.96+.04*amplitude
                put(id,v)
            wrist='Param42' if family=='point' else 'Param61';put(wrist,values[:,index[wrist]]+.065*np.sin(phase*3.2)*e)
        else:
            put('Param36',(.27 if family=='explain' else .38)*amplitude*e)
            put('Param39',.1*fore);put('Param41',(.42+.05*np.sin(phase*2.5))*fore)
            put('Param42',(.13*np.sin(phase*3.3) if family=='explain' else .17*np.sin(phase*4.3))*wenv)
            if family=='refuse':put('AngleX',-5*np.sin(phase*3)*fore)
        if c['emotion']=='angry':faces[:,0]=.4*e
        c.update({'audio':audio_name,'audio_sha256':audio['sha256'],'duration_ms':audio['duration_ms'],'initial':values[0].tolist(),'values':np.clip(values,lo,hi).round(6).tolist(),'face':faces.tolist(),'intensity':amplitude,'source':'native_calibrated_continuous_teacher','sampling_weight':9,'gesture_duration_ms':duration*1000,'reference':'native joint coordination / entry and recovery timing; wave and cheer are newly composed continuous trajectories','human_review':'pending_native_body_review'})
        write(OUT/'clips'/f"{c['id']}.json",c);items.append({k:c[k] for k in original})
    write(OUT/'manifest.json',{'items':items,'profile_sha256':profile['sha256'],'seed':71000,'body_supplement':240,'base_dataset_sha256':hashlib.sha256((BASE/'manifest.json').read_bytes()).hexdigest(),'source':'native_calibrated_v4','human_calibrated':False,'native_sources':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in (ROOT/'live2d/DeepSeek/DeepSeek/Animation').glob('*.json')}})
    print(json.dumps({'clips':len(items),'new_body_clips':240,'data':str(OUT)}))
if __name__=='__main__':main()
