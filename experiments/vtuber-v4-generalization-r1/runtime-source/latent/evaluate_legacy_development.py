"""Supplementary current-r2 baseline on the SAME development set; no reselection."""
import json
import torch
from common import ROOT,sha
from performance_planner import load_planner
from generalization_data import read_rows,key,metrics,subset

def main():
    torch.set_num_threads(3)
    out=ROOT/'experiments/vtuber-v4-generalization-r1';source=ROOT/'experiments/vtuber-v4-composition-r2/performance-planner.pt'
    saved=torch.load(source,map_location='cpu',weights_only=True);model=load_planner(saved).eval()
    cache=torch.load(out/'features/0.8b/tokens.pt',map_location='cpu',weights_only=True)['features']
    rows=read_rows(ROOT/'datasets/vtuber-v4-generalization-v1','validation')
    x=torch.stack([cache[key(r)][-16:].float().mean(0) for r in rows]);state=torch.tensor([r['state_vector'] for r in rows])
    with torch.inference_mode():output=model(x,state)
    idx=[i for i,r in enumerate(rows) if r['challenge']!='legacy'];gates={'arm':.85,'body':.4,'emotion':.7,'eye':.6}
    result={'source':'unchanged composition-r2 planner, original MLP/linear ensemble','checkpoint_sha256':sha(source),
        'scope':'supplementary validation comparison only; not a candidate and not used to reselect',
        'all':metrics(output,rows,gates),'new_scenarios':metrics(subset(output,idx),[rows[i] for i in idx],gates),
        'test_loaded':False,'selected_checkpoint_unchanged':True}
    (out/'legacy-validation-baseline.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'all_macro':result['all']['mean_macro_f1'],'new_macro':result['new_scenarios']['mean_macro_f1']}))

if __name__=='__main__':main()
