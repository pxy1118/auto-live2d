"""Run with the character page open and its sound enabled once."""
import argparse,json,urllib.request,urllib.error,sys

if hasattr(sys.stdout,'reconfigure'):sys.stdout.reconfigure(encoding='utf-8')

parser=argparse.ArgumentParser();parser.add_argument('--url',default='http://127.0.0.1:8765');parser.add_argument('--text',default='大家晚上好，我是大肥鱼。很高兴又见到你。')
parser.add_argument('--context',default='直播开始，正常问候观众。');parser.add_argument('--voice-only',action='store_true');parser.add_argument('--prepare-only',action='store_true');parser.add_argument('--speech-id')
parser.add_argument('--full',action='store_true',help='先合成完整 WAV 再播放；CPU/原始后端使用此选项')
args=parser.parse_args()
def post(path,data):
    request=urllib.request.Request(args.url+path,json.dumps(data,ensure_ascii=False).encode(),{'Content-Type':'application/json'})
    with urllib.request.urlopen(request,timeout=180) as response:return json.load(response)
try:
    key=args.speech_id
    payload={'text':args.text,'context':args.context,'style':'lively','kind':'regression','with_motion':not args.voice_only}
    if not key and not args.prepare_only and not args.full:
        request=urllib.request.Request(args.url+'/api/speech/perform',json.dumps(payload,ensure_ascii=False).encode(),{'Content-Type':'application/json'})
        complete=False
        with urllib.request.urlopen(request,timeout=180) as response:
            for line in response:
                event=json.loads(line)
                if event['type']=='error':raise RuntimeError(event['error'])
                if event['type']=='end':complete=True
                print(json.dumps({k:v for k,v in event.items() if k in ['type','speech_id','chunk','buffered_ms','first_chunk_ms','first_audio_ms','duration_ms','synthesis_ms','audio_url']},ensure_ascii=False),flush=True)
        if not complete:raise RuntimeError('语音流中断，未收到完成标记')
        raise SystemExit(0)
    if not key:
        prepared=post('/api/speech/prepare',payload)
        key=prepared['speech_id'];print(json.dumps({'speech_id':key,'duration_ms':prepared['duration_ms'],'synthesis_ms':prepared['synthesis_ms'],'audio_url':args.url+prepared['audio_url']},ensure_ascii=False))
    if not args.prepare_only:print(json.dumps(post('/api/speech/execute',{'speech_id':key}),ensure_ascii=False))
except urllib.error.HTTPError as error:
    print(error.read().decode('utf-8'))
    if key:print('启用网页声音后，可重试：python examples/speak_demo.py --speech-id '+key)
    raise SystemExit(1)
except KeyboardInterrupt:
    print('已取消语音。');raise SystemExit(130)
