"""Reproducible synthetic bootstrap. Human review remains explicitly pending."""
import argparse,hashlib,json,math,random,sys,time,urllib.request,wave
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT))
from speech.features import SpeechFeatures
import numpy as np

OUT=ROOT/'datasets/vtuber-v4';SEED=24041
EMOTIONS=['neutral','happy','angry','shy','sad','surprised','confused']
FACES=['黑脸','流泪','脸红','加载','兔牙','流冷汗']
EYES=['normal','＞＜','圈圈眼','爱心眼','屑屑眼']
TEXTS={
'neutral':['大家先坐好，今天我们慢慢聊。','这个地方我再解释一遍，你仔细听。','我先想一想，再告诉你我的看法。','你说的这件事，我已经记下来了。','先看左边，再看右边，这样就清楚了。','我没有生气，只是在认真说明情况。'],
'happy':['太好了，我们终于一起做到了！','谢谢你一直陪着我，我今天很开心。','来，给你看看我刚发现的好东西。','这次真的很顺利，我忍不住想笑。','你这句话说得真有意思，哈哈。','终于等到你啦，快过来坐呀。'],
'angry':['我都说了不要这样，你怎么还来！','这件事真的让我很生气，请你停下来。','你再这样捉弄我，我可真的不理你了。','我现在不想开玩笑，我是认真的。','这不公平，我明明已经努力过了！','哼，别以为说句好话我就会原谅你。'],
'shy':['你突然这样夸我，我会不好意思的。','别一直看着我啦，我都不知道说什么了。','那个，其实我一直想告诉你一件事。','我才没有害羞呢，你不要再笑了。','谢谢你这么认真地喜欢我，我有点紧张。','你靠得太近了，让我缓一缓。'],
'sad':['我本来以为这次可以成功的，还是有点难过。','你要走了吗？那我们下次再见吧。','这件事让我有点失落，不过我会慢慢调整。','我想安静一会儿，可以陪着我吗？','对不起，我没能把这件事做好。','我努力了很久，结果还是没有等到。'],
'surprised':['诶？这是真的吗，我刚才没听错吧！','等一下，你怎么突然就出现了！','哇，这个礼物竟然是给我的？','什么？你已经全部做完了！','我完全没想到会是这样的结果。','你也太厉害了吧，我都看呆了！'],
'confused':['等等，你刚才说的到底是什么意思？','我有点绕晕了，让我重新理一下。','这两件事怎么会联系到一起呢？','诶，我刚才是不是又看错了？','我的脑袋快转不过来了，先等一下。','你能再说一遍吗，我还是没有明白。'],
}
CONTEXTS=['和观众日常聊天','回应熟悉的朋友','直播中解释刚才发生的事','接着上一句继续表达','面对大家说出自己的感受','在游戏间隙与观众互动']
INTENTS=['rest','explain','point','open','chest','rhythm']
def write(path,data):path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def fetch(path,body=None):
    r=urllib.request.Request('http://127.0.0.1:8769'+path,json.dumps(body,ensure_ascii=False).encode() if body is not None else None,{'Content-Type':'application/json'})
    with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(r,timeout=180) as f:return json.load(f)
