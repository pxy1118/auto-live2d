"""Add clear, semantically directed continuous arm demonstrations to the bootstrap."""
import hashlib,json,math,os,sys,time,urllib.error
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).parent))
import build_dataset as base
ROOT=base.ROOT;OLD=Path(os.environ.get('BASE_DATASET_ROOT',ROOT/'datasets/vtuber-v4'));OUT=Path(os.environ.get('DATASET_ROOT',ROOT/'datasets/vtuber-v4-body'))
WORDS={
'wave':['大家好呀，我来和你们打个招呼。','欢迎回来，先和大家挥挥手吧。','嘿，能看到我吗，来打个招呼。','今天见到你们真开心，你好呀。','我们下次再见，拜拜啦。','那我先向大家问个好。','这边这边，你看见我了吗？','开播啦，大家下午好。','我要先和新来的朋友打声招呼。','你回来了呀，好久不见。'],
'explain':['这个问题让我慢慢给你解释。','我觉得可以从这两个方面来考虑。','先别急，我们把事情的经过说清楚。','我的意思是，这两件事可以一起做。','听我讲完，你就会明白了。','我先简单说一下我的看法。','我们先把最重要的一点讲清楚。','这个办法其实还有一个好处。','大概就是这样，你觉得呢？','我给你举一个简单的例子。'],
'point':['关键就是这里，你仔细看。','我说的重点就是这一点。','你看这里，这个地方很重要。','答案就在这里，我指给你看。','先注意这个细节，别看漏了。','我们现在要看的就是这一项。','这个位置才是问题所在。','你找到这里就明白了。','先看我指的这个地方。','我想强调的就是这一点。'],
'chest':['这件事就交给我来完成吧。','我会认真对待你的信任。','我也有自己的想法，听我说吧。','这一次，我想自己试一试。','我向你保证，会好好准备。','我是真的很感谢你们。','能得到你们的支持，我很感动。','我会把这份心意记在心里。','这就是我自己的选择。','谢谢你愿意一直陪着我。'],
'cheer':['太好了，我们终于成功了！','这次真的赢了，太开心了！','你做得太棒了，我要为你庆祝！','终于等到这个好消息了！','好耶，我们一起庆祝一下！','这下终于可以放心啦！','今天的结果比我想的还要好！','我们真的一起完成了这件事！','我现在开心得都想跳起来了！','你真的做到了，太厉害啦！'],
'refuse':['先等一下，这样做不合适。','不可以，这件事我不能答应。','停一下，我们先把规则讲清楚。','我不同意，我们应该换个办法。','别再这样捉弄我了，停下来。','这件事到这里就可以了。','先不要继续，我还没准备好。','我们还是先冷静一下吧。','不是这样的，听我说完。','我想认真地拒绝这件事。'],
}
INTENTS={'wave':'自然抬起一侧手臂挥手问候，手腕有清楚的连续变化',
'explain':'解释时抬起手臂，前臂与手腕配合观点自然展开',
'point':'抬起一侧手臂指出重点，使用食指但不播放固定动作',
'chest':'一只手靠近胸前表达自己的想法，前臂姿态清楚',
'cheer':'高兴地举起双臂庆祝，躯干和头部一起响应',
'refuse':'抬手表示停一下，同时轻轻摇头拒绝'}
def read(path):return json.loads(path.read_text(encoding='utf-8'))
def link(source,target):
    if source.resolve()==target.resolve():return
    target.parent.mkdir(parents=True,exist_ok=True)
    if not target.exists():os.link(source,target)
