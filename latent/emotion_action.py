"""Emotion classification + the existing 0.8B motion model, without a 4B branch."""
import json,time
import numpy as np
from common import ROOT
from emotion import EmotionClassifier,emotion_spans,emotion_inputs,GROUPS
from streaming import StreamingPolicy,EMOTIONS

class EmotionActionPolicy(StreamingPolicy):
    def __init__(self,encoder,experiment=None,emotion_device=None):
        super().__init__(encoder,experiment,planner_device=encoder.device)
        self.emotion_classifier=None;self.emotion_device=str(encoder.device if emotion_device is None else emotion_device);self.plan_calls=0;self.emotion_batches=0;self.motion_updates=0
    def load(self):
        folder=self.folder();path=folder/'run.json'
        if self.emotion_classifier is not None and self.loaded==(str(folder),path.stat().st_mtime_ns):return
        run=json.loads(path.read_text(encoding='utf-8-sig'))
        if run.get('performance_planner',{}).get('architecture')!='ensemble' or not run.get('emotion_classifier') or run.get('body_planner'):
            raise ValueError('当前服务只运行情感分类与轻量动作方案，不加载 4B 分支')
        super().load()
        if self.emotion_classifier is None:self.emotion_classifier=EmotionClassifier(ROOT/run['emotion_classifier']['source'],self.emotion_device)
    def info(self):
        result=super().info();result.update(driver='emotion_action',uses_4b=False)
        result['execution']['emotion_device']=self.emotion_device
        result['execution']['action_encoder']='Qwen3.5-0.8B'
        result['runtime_counts']={'plan_calls':self.plan_calls,'emotion_batches':self.emotion_batches,'motion_updates':self.motion_updates}
        result['emotion_classifier']=self.emotion_classifier.info() if self.emotion_classifier else None
        result['emotion_policy']={'schema':'emotion.timeline.v1','observations':'quote-aware phrases with causal left context','temporal_owner':'browser audio clock','preserves_multi_label_scores':True}
        return result
    def prefill(self,data):
        begin=time.perf_counter();self.load();text=data.get('text');context=data.get('context','')
        if not isinstance(text,str) or not 0<len(text)<=240 or not isinstance(context,str) or len(context)>1200:raise ValueError('台词或语境长度不合法')
        emotion_context=data.get('emotion_context','')
        if not isinstance(emotion_context,str) or len(emotion_context)>240:raise ValueError('情绪前文不合法')
        spans=data.get('clauses') or [{'clause':0,'text':text,'start':0,'end':len(text)}]
        previous=-1
        for span in spans:
            start,end=span.get('start'),span.get('end')
            if not isinstance(start,int) or not isinstance(end,int) or start<0 or end<=start or end>len(text) or start<=previous or text[start:end].strip()!=span.get('text') or not isinstance(span.get('clause'),int):raise ValueError('语义分段与原文不匹配')
            previous=start
        # Warm the shared continuous-motion representation once for this audio unit.
        _,_,motor_info=self.semantic(text,context)
        observations=emotion_spans(text)
        observation_inputs=emotion_inputs(text,observations,emotion_context)
        classified=self.emotion_classifier.classify_many([span['text'] for span in spans]+observation_inputs)
        emotions=classified[:len(spans)];signals=classified[len(spans):];self.emotion_batches+=1;plans=[]
        timeline={'schema':'emotion.timeline.v1','points':[
            {**span,'window_text':window,'start_fraction':span['start']/len(text),'weights':affect['weights'],'tension':affect['tension'],'probabilities':affect['scores']}
            for span,window,affect in zip(observations,observation_inputs,signals)]}
        for i,(span,affect) in enumerate(zip(spans,emotions)):
            history=[row['text'] for row in spans[max(0,i-2):i]]
            scoped='\n'.join([context,*history]).strip()[-1200:]
            feature,mask,_=self.semantic(span['text'],scoped)
            plan=self.plan(feature,mask,data.get('planner_state'),span['text'],scoped);self.plan_calls+=1
            plan.update(emotion=affect['emotion'],expressions=affect['expressions'],emotion_threshold=affect['threshold'],affect_strength=affect['strength'])
            plan['confidence']['emotion']=affect['probability']
            plans.append({**span,'start_fraction':span['start']/max(1,len(text)),'performance_plan':plan,'affect':affect})
        return {'ready':True,'semantic_ms':(time.perf_counter()-begin)*1000,'context_truncated':motor_info.get('context_truncated',False),'performance_plans':plans,'affect_timeline':timeline,
                'planner_timing':{'emotion':self.emotion_classifier.last_timing,'action_encoder':motor_info,'total_ms':(time.perf_counter()-begin)*1000}}
    def predict(self,data):
        self.load();self.motion_updates+=1;value=dict(data);value['include_plan']=False
        director=value.get('director',[0.]*9);affect=value.get('affect')
        if not director[8] and affect and 'weights' in affect:
            weights=affect['weights']
            if not isinstance(weights,dict) or set(weights)!=set(GROUPS):raise ValueError('连续情绪维度不合法')
            values=[float(weights[name]) for name in GROUPS]
            if not all(np.isfinite(v) and 0<=v<=1 for v in values) or sum(values)>1.00001:raise ValueError('连续情绪强度不合法')
            guide=[0.]*9
            for name in GROUPS:guide[EMOTIONS.index(name)]=float(weights[name])
            guide[7]=max(values);guide[8]=1. if guide[7]>.001 else 0.
            value['director']=guide
        elif not director[8] and affect and affect.get('emotion') in EMOTIONS and affect.get('emotion')!='neutral':
            intensity=float(affect.get('strength',0))
            if not np.isfinite(intensity) or not 0<=intensity<=1:raise ValueError('情绪强度不合法')
            guide=[0.]*9;guide[EMOTIONS.index(affect['emotion'])]=intensity;guide[7]=intensity;guide[8]=1.
            value['director']=guide
        return super().predict(value)
