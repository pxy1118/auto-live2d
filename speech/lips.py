"""A 60 Hz RMS envelope from the actual waveform, independent of text timing."""
import numpy as np

def mouth_envelope(audio,sample_rate,hz=60):
    wave=np.asarray(audio,dtype=np.float64)
    if wave.ndim==2:wave=wave.mean(axis=1)
    if wave.ndim!=1 or not wave.size or not np.isfinite(wave).all() or sample_rate<8000:raise ValueError('Invalid waveform')
    duration=len(wave)/sample_rate
    times=np.arange(int(np.ceil(duration*hz))+1)/hz
    center=np.minimum((times*sample_rate).astype(int),len(wave));half=round(sample_rate*.015)
    cumulative=np.r_[0.,np.cumsum(wave*wave)]
    left=np.maximum(0,center-half);right=np.minimum(len(wave),center+half)
    rms=np.sqrt((cumulative[right]-cumulative[left])/np.maximum(1,right-left))
    floor=.006;reference=max(.04,float(np.percentile(rms,95)))
    targets=.85*np.clip((rms-floor)/max(.01,reference-floor),0,1)**.65
    smooth=np.zeros_like(targets)
    for i in range(1,len(targets)):
        tau=.025 if targets[i]>smooth[i-1] else .055
        smooth[i]=smooth[i-1]+(1-np.exp(-1/(hz*tau)))*(targets[i]-smooth[i-1])
    smooth[-1]=0
    return {'method':'audio_rms_v1','hz':hz,'duration_ms':round(duration*1000,3),'values':np.round(smooth,5).tolist(),
            'parameter':'ParamMouthOpenY','maximum':.85,'noise_gate_rms':floor}