def build():
    OUT.mkdir(parents=True,exist_ok=True);profile=read(OLD/'profile.json');base.write(OUT/'profile.json',profile)
    manifest=read(OLD/'manifest.json');items=list(manifest['items'])
    if manifest.get('body_supplement')==240 and OLD.resolve()==OUT.resolve():
        print(json.dumps({'existing_body_supplement':240}));return
    for item in items:
        for relative in [f"clips/{item['id']}.json",f"recordings/{item['id']}.json.gz",item['audio'],item['audio'].replace('.wav','.json')]:link(OLD/relative,OUT/relative)
    for seq in read(OLD/'sequences.json'):
        for relative in [f"dialogues/{seq['id']}.json",f"dialogues/{seq['id']}.wav",f"dialogue-recordings/{seq['id']}.json.gz"]:link(OLD/relative,OUT/relative)
    base.write(OUT/'sequences.json',read(OLD/'sequences.json'));base.OUT=OUT
    if not os.environ.get('OFFLINE_AUDIO'):
        while True:
            try:base.fetch('/health');break
            except OSError:time.sleep(1)
    meta=profile['channels'];ids=[p['id'] for p in meta];index={id:i for i,id in enumerate(ids)};lo=np.array([p['min'] for p in meta],dtype=np.float64);hi=np.array([p['max'] for p in meta],dtype=np.float64);neutral=np.array([p['default'] for p in meta],dtype=np.float64)
    for family,texts in WORDS.items():
        for number,text in enumerate(texts):
            mood='happy' if family in ['wave','cheer','chest'] else 'angry' if family=='refuse' and number==4 else 'neutral'
            context='直播对话；动作意图：'+INTENTS[family];s={'text':text,'id':family+str(number),'context':context}
            audio=base.audio_for(s);duration=audio['duration_ms']/1000;n=math.ceil(duration*20)+1;t=np.arange(n)/20
            for variant in range(4):
                strength=[.55,.7,.85,1][variant];rng=np.random.default_rng(93041+list(WORDS).index(family)*1000+number*10+variant)
                rise=np.clip(t/(.55+rng.uniform(-.1,.1)),0,1);rise=rise*rise*(3-2*rise)
                fall=np.clip((duration-t)/.7,0,1);fall=fall*fall*(3-2*fall)
                e=rise*(.28+.72*fall);values=np.tile(neutral,(n,1));face=np.zeros((n,7))
                def setv(id,v):values[:,index[id]]=np.asarray(v)+np.zeros(n)
                beats=np.interp(t,np.arange(len(audio['features']['beats']))/60,audio['features']['beats'])
                setv('AngleY',(-1.3-2*beats)*e);setv('AngleZ',np.sin(t*.9+rng.uniform(-.2,.2))*3*e)
                setv('AngleX',(2 if family!='refuse' else 9*np.sin(t*3))*e)
                setv('PositionX',-2.5*e);setv('PositionY',(-1-1.8*beats)*e);setv('PositionZ',4*np.sin(t*.8)*e);setv('LeanInput',-2.5*e)
                setv('ParamEyeBallX',-.12*e);setv('ParamMouthForm',(.4 if mood=='happy' else -.2 if mood=='angry' else .1)*e)
                setv('EyeSmile',(.25 if mood=='happy' else 0)*e)
                arm=.72*strength*e;forearm=(.15+.12*beats)*e;wrist=.12*np.sin(t*3.5)*e
                if family=='wave':arm=(.8+.08*np.sin(t*2))*strength*e;forearm=-.15*e;wrist=.32*np.sin(t*6.5)*e
                if family=='explain':arm=(.42+.13*np.sin(t*2.1))*strength*e;forearm=(.15+.25*np.sin(t*1.8))*e;wrist=.15*np.sin(t*3)*e
                if family=='point':arm=.52*strength*e;forearm=.33*e;setv('Movement3',rise);setv('Param40',rise);setv('Param43',.9*e)
                if family=='chest':
                    setv('Movement2',rise);setv('Param62',.034*e);setv('Param59',.476*e);setv('Param60',(.64+.22*strength)*e);setv('Param61',.06*np.sin(t*2.5)*e)
                    arm=.07*e;forearm=.02*e;wrist=.02*e
                if family=='cheer':
                    arm=.88*strength*e;forearm=.2*e;wrist=.15*np.sin(t*5)*e
                    setv('Param62',arm*.96);setv('Param59',.15*e);setv('Param60',forearm*.85);setv('Param61',-wrist)
                    setv('PositionY',(-3.5-2*beats)*e);setv('AngleY',(-4-2*beats)*e)
                if family=='refuse':arm=.42*strength*e;forearm=.5*e;wrist=.25*np.sin(t*4)*e
                setv('Param36',arm);setv('Param39',.12*e);setv('Param41',forearm);setv('Param42',wrist)
                for id in ['ParamEyeLOpen','ParamEyeROpen']:setv(id,1)
                if mood=='happy':setv('ParamMouthForm',.5*e)
                if mood=='angry':face[:,0]=.4;setv('ParamBrowLY',-.4*e);setv('ParamBrowRY',-.4*e)
                if family in ['wave','cheer'] and values[:,index['Param36']].max()<.3:raise AssertionError('fractional arm movement was lost')
                clipid=f'body-{family}-{number:02}-v{variant}';split='validation' if number==0 else 'test' if number==1 else 'train'
                clip={'id':clipid,'scenario':f'body-{family}-{number:02}','text':text,'context':context,'split':split,'emotion':mood,'intent':family,'audio':audio['file'],'audio_sha256':audio['sha256'],
                  'duration_ms':audio['duration_ms'],'hz':20,'initial':values[0].tolist(),'values':np.clip(values,lo,hi).round(5).tolist(),'face':face.tolist(),'eye':0,'hold_ms':3000,'intensity':strength,'source':'synthetic_continuous_body_demonstration','sampling_weight':5,'human_review':'pending_body_review'}
                base.write(OUT/'clips'/f'{clipid}.json',clip)
                items.append({k:clip[k] for k in ['id','scenario','text','context','emotion','intent','split','audio','audio_sha256','duration_ms','intensity']})
            print(json.dumps({'family':family,'caption':number+1,'total':60}),flush=True)
    base.write(OUT/'manifest.json',{'seed':93041,'profile_sha256':profile['sha256'],'human_calibrated':False,'base_dataset_sha256':base.sha(OLD/'manifest.json'),'items':items,'body_supplement':240})
    base.write(OUT/'review/status.json',{'human_calibrated':False,'promotion_allowed':False,'purpose':'body motion candidate demonstration'})
if __name__=='__main__':build()
