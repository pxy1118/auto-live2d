"""Train v4 bootstrap candidates; never promote without separate human ratings."""
import argparse,hashlib,json,random,time
from pathlib import Path
import numpy as np
import torch
from torch.nn import functional as F
from encoder import SemanticEncoder
from streaming import ROOT,RUN,PROFILE,StreamingExpert,EMOTIONS

DATA=ROOT/'datasets/vtuber-v4';PHASE_CONDITIONED=False;SEMANTIC_AUGMENT=False
def read(path):return json.loads(path.read_text(encoding='utf-8'))
def write(path,data):path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8')
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()

class Windows:
    def __init__(self,device,calibration=None):
        self.device=device;self.profile=read(PROFILE);self.manifest=read(DATA/'manifest.json');self.items=self.manifest['items']
        self.calibration=calibration
        self.meta=self.profile['channels'];self.lo=np.array([p['min'] for p in self.meta]);self.hi=np.array([p['max'] for p in self.meta])
        self.neutral=np.array([p['default'] for p in self.meta])
        self.clips={item['id']:read(DATA/'clips'/f"{item['id']}.json") for item in self.items};self.audio={};self.features={}
        encoder=SemanticEncoder(device)
        cache=RUN/'semantic-cache.pt';fingerprint=sha(DATA/'manifest.json')
        saved=torch.load(cache,weights_only=True) if cache.exists() else {}
        if saved.get('fingerprint')==fingerprint:self.features=saved['features']
        else:
            for i,c in enumerate(self.clips.values()):
                key=c['text']+'\n'+c['context']
                if key not in self.features:
                    h,m,_=encoder.encode(c['text'],c['context'],'natural');self.features[key]=(h.cpu(),m.cpu())
            torch.save({'fingerprint':fingerprint,'features':self.features},cache)
        del encoder
        if device=='cuda':torch.cuda.empty_cache()
        for c in self.clips.values():
            path=c['audio'].replace('.wav','.json')
            if path not in self.audio:self.audio[path]=read(DATA/path)['features']
        self.semantic_variants={}
        if PHASE_CONDITIONED:
            import re
            prefix_encoder=None
            for c in self.clips.values():
                prefix=re.split('[，。！？!?]',c['text'])[0]
                if c.get('gesture_duration_ms'):
                    scenes={'wave':'刚开始直播，向新来的朋友问好。','cheer':'刚刚取得胜利，举起双手开心地欢呼。','point':'指向一个值得注意的地方，强调重点。','chest':'真诚表达自己的承诺与谢意。','explain':'向观众解释自己的看法。','refuse':'认真示意停一下，拒绝对方的请求。'}
                    hints={'wave':'举起一只手挥手打招呼，随后自然放下。','cheer':'高举双臂庆祝，再把手收回来。','point':'抬起食指，指出重点。','chest':'将手放在胸前表达心意。','explain':'舒展手臂辅助说明。','refuse':'抬手表示停止。'}
                    contexts=[c['context']] if not SEMANTIC_AUGMENT else [c['context'],'和观众自然交谈，动作舒展但不频繁。',scenes[c['intent']],hints[c['intent']],'',scenes[c['intent']]+'\n'+hints[c['intent']]]
                    texts=[c['text']]+([prefix] if 3<=len(prefix)<len(c['text']) else [])
                    variants=[]
                    for text in texts:
                        for context in contexts:
                            key=text+'\n'+context
                            if key not in self.features:
                                if prefix_encoder is None:prefix_encoder=SemanticEncoder(device)
                                h,m,_=prefix_encoder.encode(text,context,'natural');self.features[key]=(h.cpu(),m.cpu())
                            variants.append(key)
                    self.semantic_variants[c['id']]=variants
            torch.save({'fingerprint':fingerprint,'features':self.features},cache)
            del prefix_encoder
            if device=='cuda':torch.cuda.empty_cache()
        self.prior={}
        for seq in read(DATA/'sequences.json'):
            for a,b in zip(seq['clips'],seq['clips'][1:]):self.prior.setdefault(b,[]).append(a)
    def norm(self,v):return np.clip(2*(np.asarray(v)-self.lo)/(self.hi-self.lo)-1,-1,1)
    def batch(self,split,batch,rng):
        choices=[c for c in self.clips.values() if c['split']==split];rows=[]
        probabilities=None
        if split=='train':
            weights=np.array([0. if self.calibration and c['scenario'] in self.calibration['rejected_scenarios'] else c.get('sampling_weight',1.) for c in choices])
            probabilities=weights/weights.sum()
        for _ in range(batch):
            c=choices[int(rng.choice(len(choices),p=probabilities))];values=np.array(c['values']);start=int(rng.integers(max(1,len(values)-8)))
            target=values[np.minimum(np.arange(start,start+24),len(values)-1)]
            before=values[np.maximum(np.arange(start-20,start),0)]
            # Multi-clause examples include non-neutral incoming poses and histories.
            if start<20 and c['id'] in self.prior and rng.random()<.5:
                prev=self.clips[rng.choice(self.prior[c['id']])];prior=np.array(prev['values'])[-20:]
                before[:20-start]=prior[-(20-start):]
                offset=before[-1]-target[0];fade=np.maximum(0,1-np.arange(24)/12)[:,None];target=target+offset[None]*fade
            state=before[-1];a=self.audio[c['audio'].replace('.wav','.json')];times=np.asarray(a['motion_times_ms']);features=np.asarray(a['motion'])
            wanted=(start+np.arange(24))*50;pos=np.maximum(0,np.searchsorted(times,wanted,side='right')-1);audio=features[np.minimum(pos,len(features)-1)]
            available=int(rng.integers(0,25));mask=(np.arange(24)<available).astype(np.float32);audio=audio*mask[:,None]
            if rng.random()<.15:before=self.norm(before)+rng.normal(0,.025,before.shape);history=np.clip(before,-1,1)
            else:history=self.norm(before)
            director=np.zeros(9);mood=EMOTIONS.index(c['emotion'])
            if rng.random()<.35:director[mood]=c['intensity'];director[7]=c['intensity'];director[8]=1
            key=str(rng.choice(self.semantic_variants[c['id']])) if c['id'] in self.semantic_variants and rng.random()<(.85 if SEMANTIC_AUGMENT else .4) else c['text']+'\n'+c['context']
            h,m=self.features[key];face=np.asarray(c['face'])[min(start,len(values)-1)]
            face_state=np.zeros(12)
            if start>4 and rng.random()<.65:
                face_state[:7]=np.asarray(c['face'])[start-1];face_state[7+c['eye']]=1
            if self.calibration and not director[8]:
                preferences=self.calibration['preferred_by_emotion'];preferred=preferences[c['emotion']]
                director[:7]=[preferences[e] for e in EMOTIONS];director[7]=self.calibration['preferred_intensity']
                scale=preferred/.58;face=np.clip(face*scale,0,.95);face_state[:7]=np.clip(face_state[:7]*scale,0,.95)
                # Only comic overlay strength was reliably visible in the first review set.
                # Do not infer preferences for eyelids, face tracking, torso, or arms from it.
            phase=np.array([start*.05,c.get('gesture_duration_ms',3000)/1000,float(bool(c.get('gesture_duration_ms'))),0])
            rows.append((h.numpy(),m.numpy(),self.norm(state),history,audio,mask,director,self.norm(target),face,c['eye'],mood,(c['hold_ms']-2000)/4000,face_state,phase))
        result=[]
        for i in range(len(rows[0])):
            dtype=torch.bool if i==1 else torch.long if i in [9,10] else torch.float32
            result.append(torch.as_tensor(np.stack([r[i] for r in rows]),dtype=dtype,device=self.device))
        return result

