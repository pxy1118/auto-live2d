"""History/audio conditioned continuous Live2D policy, isolated from frozen v3."""
from pathlib import Path
from functools import lru_cache
import hashlib,json,time
import numpy as np
import torch
from torch import nn
from motor_gate import MotorGate

ROOT=Path(__file__).resolve().parents[1]
PROFILE=ROOT/'datasets/vtuber-v4/profile.json'
RUN=ROOT/'experiments/vtuber-v4'
EMOTIONS=['neutral','happy','angry','shy','sad','surprised','confused']
FACES=['黑脸','流泪','脸红','加载','兔牙','流冷汗']
EYES=['normal','＞＜','圈圈眼','爱心眼','屑屑眼']

class StreamingExpert(nn.Module):
    def __init__(self,dim,kind='regression',width=128):
        super().__init__();self.dim=dim;self.kind=kind
        self.semantic=nn.Linear(1024,width)
        self.history=nn.Linear(dim,width)
        self.state=nn.Linear(dim,width)
        self.audio=nn.Linear(13,width)
        self.director=nn.Linear(9,width)
        self.affect=nn.Linear(12,width)
        self.query=nn.Parameter(torch.randn(24,width)*.02)
        self.position=nn.Parameter(torch.randn(20,width)*.02)
        block=nn.TransformerDecoderLayer(width,4,width*3,dropout=.05,batch_first=True,norm_first=True)
        self.decoder=nn.TransformerDecoder(block,2,norm=nn.LayerNorm(width))
        self.action=nn.Linear(width,dim)
        self.face=nn.Linear(width,len(FACES)+1)
        self.eye=nn.Linear(width,len(EYES))
        self.emotion=nn.Linear(width,len(EMOTIONS))
        self.hold=nn.Linear(width,1)
        if kind=='flow':self.noisy=nn.Linear(dim,width);self.time=nn.Linear(1,width)
    def forward(self,semantic,mask,state,history,audio,audio_mask,director,noisy=None,time=None,face_state=None):
        if face_state is None:face_state=state.new_zeros(len(state),12)
        memory=torch.cat([self.semantic(semantic),self.history(history)+self.position[None],self.state(state)[:,None],(self.director(director)+self.affect(face_state))[:,None]],1)
        padding=torch.cat([mask,torch.zeros(len(state),22,device=state.device,dtype=torch.bool)],1)
        query=self.query[None]+self.audio(torch.cat([audio*audio_mask[:,:,None],audio_mask[:,:,None]],-1))
        if self.kind=='flow':query=query+self.noisy(noisy)+self.time(time[:,None])[:,None]
        h=self.decoder(query,memory,memory_key_padding_mask=padding)
        actions=self.action(h)
        if self.kind=='regression':actions=actions.tanh()
        pooled=h.mean(1)
        return actions,self.face(pooled).sigmoid(),self.eye(pooled),self.emotion(pooled),self.hold(pooled).sigmoid().squeeze(-1)
    @torch.inference_mode()
    def sample(self,*args,seed=41,face_state=None):
        if self.kind=='regression':return self(*args,face_state=face_state)
        g=torch.Generator(device=args[2].device).manual_seed(seed)
        x=torch.randn(len(args[2]),24,self.dim,device=args[2].device,generator=g)
        for i in range(4):
            result=self(*args,noisy=x,time=torch.full((len(x),),i/4,device=x.device),face_state=face_state);x=x+result[0]/4
        return (x,*result[1:])