def prepare():
    OUT.mkdir(parents=True,exist_ok=True)
    capabilities=json.loads((ROOT/'test-results/runtime-capabilities.json').read_text(encoding='utf-8-sig'))
    import re
    source=(ROOT/'src/performance-profile.ts').read_text(encoding='utf-8')
    ids=re.findall(r"'([^']+)'",source.split('export const streamChannels = [')[1].split('];')[0])
    meta={p['id']:p for p in capabilities['parameters']};channels=[]
    for id in ids:
        p=dict(meta[id]);p['min']=max(p['min'],-24 if id.startswith(('Angle','Position')) else -1e9);p['max']=min(p['max'],24 if id.startswith(('Angle','Position')) else 1e9)
        channels.append(p)
    profile={'id':'dafeiyu-stream.v5','version':4,'sampling_hz':20,'frames':24,'update_ms':400,'channels':channels,'emotions':EMOTIONS,'faces':FACES,'eyes':EYES,'appearance_policy':'explicit_only','human_calibrated':False}
    profile['sha256']=hashlib.sha256(json.dumps(profile,sort_keys=True).encode()).hexdigest();write(OUT/'profile.json',profile)
    scenarios=[]
    for i in range(240):
        mood=EMOTIONS[i%7];n=i//7;text=TEXTS[mood][n%6];context=CONTEXTS[(n//6)%6]
        # Context contrasts are explicit labels, never a keyword lookup in inference.
        if mood=='neutral' and n%4==0:text='他说他很生气，我只是在复述他的话。';context+='；角色本人情绪平静，引用别人的生气，不要黑脸'
        if mood=='happy' and n%4==0:text='我没有生气啦，刚刚只是跟你开个玩笑。';context+='；角色笑着澄清误会'
        if mood=='angry' and n%5==0:text='你可真是太会照顾人了。';context+='；反讽，对方刚刚故意捉弄角色，角色在生气'
        scenarios.append({'id':f's{i:03}','text':text,'context':context,'emotion':mood,'intent':INTENTS[(n//2)%6]})
    # The entire text family (all contexts/variants/targets) belongs to one split.
    families={}
    for s in scenarios:families.setdefault(s['text'],[]).append(s)
    by_mood={m:[] for m in EMOTIONS}
    for text,group in families.items():by_mood[group[0]['emotion']].append((text,group))
    rng=random.Random(SEED)
    for groups in by_mood.values():
        rng.shuffle(groups)
        for i,(_,group) in enumerate(groups):
            split='validation' if i==0 else 'test' if i==1 else 'train'
            for s in group:s['split']=split
    write(OUT/'scenarios.json',scenarios);return profile,scenarios
def audio_for(s):
    key=hashlib.sha256(s['text'].encode()).hexdigest()[:20];path=OUT/'audio'/f'{key}.wav';meta=path.with_suffix('.json')
    if meta.exists() and path.exists():return json.loads(meta.read_text(encoding='utf-8'))
    result=fetch('/synthesize',{'text':s['text'],'seed':41})
    original=ROOT/'.runtime/speech/audio'/f"{result['speech_id']}.wav"
    path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(original.read_bytes())
    with wave.open(str(path),'rb') as f:sr=f.getframerate();pcm=np.frombuffer(f.readframes(f.getnframes()),dtype='<i2').astype(np.float32)/32768
    features=SpeechFeatures().push(pcm,sr)
    value={'file':str(path.relative_to(OUT)).replace('\\','/'),'sha256':sha(path),'sample_rate':sr,'duration_ms':len(pcm)/sr*1000,'features':features,'tts_checkpoint_sha256':result['checkpoint_sha256']}
    write(meta,value);return value
def make_clip(s,variant,profile,audio):
    rng=np.random.default_rng(SEED+int(s['id'][1:])*101+variant)
    meta=profile['channels'];ids=[p['id'] for p in meta];lo=np.array([p['min'] for p in meta],dtype=np.float64);hi=np.array([p['max'] for p in meta],dtype=np.float64);neutral=np.array([p['default'] for p in meta],dtype=np.float64);index={id:i for i,id in enumerate(ids)}
    duration=audio['duration_ms']/1000;n=math.ceil(duration*20)+1;t=np.arange(n)/20
    strength=[.22,.4,.58,.76,.92][variant];mood=s['emotion'];intent=s['intent'];phase=rng.uniform(0,6.28)
    # Independent random spline knots, coordinated by audio accents and slow posture.
    knots=np.linspace(0,max(duration,.1),max(4,math.ceil(duration/1.4)+1));noise=np.stack([np.interp(t,knots,rng.normal(0,.35,len(knots))) for _ in ids],1)
    envelope=np.minimum(1,t/.55)*np.minimum(1,np.maximum(.0,(duration-t)/.6))
    beat=np.interp(t,np.arange(len(audio['features']['beats']))/60,audio['features']['beats'])
    energy=np.interp(t,np.arange(len(audio['features']['energy']))/60,audio['features']['energy'])
    values=np.tile(neutral,(n,1));initial=neutral.copy()
    for id,amp in [('AngleX',7),('AngleY',5),('AngleZ',7),('PositionX',5),('PositionY',4),('PositionZ',6),('ShoulderX',3),('ShoulderYy',3)]:
        j=index[id];initial[j]=rng.uniform(-amp*.35,amp*.35);values[:,j]=initial[j]*(1-envelope*.75)+amp*noise[:,j]*envelope*(.5+strength)
    def setv(id,v):values[:,index[id]]=np.asarray(v)+np.zeros(n)
    setv('AngleY',values[:,index['AngleY']]-beat*(2+3*strength))
    setv('ParamEyeBallX',noise[:,index['ParamEyeBallX']]*.5)
    setv('ParamEyeBallY',(-.25 if mood=='shy' else .05)*strength*envelope+noise[:,index['ParamEyeBallY']]*.12)
    setv('LeanInput',-(1+strength*5)*energy*envelope)
    setv('EyeSmile',(.6 if mood=='happy' else .22 if mood=='shy' else 0)*strength*envelope)
    brow=(-.7 if mood=='angry' else .55 if mood in ['sad','surprised','confused'] else .05)*strength*envelope
    setv('ParamBrowLY',brow);setv('ParamBrowRY',brow*.9)
    setv('ParamBrowLAngle',(-.6 if mood=='angry' else .15)*strength*envelope);setv('ParamBrowRAngle',(-.6 if mood=='angry' else .15)*strength*envelope)
    setv('BrowInnerUp',(.7 if mood in ['sad','surprised'] else 0)*strength*envelope)
    setv('LEyeSquint',(.4 if mood in ['angry','happy'] else 0)*strength*envelope);setv('REyeSquint',(.4 if mood in ['angry','happy'] else 0)*strength*envelope)
    opening=(.2 if mood=='surprised' else -.2 if mood in ['shy','angry'] else 0)*strength*envelope
    setv('ParamEyeLOpen',1+opening);setv('ParamEyeROpen',1+opening)
    setv('ParamMouthForm',(.6 if mood in ['happy','shy'] else -.5 if mood in ['angry','sad'] else .05)*strength*envelope)
    setv('MouthX',noise[:,index['MouthX']]*.07);setv('Mouthpucker',(.4 if mood=='shy' else .1)*strength*envelope)
    setv('CheeckPuff',(.4 if mood=='angry' and variant>2 else 0)*envelope)
    arm=(.08 if intent=='rest' else .25+.5*strength)*envelope
    if mood=='angry':arm*=1.25
    for id in ['Param36','Param39','Param41','Param42','Param43','Param62','Param59','Param60','Param61']:
        offset=rng.uniform(-.6,.6);curve=arm*(offset+noise[:,index[id]]+beat*.3)
        if intent=='point' and id in ['Param36','Param41','Param43']:curve+=arm*.55
        if intent=='chest' and id in ['Param62','Param60']:curve+=arm*.55
        setv(id,curve)
    setv('Movement1',0);setv('Movement2',envelope if intent in ['chest','open'] else 0);setv('Movement3',envelope if intent in ['point','explain','rhythm'] else 0);setv('Param40',envelope if intent=='point' else 0)
    values=np.clip(values,lo,hi);face=np.zeros((n,len(FACES)+1));eye=0
    if mood=='angry':face[:,0]=strength
    if mood=='sad':face[:,1]=strength*.8
    if mood=='shy':face[:,2]=strength
    if mood=='confused' and variant>=2:eye=2
    if mood=='shy' and variant>=3:eye=1
    if mood=='happy' and variant==4:eye=3
    face[:,-1]=strength if eye else 0
    if mood=='surprised' and variant>2:face[:,5]=strength*.5
    return {'id':f"{s['id']}-v{variant}",'scenario':s['id'],'text':s['text'],'context':s['context'],'split':s['split'],'emotion':mood,'intent':intent,
      'audio':audio['file'],'audio_sha256':audio['sha256'],'duration_ms':audio['duration_ms'],'hz':20,'initial':initial.tolist(),'values':values.round(5).tolist(),
      'face':face.round(4).tolist(),'eye':eye,'hold_ms':2000+strength*4000,'intensity':strength,'source':'synthetic_bootstrap','human_review':'pending'}
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--pilot',action='store_true');args=parser.parse_args()
    profile,scenarios=prepare();selected=scenarios[:24] if args.pilot else scenarios
    items=[]
    for i,s in enumerate(selected):
        audio=audio_for(s)
        for variant in range(5):
            clip=make_clip(s,variant,profile,audio);path=OUT/'clips'/f"{clip['id']}.json";write(path,clip)
            items.append({k:clip[k] for k in ['id','scenario','text','context','emotion','intent','split','audio','audio_sha256','duration_ms','intensity']})
        print(json.dumps({'scenario':i+1,'total':len(selected),'clips':len(items)},ensure_ascii=False),flush=True)
    write(OUT/('pilot.json' if args.pilot else 'manifest.json'),{'seed':SEED,'profile_sha256':profile['sha256'],'human_calibrated':False,'items':items})
    if not args.pilot:
        sequences=[];rng=random.Random(SEED)
        for i in range(240):
            split=['train']*8+['validation','test'];split=split[i%10];pool=[c for c in items if c['split']==split]
            clips=rng.sample(pool,4);sequences.append({'id':f'dialogue-{i:03}','split':split,'clips':[c['id'] for c in clips],'pauses_ms':[rng.choice([200,600,1600]) for _ in range(3)],'interrupt_after_ms':1200 if i%5==0 else None,'human_review':'pending'})
        write(OUT/'sequences.json',sequences)
    write(OUT/'review/status.json',{'stage':'pilot' if args.pilot else 'bootstrap','human_calibrated':False,'required_pilot_choices':16,'required_final_comparisons':24,'promotion_allowed':False})
if __name__=='__main__':main()
