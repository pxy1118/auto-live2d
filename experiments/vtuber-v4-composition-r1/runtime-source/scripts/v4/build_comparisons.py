"""Prepare 24 novel phrasing pairs. Labels are hidden in the public gallery."""
import hashlib,json,math,random,time,urllib.request,wave,os
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[2];DATA=ROOT/'datasets/vtuber-v4';OUT=DATA/'review/comparisons'
MODEL_PORT=int(os.environ.get('MODEL_PORT','8768'))
CASES=[
('你怎么又把我的东西藏起来了，快还给我！','被观众反复捉弄，这次是真的生气。'),
('算了，我先不和你说话了。','还在生气，黑脸应延续一段时间。'),
('他说他很生气，我倒觉得这件事还好。','平静转述，不是角色自己生气。'),
('我真的没有生气，你放心吧。','真诚澄清，平静友好，没有反讽。'),
('你这样夸得我都有点脸热了。','轻微害羞，稍微移开视线。'),
('别靠这么近，我，我真的不知道说什么了。','明显害羞，想躲开镜头。'),
('原来你一直都记得，我很高兴。','感动开心，害羞轻微。'),
('你可真是太贴心了，把我的计划全打乱了。','反讽，很生气；不要按字面夸奖处理。'),
('等等，一加一怎么会等于三呢？','困惑，想重新理清。'),
('我脑袋都绕晕了，你先慢一点。','明显混乱，可以使用圈圈眼。'),
('呀，不要再捏我的脸了！','害羞又慌张，可以使用 >< 眼。'),
('这次抽奖居然真的轮到我了！','惊喜开心，身体明显回应。'),
('事情已经过去了，我现在好多了。','从难过中恢复，逐渐放松。'),
('我花了很久准备，结果还是没能赶上。','失落难过。'),
('先看这边，我给你解释一下为什么。','解释观点，配合连续手臂动作。'),
('重点就是这里，你有没有看到？','向观众指出重点。'),
('这件事就交给我吧，我会认真完成。','自信地表达自己，可以抚胸。'),
('欢迎回来，今天过得怎么样？','轻松问候，动作有节制。'),
('你说什么？我刚才还真没反应过来。','突然惊讶后恢复。'),
('哈哈，我早就猜到你会这样说。','得意、调侃，可使用屑屑眼。'),
('这个礼物我很喜欢，谢谢你。','开心感谢，不需要强烈害羞。'),
('我只是念一下角色台词：不要惹我生气。','在平静地读引文，不代入生气。'),
('你看，我一点都不害羞。','真的自在，不是口是心非的傲娇。'),
('好啦，我们接着说下一件事。','普通过渡，不触发特殊表情或改变衣服。'),
]
def read(path):return json.loads(path.read_text(encoding='utf-8'))
def post(port,path,data):
    request=urllib.request.Request(f'http://127.0.0.1:{port}'+path,json.dumps(data,ensure_ascii=False).encode(),{'Content-Type':'application/json'})
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for i in range(60):
        try:
            with opener.open(request,timeout=180) as r:return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code!=429:raise
            time.sleep(.1)
    raise RuntimeError('worker remained busy')
def main():
    OUT.mkdir(parents=True,exist_ok=True);profile=read(DATA/'profile.json');meta=profile['channels'];neutral=[p['default'] for p in meta]
    private=[];public=[];rng=random.Random(7241)
    for index,(text,context) in enumerate(CASES):
        key=hashlib.sha256(text.encode()).hexdigest()[:20];audio=DATA/'audio'/f'blind-{key}.wav';audio.parent.mkdir(exist_ok=True)
        if not audio.exists():
            info=post(8769,'/synthesize',{'text':text,'seed':41});audio.write_bytes((ROOT/'.runtime/speech/audio'/f"{info['speech_id']}.wav").read_bytes())
        with wave.open(str(audio),'rb') as f:duration=f.getnframes()/f.getframerate()
        # Reuse the identical causal feature extraction as real streaming.
        import sys;sys.path.insert(0,str(ROOT));from speech.features import SpeechFeatures
        with wave.open(str(audio),'rb') as f:pcm=np.frombuffer(f.readframes(f.getnframes()),dtype='<i2').astype(np.float32)/32768;sr=f.getframerate()
        features=SpeechFeatures().push(pcm,sr);times=np.array(features['motion_times_ms']);af=np.array(features['motion']);n=math.ceil(duration*20)
        values=[];faces=[];eyes=[];state=neutral[:];history=[neutral[:]]*20;face_state=[0.]*12;face_state[7]=1
        for start in range(0,n,8):
            positions=np.maximum(0,np.searchsorted(times,(start+np.arange(24))*50,side='right')-1);available=((start+np.arange(24))*50<=duration*1000).astype(float)
            prediction=post(MODEL_PORT,'/stream/predict',{'text':text,'context':context,'kind':'regression','seed':41,'state':state,'history':history[-20:],
                'audio':af[np.minimum(positions,len(af)-1)].tolist(),'audio_mask':available.tolist(),'face_state':face_state})
            chunk=np.array(prediction['values']);offset=np.array(state)-chunk[0];chunk+=offset[None]*np.maximum(0,1-np.arange(24)/3)[:,None]
            strengths=prediction['expressions'];face=[strengths.get(name,0) for name in ['黑脸','流泪','脸红','加载','兔牙','流冷汗']]
            special=[strengths.get(name,0) for name in ['＞＜','圈圈眼','爱心眼','屑屑眼']];eye=int(np.argmax(special))+1 if max(special)>.1 else 0;face.append(max(special) if eye else 0)
            count=min(8,n-start);values.extend(chunk[:count].tolist());faces.extend([face]*count);eyes.extend([eye]*count);state=values[-1];history.extend(values[-count:]);face_state=[*face,*[float(i==eye) for i in range(5)]]
        v4={'channels':[p['id'] for p in meta],'values':values,'face':faces,'eye':eyes,'mouth':features['values'],'images':True}
        v3=post(MODEL_PORT,'/predict',{'text':text,'context':context,'kind':'regression','style':'natural','seed':41})['command'];scale=duration*1000/v3['params']['duration_ms']
        for event in v3['params']['events']:
            event['at_ms']*=scale
            if 'duration_ms' in event.get('params',{}):event['params']['duration_ms']*=scale
        v3['params']['duration_ms']=duration*1000
        baseline={'channels':[],'values':[[]]*n,'trajectory':v3,'mouth':features['values'],'images':True}
        order=[('v4-regression',v4),('v3',baseline)];rng.shuffle(order);clips=[];mapping=[]
        for letter,(kind,params) in zip(['A','B'],order):
            name=f'{index:02}-{letter}';(OUT/(name+'.json')).write_text(json.dumps(params,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
            clips.append({'media':'comparisons/'+name+'.webp','audio':str(audio.relative_to(DATA)).replace('\\','/')});mapping.append({'label':letter,'model':kind})
        public.append({'text':text,'context':context,'clips':clips});private.append({'index':index,'models':mapping})
        print(json.dumps({'prepared':index+1,'total':24}),flush=True)
    (DATA/'review/comparison-pairs.json').write_text(json.dumps(public,ensure_ascii=False),encoding='utf-8')
    target=ROOT/'experiments/vtuber-v4/blind-key.json';target.write_text(json.dumps(private,ensure_ascii=False,indent=2),encoding='utf-8')
if __name__=='__main__':main()
