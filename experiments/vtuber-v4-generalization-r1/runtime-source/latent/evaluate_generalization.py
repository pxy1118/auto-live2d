"""One final evaluation of the already-frozen selected checkpoint."""
import json
from pathlib import Path
import torch
from common import ROOT,sha
from semantic_tokens import FrozenTokenEncoder,TokenPerformancePlanner,representation
from generalization_data import read_rows,key,metrics,predict_all,subset,CHOICES
from performance_planner import decode

OUT=ROOT/'experiments/vtuber-v4-generalization-r1';DATA=ROOT/'datasets/vtuber-v4-generalization-v1'
def write(path,data):path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

def main():
    target=OUT/'test-evaluation.json'
    if target.exists():raise RuntimeError('Final test has already been evaluated; no retuning or repeated evaluation')
    selection=json.loads((OUT/'selected.json').read_text());meta=json.loads((OUT/'selected-metadata.json').read_text())
    assert selection['selection_split']=='validation' and not selection['test_used_for_selection']
    assert sha(OUT/'selected-planner.pt')==selection['checkpoint_sha256']
    assert sha(DATA/'manifest.json')==selection['dataset_manifest_sha256']
    torch.set_num_threads(3);model_data=torch.load(OUT/'selected-planner.pt',map_location='cpu',weights_only=True)
    model=TokenPerformancePlanner(model_data['input_dim'],model_data['width']).cuda().eval();model.load_state_dict(model_data['state_dict'])
    rows=read_rows(DATA,'test');pairs={key(r):(r['text'],r['context']) for r in rows}
    encoder=FrozenTokenEncoder(ROOT/selection['encoder_source']);features={}
    for i,(k,(text,context)) in enumerate(pairs.items()):
        h,_=encoder.encode(text,context);features[k]=representation(h,model_data['representation']).to('cpu')
        if (i+1)%32==0:print(json.dumps({'stage':'final_test_encode','completed':i+1,'total':len(pairs)}),flush=True)
    output=predict_all(model,rows,features,None)
    gates=meta['execution_thresholds'];by_challenge={}
    for challenge in sorted({r['challenge'] for r in rows}):
        idx=[i for i,r in enumerate(rows) if r['challenge']==challenge]
        by_challenge[challenge]=metrics(subset(output,idx),[rows[i] for i in idx],gates)
    predictions=[]
    for i,r in enumerate(rows):
        p=decode({k:v[i] for k,v in output.items()},gates)
        if p['arm']=='grass' and p['confidence']['arm']<.95:p['arm']='none'
        predictions.append({'id':r['id'],'text':r['text'],'context':r['context'],'semantic_group':r['semantic_group'],
            'challenge':r['challenge'],'expected':r['target'],'proposal':p,
            'category_correct':{k:p[k]==r['target'][k] for k in ['arm','body','emotion','eye']}})
    result={'checkpoint_sha256':selection['checkpoint_sha256'],'dataset_manifest_sha256':selection['dataset_manifest_sha256'],
        'test_file_sha256':sha(DATA/'test.jsonl'),'selection_frozen_before_test':True,'not_used_for_selection':True,
        'samples':len(rows),'unique_text_contexts':len(pairs),'scenario_families':len({r['semantic_group'] for r in rows}),
        'history_augmented_not_independent':True,'raw':metrics(output,rows),'executed':metrics(output,rows,gates),
        'by_challenge':by_challenge,'predictions':predictions,'human_accepted':False,'promoted':False,
        'gpu_peak_allocated_mb':torch.cuda.max_memory_allocated()/1024**2}
    write(target,result);print(json.dumps({k:result[k] for k in ['samples','unique_text_contexts','executed','gpu_peak_allocated_mb']},indent=2))

if __name__=='__main__':main()
