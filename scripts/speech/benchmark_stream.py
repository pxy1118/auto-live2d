"""Time the live worker and verify every streamed PCM sample against saved WAV."""
import json
from pathlib import Path
import sys
import time
import urllib.request
import base64
import numpy as np
import soundfile as sf

ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT))
from speech.config import AUDIO


if __name__=='__main__':
    cases=[]
    for text in ['大家晚上好，我是大肥鱼。很高兴又见到你。','今天想和大家聊一聊开心的事情。先坐好，听我慢慢说。遇到困难也别着急，我们一起想办法，好不好？']:
        for repeat in range(3):
            request=urllib.request.Request('http://127.0.0.1:8769/stream',json.dumps({'text':text,'seed':41}).encode(),{'Content-Type':'application/json'})
            begin=time.perf_counter();parts=[];offset=0;first=None;boundaries=[];result=None
            with urllib.request.urlopen(request,timeout=180) as response:
                for line in response:
                    event=json.loads(line)
                    if event['type']=='error':raise RuntimeError(event['error'])
                    if event['type']=='chunk':
                        elapsed=(time.perf_counter()-begin)*1000
                        if first is None:first=elapsed
                        assert event['offset_samples']==offset and event['index']==len(parts)
                        raw=base64.b64decode(event['pcm16_base64']);assert len(raw)==event['samples']*2
                        if offset:boundaries.append(offset)
                        parts.append(raw);offset+=event['samples']
                    if event['type']=='end':result=event
            assert result is not None and offset==result['total_samples']
            pcm=np.frombuffer(b''.join(parts),dtype='<i2')
            saved,sr=sf.read(AUDIO/(result['speech_id']+'.wav'),dtype='int16')
            assert np.array_equal(saved,pcm),'The reviewed WAV must contain exactly the streamed PCM'
            difference=np.abs(np.diff(pcm.astype(float)/32768))
            seams=[float(difference[b-1]) for b in boundaries]
            case={'text':text,'repeat':repeat,'first_pcm_ms':round(first,2),'worker_first_audio_ms':result['first_audio_ms'],
                  'synthesis_ms':result['synthesis_ms'],'duration_ms':result['duration_ms'],'chunks':result['chunks'],
                  'audio_url':result['audio_url'],'audio_sha256':result['audio_sha256'],'pcm_exact_match':True,
                  'boundary_jumps':seams,'all_sample_jump_p99':float(np.percentile(difference,99)),
                  'all_sample_jump_max':float(difference.max()),'boundary_jump_max':max(seams,default=0)}
            print(json.dumps(case,ensure_ascii=False),flush=True);cases.append(case)
    destination=ROOT/'test-results/speech-v2/stream-benchmark.json'
    destination.write_text(json.dumps({'cases':cases},ensure_ascii=False,indent=2),encoding='utf-8')
