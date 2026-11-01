"""Causal speech energy and sparse emphasis cues, measured from served PCM.

These are playback features, not phoneme alignment or a trained gesture model.
State survives codec chunks, so chunk boundaries never close the mouth or nod.
"""
import numpy as np


class SpeechFeatures:
    hz=60

    def __init__(self):
        self.tail=np.zeros(0,dtype=np.float32)
        self.mouth=0.;self.activity=0.;self.accent=0.;self.reference=.06
        self.last_beat=-100.;self.time=0.

    def push(self,pcm,sr):
        wave=np.asarray(pcm,dtype=np.float32).reshape(-1)
        if not wave.size or not np.isfinite(wave).all():raise ValueError('Invalid PCM chunk')
        duration=wave.size/sr;count=int(np.ceil(duration*self.hz))+1
        context=np.r_[self.tail,wave];base=len(self.tail)
        power=np.r_[0.,np.cumsum(context.astype(np.float64)**2)]
        values=[];energy=[];beats=[]
        for i in range(count):
            at=min(duration,i/self.hz);right=base+round(at*sr)
            left=max(0,right-round(sr*.03))
            rms=float(np.sqrt((power[right]-power[left])/max(1,right-left)))
            self.reference=max(.04,self.reference*.997,rms*.9)
            target=float(np.clip((rms-.006)/max(.01,self.reference-.006),0,1))
            dt=0 if i==0 else min(1/self.hz,max(0,at-(i-1)/self.hz))
            previous=self.activity
            self.activity+=(1-np.exp(-dt/.14))*(target-self.activity)
            # At most one emphasis every 550 ms; silence cannot cause a beat.
            if target>max(.3,previous+.17) and self.time+at-self.last_beat>=.55:
                self.accent=min(1.,target);self.last_beat=self.time+at
            self.accent*=np.exp(-dt/.15)
            mouth_target=.85*target**.65
            tau=.025 if mouth_target>self.mouth else .055
            self.mouth+=(1-np.exp(-dt/tau))*(mouth_target-self.mouth)
            values.append(round(self.mouth,5));energy.append(round(self.activity,5));beats.append(round(self.accent,5))
        self.tail=context[-round(sr*.03):].copy();self.time+=duration
        return {'method':'audio_causal_v2','hz':self.hz,'duration_ms':round(duration*1000,3),
                'values':values,'energy':energy,'beats':beats,'parameter':'ParamMouthOpenY','maximum':.85}
