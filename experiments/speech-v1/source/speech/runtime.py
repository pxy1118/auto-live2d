import importlib.util
import os
import re
import sys
import time
import uuid
from pathlib import Path
from speech.config import ROOT,AUDIO,settings,read,write,sha,local_path
from speech.lips import mouth_envelope


class Voice:
    def __init__(self,device='cuda'):
        self.config=settings();self.device=device
        checkpoint=local_path(self.config['checkpoint']);repo=local_path(self.config['repository'])
        source=read(ROOT/'speech/model-source.json')
        for entry in source['files']:
            if sha(checkpoint/entry['file'])!=entry['sha256']:raise ValueError('TTS checkpoint changed: '+entry['file'])
        sys.path.insert(0,str(repo));os.environ['HF_HUB_OFFLINE']='1';os.environ['TRANSFORMERS_OFFLINE']='1'
        import torch,transformers,soundfile,numpy
        from qwen_tts import Qwen3TTSModel
        torch.set_num_threads(4)
        if device=='cuda' and not torch.cuda.is_available():raise RuntimeError('CUDA unavailable')
        attention='flash_attention_2' if device=='cuda' and importlib.util.find_spec('flash_attn') else 'sdpa'
        self.model=Qwen3TTSModel.from_pretrained(str(checkpoint),device_map='cuda:0' if device=='cuda' else 'cpu',
            dtype=torch.bfloat16 if device=='cuda' else torch.float32,attn_implementation=attention,local_files_only=True)
        if self.config['speaker'] not in self.model.get_supported_speakers():raise ValueError('Trained speaker missing')
        self.source=source;self.environment={'torch':torch.__version__,'transformers':transformers.__version__,'soundfile':soundfile.__version__,'numpy':numpy.__version__,'attention':attention,'device':device}
        AUDIO.mkdir(parents=True,exist_ok=True)

    def info(self):
        return {'ready':True,'model':'Qwen3-TTS-12Hz-1.7B / fine-tuned','speaker':self.config['speaker'],'language':self.config['language'],
                'max_text_length':self.config['max_text_length'],'checkpoint_sha256':self.source['files'][0]['sha256'],
                'mouth_method':'audio_rms_v1','streaming':False,'environment':self.environment}

    def synthesize(self,text,language=None,seed=41):
        import numpy as np,soundfile as sf,torch
        if not isinstance(text,str) or not 0<len(text.strip())<=self.config['max_text_length']:raise ValueError('台词需为 1～300 字')
        language=language or self.config['language']
        if not isinstance(language,str) or language.lower() not in [x.lower() for x in self.model.get_supported_languages()]:raise ValueError('不支持的语种')
        if isinstance(seed,bool) or not isinstance(seed,int) or not 0<=seed<2**31:raise ValueError('Invalid seed')
        begin=time.perf_counter();torch.manual_seed(seed)
        waves,sr=self.model.generate_custom_voice(text=text.strip(),speaker=self.config['speaker'],language=language,
            non_streaming_mode=True,max_new_tokens=min(1024,max(128,len(text)*7+96)))
        wave=np.asarray(waves[0],dtype=np.float32).reshape(-1)
        if not np.isfinite(wave).all() or not len(wave) or not .15<len(wave)/sr<=self.config['max_audio_seconds']:raise ValueError('生成音频的时长或数据异常')
        if np.max(np.abs(wave))<.001:raise ValueError('生成的语音为空或接近静音')
        key=uuid.uuid4().hex;file=AUDIO/(key+'.wav');sf.write(file,wave,sr,subtype='PCM_16')
        # Derive cues from the exact PCM waveform served to the browser.
        pcm,actual_sr=sf.read(file,dtype='float32');envelope=mouth_envelope(pcm,actual_sr)
        result={'speech_id':key,'audio_url':'/api/speech/audio/'+key+'.wav','sample_rate':actual_sr,'duration_ms':envelope['duration_ms'],
                'mouth':envelope,'speaker':self.config['speaker'],'text':text.strip(),'language':language,'seed':seed,
                'audio_sha256':sha(file),'checkpoint_sha256':self.info()['checkpoint_sha256'],'synthesis_ms':round((time.perf_counter()-begin)*1000,2),
                'peak':float(np.abs(pcm).max())}
        write(AUDIO/(key+'.json'),result)
        # Only remove this service's own generated UUID artifacts; never model or user assets.
        old=sorted((p for p in AUDIO.glob('*.wav') if re.fullmatch(r'[0-9a-f]{32}\.wav',p.name)),key=lambda p:p.stat().st_mtime,reverse=True)
        for p in old[20:]:
            p.unlink();p.with_suffix('.json').unlink(missing_ok=True)
        return result
