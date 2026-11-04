import hashlib,json,random,shutil,time
from pathlib import Path
import numpy as np
import torch
from torch.nn import functional as F
from encoder import SemanticEncoder
from motor_gate import MotorGate
from streaming import ROOT

DATA=ROOT/'datasets/vtuber-v4-body-float';BASE=ROOT/'experiments/vtuber-v4-body-float';OUT=ROOT/'experiments/vtuber-v4-restrained'
GENERIC_POS={'wave':{1},'explain':set(),'point':{3,8},'chest':set(),'cheer':{0,1,2,4},'refuse':{4}}
NARRATIVE={'wave':'直播开始，热情地欢迎观众。','explain':'重要讲解，需要配合一次手势帮助理解。','point':'强调一个关键细节，希望观众注意。','chest':'真诚地表达承诺，配合一次抚胸动作。','cheer':'刚刚获得胜利，情绪特别激动。','refuse':'对方越界，认真阻止对方继续。'}
def read(p):return json.loads(p.read_text(encoding='utf-8'))
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
    if (OUT/'run.json').exists():raise RuntimeError('拒绝覆盖已有候选')
    OUT.mkdir(parents=True,exist_ok=True);torch.set_num_threads(4);torch.manual_seed(8641)
    records={}
    for item in read(DATA/'manifest.json')['items']:
        active=item['id'].startswith('body-');text=item['text'];context=item['context'];split=item['split']
        records[(text,context)]=(split,int(active))
        if active:
            _,family,number,_=item['id'].split('-');number=int(number)
            records[(text,'和观众自然聊天。')]=(split,int(number in GENERIC_POS[family]))
            records[(text,NARRATIVE[family])]=(split,1)
        else:records.setdefault((text,'和观众自然聊天。'),(split,0))
    encoder=SemanticEncoder('cuda');cached=torch.load(BASE/'semantic-cache.pt',weights_only=True)['features'];rows=[]
    for i,((text,context),(split,label)) in enumerate(records.items()):
        key=text+'\n'+context
        if key in cached:h,m=cached[key]
        else:h,m,_=encoder.encode(text,context,'natural');h=h.cpu();m=m.cpu()
        rows.append((h,m,split,label,text,context))
    del encoder;torch.cuda.empty_cache();device='cuda'
    tensors={}
    for split in ['train','validation','test']:
        subset=[r for r in rows if r[2]==split];tensors[split]=(torch.stack([r[0] for r in subset]).to(device),torch.stack([r[1] for r in subset]).to(device),torch.tensor([r[3] for r in subset],dtype=torch.float32,device=device))
    model=MotorGate().to(device);x,m,y=tensors['train'];pooled=(x*(~m)[:,:,None]).sum(1)/(~m).sum(1)[:,None];model.mean.copy_(pooled.mean(0));model.scale.copy_(pooled.std(0).clamp_min(.05))
    optimizer=torch.optim.AdamW(model.parameters(),lr=5e-4,weight_decay=.02);best=float('inf');logs=[]
    for step in range(1800):
        indices=torch.randint(len(x),(64,),device=device);loss=F.binary_cross_entropy_with_logits(model(x[indices],m[indices]),y[indices],pos_weight=torch.tensor(1.5,device=device))
        optimizer.zero_grad();loss.backward();optimizer.step()
        if (step+1)%150==0:
            model.eval()
            with torch.inference_mode():a,b,c=tensors['validation'];score=float(F.binary_cross_entropy_with_logits(model(a,b),c))
            logs.append({'step':step+1,'validation_bce':score})
            if score<best:best=score;torch.save(model.state_dict(),OUT/'motor-gate.pt')
            model.train()
    model.load_state_dict(torch.load(OUT/'motor-gate.pt',map_location=device,weights_only=True));model.eval()
    def evaluate(split,threshold):
        a,b,c=tensors[split]
        with torch.inference_mode():p=model(a,b).sigmoid();selected=p>=threshold
        positives=c.bool();fp=int((selected&~positives).sum());tp=int((selected&positives).sum());neg=int((~positives).sum());pos=int(positives.sum())
        return {'samples':len(c),'positives':pos,'false_positive_rate':fp/max(1,neg),'recall':tp/max(1,pos),'threshold':threshold}
    options=[evaluate('validation',t) for t in [.6,.65,.7,.75,.8,.85,.9,.95,.98]];valid=[r for r in options if r['false_positive_rate']<=.03]
    selected=max(valid,key=lambda r:(r['recall'],r['threshold'])) if valid else options[-1];threshold=selected['threshold']
    run=read(BASE/'run.json')
    for item in run['models'].values():shutil.copy2(BASE/item['checkpoint'],OUT/item['checkpoint'])
    run.update({'stage':'restrained_semantic_gate_candidate','promoted':False,'base_run_sha256':sha(BASE/'run.json'),'motor_gate':{'checkpoint':'motor-gate.pt','sha256':sha(OUT/'motor-gate.pt'),'threshold':threshold,'validation':selected,'test':evaluate('test',threshold),'training_log':logs},'motion_policy':{'default_style':'restrained','minimum_gap_ms':6000,'maximum_gesture_ms':1600,'one_gesture_per_clause':True},'body_style_reviewed':False})
    source=OUT/'source';source.mkdir(exist_ok=True)
    for p in (BASE/'source').iterdir():shutil.copy2(p,source/p.name)
    for name in ['motor_gate.py','train_motor_gate.py']:shutil.copy2(ROOT/'latent'/name,source/name)
    run['source_hashes']={p.name:sha(p) for p in source.iterdir()}
    (OUT/'gate-examples.json').write_text(json.dumps([{'text':r[4],'context':r[5],'split':r[2],'gesture':r[3]} for r in rows],ensure_ascii=False,indent=2),encoding='utf-8')
    (OUT/'run.json').write_text(json.dumps(run,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(run['motor_gate'],ensure_ascii=False),flush=True)
if __name__=='__main__':main()