@torch.inference_mode()
def evaluate(model,data,split,seed=847,batches=8):
    model.eval();rng=np.random.default_rng(seed);scores=[]
    for _ in range(batches):
        b=data.batch(split,32,rng);pred=model.sample(*b[:7],seed=seed,face_state=b[12],motion_phase=b[13]);raw=pred[0]
        scores.append([float((raw-b[7]).abs().mean()),float((pred[1]-b[8]).abs().mean()),float((pred[2].argmax(-1)==b[9]).float().mean()),float((pred[3].argmax(-1)==b[10]).float().mean()),float((raw.abs()>1).float().mean())])
    model.train();return dict(zip(['action_mae','strength_mae','eye_accuracy','emotion_accuracy','raw_out_of_range_fraction'],np.mean(scores,axis=0).tolist()))

def main():
    global RUN,DATA,PHASE_CONDITIONED,SEMANTIC_AUGMENT
    parser=argparse.ArgumentParser();parser.add_argument('--steps',type=int,default=3000);parser.add_argument('--device',default='cuda');parser.add_argument('--output',type=Path,default=RUN);parser.add_argument('--dataset',type=Path,default=DATA);parser.add_argument('--ratings',type=Path);parser.add_argument('--base',type=Path);parser.add_argument('--phase-conditioned',action='store_true');parser.add_argument('--arm-weight',type=float,default=1);parser.add_argument('--wrist-weight',type=float,default=1);parser.add_argument('--semantic-augment',action='store_true');parser.add_argument('--kinds',nargs='+',choices=['regression','flow'],default=['regression','flow']);args=parser.parse_args();RUN=args.output.resolve();DATA=args.dataset.resolve();PHASE_CONDITIONED=args.phase_conditioned;SEMANTIC_AUGMENT=args.semantic_augment
    calibration=None
    if args.ratings:
        votes=read(args.ratings).get('pilot',{})
        if any(str(i) not in votes or votes[str(i)].get('source')!='user' for i in range(16)):raise ValueError('需要全部 16 组真实用户风格评分')
        strengths=[.4 if votes[str(i)]['choice']=='A' else .92 for i in range(16) if votes[str(i)]['choice'] in ['A','B']]
        if not strengths:raise ValueError('没有明确偏好的候选，请先按意见重做候选，不自动推断风格')
        by_emotion={m:[] for m in EMOTIONS}
        for i in range(16):
            if votes[str(i)]['choice'] in ['A','B']:
                mood=read(DATA/'clips'/f's{i:03}-v1.json')['emotion'];by_emotion[mood].append(.4 if votes[str(i)]['choice']=='A' else .92)
        calibration={'scope':'expression_overlay_intensity_only','body_style_reviewed':False,'ratings_sha256':sha(args.ratings),'preferred_intensity':float(np.median(strengths)),
          'preferred_by_emotion':{m:float(np.median(v)) if v else .58 for m,v in by_emotion.items()},
          'rejected_scenarios':[f's{i:03}' for i in range(16) if votes[str(i)]['choice']=='neither'],'votes':votes}
    if (RUN/'run.json').exists():raise RuntimeError('拒绝覆盖已训练实验，请先将旧实验单独归档')
    RUN.mkdir(parents=True,exist_ok=True);torch.set_num_threads(4);torch.manual_seed(24041);np.random.seed(24041);random.seed(24041)
    data=Windows(args.device,calibration);results={};start=time.time()
    if calibration:write(RUN/'calibration.json',calibration)
    source=RUN/'source';source.mkdir(exist_ok=True)
    for name in ['streaming.py','train_streaming.py']: (source/name).write_bytes((ROOT/'latent'/name).read_bytes())
    for kind in args.kinds:
        torch.manual_seed(24041);rng=np.random.default_rng(24041);model=StreamingExpert(len(data.meta),kind,phase_conditioned=PHASE_CONDITIONED).to(args.device);optimizer=torch.optim.AdamW(model.parameters(),lr=4e-4)
        axis_weight=torch.tensor([args.arm_weight if p['id'] in ['Param36','Param39','Param41','Param42','Param43','Param62','Param59','Param60','Param61'] else 1 for p in data.meta],device=args.device)
        wrist_indices=[i for i,p in enumerate(data.meta) if p['id'] in ['Param42','Param61']];axis_weight[wrist_indices]*=args.wrist_weight
        if args.base:
            base_run=read(args.base/'run.json');base_item=base_run['models'][kind];base_file=args.base/base_item['checkpoint']
            if sha(base_file)!=base_item['sha256'] or base_run['profile_sha256']!=data.profile['sha256']:raise ValueError('基础检查点来源或通道不匹配')
            missing=model.load_state_dict(torch.load(base_file,map_location=args.device,weights_only=True)['state_dict'],strict=False)
            if missing.unexpected_keys or any(not k.startswith('phase.') for k in missing.missing_keys):raise ValueError('基础检查点结构不兼容')
        best=float('inf');log=[]
        for step in range(args.steps):
            b=data.batch('train',32,rng)
            if kind=='flow':
                noise=torch.randn_like(b[7]);t=torch.rand(len(noise),device=args.device);mixed=noise*(1-t[:,None,None])+b[7]*t[:,None,None]
                pred=model(*b[:7],noisy=mixed,time=t,face_state=b[12],motion_phase=b[13]);motion=((pred[0]-(b[7]-noise)).square()*axis_weight).mean()
            else:
                pred=model(*b[:7],face_state=b[12],motion_phase=b[13]);weight=1+4*(b[7]-b[2][:,None]).abs();motion=((pred[0]-b[7]).square()*weight*axis_weight).mean()
                motion=motion+.4*(((pred[0][:,1:]-pred[0][:,:-1])-(b[7][:,1:]-b[7][:,:-1])).square()*axis_weight).mean()
                if args.wrist_weight>1:motion=motion+.6*(pred[0][:,:,wrist_indices].std(dim=1)-b[7][:,:,wrist_indices].std(dim=1)).square().mean()
            strength=F.mse_loss(pred[1],b[8])*3
            loss=motion+strength+.3*F.cross_entropy(pred[2],b[9])+.35*F.cross_entropy(pred[3],b[10])+.2*F.mse_loss(pred[4],b[11])
            optimizer.zero_grad();loss.backward();torch.nn.utils.clip_grad_norm_(model.parameters(),1);optimizer.step()
            if (step+1)%250==0 or step+1==args.steps:
                val=evaluate(model,data,'validation');score=val['action_mae']+val['strength_mae']+.15*(1-val['eye_accuracy'])+.15*(1-val['emotion_accuracy'])
                row={'kind':kind,'step':step+1,'loss':float(loss.detach()),'validation':val,'elapsed_s':time.time()-start};log.append(row);print(json.dumps(row),flush=True)
                if score<best:best=score;torch.save({'state_dict':model.state_dict(),'kind':kind,'profile_sha256':data.profile['sha256'],'step':step+1,'phase_conditioned':PHASE_CONDITIONED},RUN/f'{kind}.pt')
        saved=torch.load(RUN/f'{kind}.pt',map_location=args.device,weights_only=True);model.load_state_dict(saved['state_dict'])
        results[kind]={'checkpoint':f'{kind}.pt','sha256':sha(RUN/f'{kind}.pt'),'parameters':sum(p.numel() for p in model.parameters()),'selected_step':saved['step'],
          'validation':evaluate(model,data,'validation'),'test':evaluate(model,data,'test',seed=18079),'training_log':log}
        del model;torch.cuda.empty_cache()
    run={'stage':'human_style_calibrated' if calibration else 'synthetic_bootstrap_unreviewed','promoted':False,'human_calibrated':bool(calibration),'calibration':calibration,'models':results,'dataset_sha256':sha(DATA/'manifest.json'),
         'profile_sha256':data.profile['sha256'],'samples':len(data.items),'sequences':len(read(DATA/'sequences.json')),'dataset_path':str(DATA.relative_to(ROOT)),'steps':args.steps,'seed':24041,'elapsed_s':time.time()-start,
         'base_run_sha256':sha(args.base/'run.json') if args.base else None,'phase_conditioned':PHASE_CONDITIONED,'arm_loss_weight':args.arm_weight,'wrist_loss_weight':args.wrist_weight,'semantic_context_augmentation':SEMANTIC_AUGMENT,'split_policy':'entire identical text families held together; synthetic targets, not human performance','source_hashes':{p.name:sha(p) for p in source.iterdir()}}
    write(RUN/'run.json',run);print(json.dumps({'complete':True,'elapsed_s':run['elapsed_s']}),flush=True)
if __name__=='__main__':main()