class StreamingPolicy:
    def __init__(self,encoder):self.encoder=encoder;self.loaded=None;self.models={}
    def folder(self):
        config=ROOT/'latent/stream-run.json'
        path=(ROOT/json.loads(config.read_text(encoding='utf-8'))['path']).resolve() if config.exists() else RUN
        if not path.is_relative_to(ROOT/'experiments'):raise ValueError('候选实验必须位于 experiments 内')
        return path
    def info(self):
        path=self.folder()/'run.json'
        if not path.exists():return {'ready':False,'experimental':True,'reason':'v4 检查点尚未训练','promoted':False}
        run=json.loads(path.read_text(encoding='utf-8'))
        return {'ready':True,'experimental':True,'promoted':False,'stage':run.get('stage'),'models':list(run['models']),
                'sampling_hz':20,'horizon_ms':1200,'update_ms':400,'run':run}
    def load(self):
        folder=self.folder();path=folder/'run.json';fingerprint=(str(folder),path.stat().st_mtime_ns)
        if fingerprint==self.loaded:return
        self.profile=json.loads(PROFILE.read_text(encoding='utf-8'));self.meta=self.profile['channels']
        self.run=json.loads(path.read_text(encoding='utf-8'));self.models={}
        self.motor_gate=None
        if self.run['profile_sha256']!=self.profile['sha256']:raise ValueError('v4 profile 指纹不匹配')
        for kind,item in self.run['models'].items():
            file=folder/item['checkpoint']
            if hashlib.sha256(file.read_bytes()).hexdigest()!=item['sha256']:raise ValueError('v4 权重指纹不匹配')
            saved=torch.load(file,map_location='cpu',weights_only=True)
            if saved.get('profile_sha256')!=self.profile['sha256']:raise ValueError('v4 检查点通道契约不匹配')
            m=StreamingExpert(len(self.meta),kind);m.load_state_dict(saved['state_dict']);self.models[kind]=m.to(self.encoder.device).eval()
        if self.run.get('motor_gate'):
            item=self.run['motor_gate'];file=folder/item['checkpoint']
            if hashlib.sha256(file.read_bytes()).hexdigest()!=item['sha256']:raise ValueError('语义动作门控指纹不匹配')
            self.motor_gate=MotorGate().to(self.encoder.device).eval();self.motor_gate.load_state_dict(torch.load(file,map_location=self.encoder.device,weights_only=True))
        self.loaded=fingerprint
    @lru_cache(maxsize=96)
    def semantic(self,text,context):
        original=len(context)
        while True:
            try:
                h,m,info=self.encoder.encode(text,context,'natural')
                return h,m,{**info,'context_truncated':len(context)!=original,'context_chars_used':len(context)}
            except ValueError as error:
                if '512 token' not in str(error) or not context:raise
                context=context[min(64,len(context)):]
    def prefill(self,data):
        begin=time.perf_counter();self.load();text=data.get('text');context=data.get('context','')
        if not isinstance(text,str) or not 0<len(text)<=240 or not isinstance(context,str) or len(context)>1200:raise ValueError('台词或语境长度不合法')
        _,_,info=self.semantic(text,context)
        motor_context=data.get('motor_context',context)
        if not isinstance(motor_context,str) or len(motor_context)>1200:raise ValueError('motor_context 不合法')
        self.semantic(text,motor_context)
        return {'ready':True,'semantic_ms':(time.perf_counter()-begin)*1000,'context_truncated':info['context_truncated']}
    def predict(self,data):
        begin=time.perf_counter();self.load();device=self.encoder.device
        text=data.get('text');context=data.get('context','')
        if not isinstance(text,str) or not 0<len(text)<=240 or not isinstance(context,str) or len(context)>1200:raise ValueError('台词或语境长度不合法')
        kind=data.get('kind','regression');seed=data.get('seed',41)
        if kind not in self.models or not isinstance(seed,int) or isinstance(seed,bool) or not 0<=seed<2**31:raise ValueError('kind/seed 不合法')
        feature,mask,semantic_info=self.semantic(text,context)
        motor_context=data.get('motor_context',context)
        if not isinstance(motor_context,str) or len(motor_context)>1200:raise ValueError('motor_context 不合法')
        motor_feature,motor_mask,_=self.semantic(text,motor_context)
        lo=np.array([p['min'] for p in self.meta]);hi=np.array([p['max'] for p in self.meta]);neutral=np.array([p['default'] for p in self.meta])
        def array(key,shape,default):
            a=np.asarray(data.get(key,default),dtype=np.float32)
            if a.shape!=shape or not np.isfinite(a).all():raise ValueError(key+' 形状或数值不合法')
            return a
        state=array('state',(len(lo),),neutral)
        history=np.asarray(data.get('history',[]),dtype=np.float32)
        if history.size==0:history=np.tile(state,(20,1))
        if history.ndim!=2 or history.shape[1]!=len(lo) or not 1<=len(history)<=20 or not np.isfinite(history).all():raise ValueError('history 不合法')
        history=np.r_[np.tile(history[0],(20-len(history),1)),history]
        audio=array('audio',(24,12),np.zeros((24,12)));available=array('audio_mask',(24,),np.zeros(24))
        director=array('director',(9,),np.zeros(9))
        if not director[8] and self.run.get('calibration'):
            preferences=self.run['calibration'].get('preferred_by_emotion')
            if preferences:director[:7]=[preferences[e] for e in EMOTIONS];director[7]=self.run['calibration']['preferred_intensity']
        face_state=array('face_state',(12,),np.zeros(12))
        norm=lambda v:np.clip(2*(v-lo)/(hi-lo)-1,-1,1)
        t=lambda a:torch.as_tensor(a,dtype=torch.float32,device=device)[None]
        with torch.inference_mode():
            raw,face,eye,emotion,hold=self.models[kind].sample(feature[None],mask[None],t(norm(state)),t(norm(history)),t(audio),t(available),t(director),seed=seed,face_state=t(face_state))
            motor_probability=float(self.motor_gate(motor_feature[None],motor_mask[None]).sigmoid()[0]) if self.motor_gate else 0.
        raw=raw[0].cpu().numpy()
        if not np.isfinite(raw).all():raise ValueError('v4 出现非有限预测')
        values=(np.clip(raw,-1,1)+1)/2*(hi-lo)+lo
        strengths=dict(zip(FACES,face[0,:len(FACES)].cpu().tolist()));idx=int(eye[0].argmax());confidence=float(eye[0].softmax(-1).max())
        if idx and confidence>=.6:strengths[EYES[idx]]=float(face[0,-1])
        # Classification confidence selects an eye type; intensity is separately regressed.
        idx_em=int(emotion[0].argmax());checkpoint=self.run['models'][kind]['sha256']
        return {'channels':[p['id'] for p in self.meta],'values':values.round(6).tolist(),'expressions':strengths,
                'motor_probability':motor_probability,'motor_threshold':self.run.get('motor_gate',{}).get('threshold',.8),
                'emotion':EMOTIONS[idx_em],'hold_ms':round(2000+float(hold[0])*4000),
                'timing':{'total_compute_ms':(time.perf_counter()-begin)*1000,'semantic_tokens':semantic_info['tokens'],'context_truncated':semantic_info['context_truncated']},'raw_out_of_range_fraction':float((np.abs(raw)>1).mean()),
                'provenance':{'source':'streaming_policy_v4','checkpoint_sha256':checkpoint,'kind':kind,'seed':seed,'stage':self.run.get('stage')}}
