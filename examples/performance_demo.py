"""Example upstream client. Enable browser audio before calling this script."""
import argparse,json,time,urllib.request

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--text',default='大家晚上好。你突然这样夸我，我有点不好意思啦。');parser.add_argument('--context',default='和观众日常聊天');parser.add_argument('--action',choices=['wave','chest','grass','point','thanks','explain','refuse','lean','sway','nod','tilt','turn','cajole']);parser.add_argument('--strength',type=float,default=1.);parser.add_argument('--glasses',choices=['none','black','monocle']);parser.add_argument('--base',default='http://127.0.0.1:8765');args=parser.parse_args()
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
    def command(method,params=None):
        import uuid
        request=urllib.request.Request(args.base+'/api/command',json.dumps({'method':method,'params':params or {},'request_id':uuid.uuid4().hex},ensure_ascii=False).encode(),{'Content-Type':'application/json'})
        with opener.open(request,timeout=30) as response:return json.load(response)['result']
    if args.glasses:command('appearance.update',{'glasses':args.glasses})
    session=command('performance.start',{'context':args.context});sid=session['session_id'];seq=0
    if args.action:command('performance.direct',{'session_id':sid,'clause':0,'action_id':args.action,'action_strength':args.strength,'action_hold_ms':1400})
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
