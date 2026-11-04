"""One-time synthetic family holdout audit, without optimizing on held-out rows."""
import argparse
from pathlib import Path
import numpy as np
import torch
from common import ROOT, read, write, sha
from data import prepare, profile_for
from encoder import SemanticEncoder
from networks import ActionExpert
from runtime import LatentPolicy


@torch.inference_mode()
def main(folder, dataset):
    torch.set_num_threads(4)
    profile=profile_for(dataset);channels=profile['channels'];run=read(folder/'run.json')
    device='cuda' if torch.cuda.is_available() else 'cpu'
    encoder=SemanticEncoder(device)
    models={}
    for kind in ['regression','flow']:
        saved=torch.load(folder/f'{kind}.pt',weights_only=True)
        model=ActionExpert(kind,saved['width'],saved['layers'],saved.get('action_dim',12),saved.get('expression_dim',0),saved.get('appearance_dim',0),saved.get('native_dim',0)).to(device).eval()
        model.load_state_dict(saved['state_dict']);models[kind]=model
    neutral=torch.tensor([2*(c['neutral']-c['min'])/(c['max']-c['min'])-1 for c in channels],device=device)
    report={'dataset_sha256':run['dataset_sha256'],'checkpoint_sha256':{kind:run['models'][kind]['checkpoint_sha256'] for kind in models},'supervision':run['supervision'],'human_reviewed':False,'scope':'held-out synthetic choreography families; same native style asset and authoring code','splits':{}}
    outputs={}
    lo=np.array([c['min'] for c in channels]);hi=np.array([c['max'] for c in channels])
    for split in ['train','validation','test']:
        rows,manifest,data=prepare(dataset,split)
        features=[];masks=[]
        for row in rows:
            a=row['annotation'];h,mask,_=encoder.encode(a['utterance'],a.get('context',''),a.get('style','natural'));features.append(h);masks.append(mask)
        h=torch.stack(features);mask=torch.stack(masks);state=torch.from_numpy(data['state']).to(device);target=torch.from_numpy(data['actions']).to(device)
        motion=(target-neutral).abs()>.03
        result={'samples':len(rows),'families':sorted({r['family'] for r in rows}),'models':{}}
        for kind,model in models.items():
            raw,rr,ll=model.sample(h,state,mask)
            expression_probability=model.expression_logits(h,state,mask).sigmoid()
            appearance_logits,native_logits=model.configuration_logits(h,state,mask)
            prediction=raw.clamp(-1,1);error=(prediction-target).abs()
            metric={'all_axis_mae':float(error.mean()),'motion_only_mae':float(error[motion].mean()),
                    'raw_out_of_range_fraction':float((raw.abs()>1).float().mean()),
                    'right_frame_accuracy':float((rr.argmax(-1).cpu()==torch.from_numpy(data['right'])).float().mean()),
                    'left_frame_accuracy':float((ll.argmax(-1).cpu()==torch.from_numpy(data['left'])).float().mean())}
            # Report active hand states separately from the many default frames.
            for side,logit in [('right',rr),('left',ll)]:
                truth=torch.from_numpy(data[side]).to(device);active=truth>0
                metric[side+'_nondefault_recall']=float((logit.argmax(-1)[active]==truth[active]).float().mean()) if active.any() else None
            if expression_probability.shape[-1]:
                expected=torch.from_numpy(data['expressions']).to(device)>.5
                limits=profile.get('expression_activation_thresholds',{})
                threshold=torch.tensor([limits.get(name,limits.get('default',.5)) for name in profile['expressions']],device=device)
                predicted=expression_probability>threshold
                tp=(expected&predicted).sum();fp=((~expected)&predicted).sum();fn=(expected&(~predicted)).sum()
                metric['expression_positive_f1']=float(2*tp/(2*tp+fp+fn).clamp_min(1))
                metric['per_expression_f1']={name:float(2*(expected[:,:,j]&predicted[:,:,j]).sum()/(expected[:,:,j].sum()+predicted[:,:,j].sum())) if (expected[:,:,j]|predicted[:,:,j]).any() else None for j,name in enumerate(profile.get('expressions',[]))}
            if appearance_logits.shape[-1]:
                expected=torch.from_numpy(data['appearance']).to(device);positive=expected>0
                metric['appearance_frame_accuracy']=float((appearance_logits.argmax(-1)==expected).float().mean())
                metric['appearance_nondefault_recall']=float((appearance_logits.argmax(-1)[positive]==expected[positive]).float().mean()) if positive.any() else None
            if native_logits.shape[-1]:
                expected=torch.from_numpy(data['native']).to(device);positive=expected>0
                metric['native_accuracy']=float((native_logits.argmax(-1)==expected).float().mean())
                metric['native_positive_recall']=float((native_logits.argmax(-1)[positive]==expected[positive]).float().mean()) if positive.any() else None
            result['models'][kind]=metric
            for family in result['families']:
                i=next(i for i,r in enumerate(rows) if r['family']==family)
                row=rows[i];a=row['annotation'];physical=(prediction[i].cpu().numpy()+1)/2*(hi-lo)+lo
                outputs[kind+'-'+family]={'sample_id':row['id'],'clip_id':row['clip_id'],'split':split,'text':a['utterance'],'context':a.get('context',''),'style':a.get('style','natural'),
                    'values':np.round(physical,5).tolist(),'right':rr[i].argmax(-1).cpu().tolist(),'left':ll[i].argmax(-1).cpu().tolist(),
                    'expression_probabilities':expression_probability[i].cpu().tolist(),'expression_names':profile.get('expressions',[]),
                    'appearance':appearance_logits[i].argmax(-1).cpu().tolist() if appearance_logits.shape[-1] else None,
                    'native_index':int(native_logits[i].argmax()) if native_logits.shape[-1] else 0}
        report['splits'][split]=result
        print(f'Evaluated {split}: {len(rows)} samples',flush=True)
    write(folder/'split-evaluation.json',report);write(folder/'predictions.json',outputs)
    # Exercise saved-weight inference and native command compilation with all 16 channels.
    policy=LatentPolicy(folder,device)
    sample=next(r for r in prepare(dataset,'train')[0] if r['family'] in ['greeting','greeting_calm']);a=sample['annotation']
    prediction=policy.predict(a['utterance'],a.get('context',''),a.get('style','natural'))
    assert len(prediction['values'][0])==len(channels)
    assert 'ParamEyeLOpen' in prediction['command']['params']['events'][0]['params']['values']
    write(folder/'inference-proof.json',prediction)
    print('Saved split evaluation and real 16-channel inference proof.',flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--experiment',default='experiments/vtuber-v3');parser.add_argument('--dataset',default='datasets/vtuber-v3')
    args=parser.parse_args();main(ROOT/args.experiment,ROOT/args.dataset)
