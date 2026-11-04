"""Example upstream client. Enable browser audio before calling this script."""
import argparse,json,time,urllib.request

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--text',default='大家晚上好。你突然这样夸我，我有点不好意思啦。');parser.add_argument('--context',default='和观众日常聊天');parser.add_argument('--kind',choices=['regression','flow'],default='regression');parser.add_argument('--gesture',choices=['wave','chest','grass','point','thanks','explain','refuse']);parser.add_argument('--body-motion',choices=['lean','sway','nod','tilt','turn','cajole']);parser.add_argument('--body-strength',type=float,default=.75);parser.add_argument('--glasses',choices=['none','black','monocle']);parser.add_argument('--base',default='http://127.0.0.1:8765');args=parser.parse_args()
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
    def command(method,params=None):
        import uuid
        request=urllib.request.Request(args.base+'/api/command',json.dumps({'method':method,'params':params or {},'request_id':uuid.uuid4().hex},ensure_ascii=False).encode(),{'Content-Type':'application/json'})
        with opener.open(request,timeout=30) as response:return json.load(response)['result']
    if args.glasses:command('appearance.update',{'glasses':args.glasses})
    session=command('performance.start',{'context':args.context,'kind':args.kind});sid=session['session_id'];seq=0
    if args.gesture or args.body_motion:command('performance.direct',{'session_id':sid,'clause':0,**({'gesture':args.gesture,'gesture_hold_ms':1400} if args.gesture else {}),**({'body_motion':args.body_motion,'body_strength':args.body_strength,'body_hold_ms':2200} if args.body_motion else {})})
    try:
        for offset in range(0,len(args.text),8):
            command('performance.append',{'session_id':sid,'seq':seq,'text':args.text[offset:offset+8]});seq+=1;time.sleep(.1)
        command('performance.finish',{'session_id':sid,'seq':seq})
        while True:
            state=command('performance.state');print(json.dumps({'phase':state['queue']['phase'],'clause':state['clause'],'media_ms':state['media_ms']},ensure_ascii=False),flush=True)
            if state['queue']['phase'] in ['finished','error','cancelled']:break
            time.sleep(.5)
    except BaseException:
        command('performance.cancel',{'session_id':sid});raise
if __name__=='__main__':main()
