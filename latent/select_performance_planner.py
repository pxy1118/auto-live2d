"""Select trained heads on validation only; bundle the exact chosen weights."""
import hashlib,json,shutil
from pathlib import Path
import torch
from performance_planner import EnsemblePerformancePlanner
from planner_contract import SCHEMA
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'experiments/vtuber-v4-composition-r1'
def read(p):return json.loads(p.read_text(encoding='utf-8'))
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
    OUT.mkdir(exist_ok=True)
    if (OUT/'performance-planner.pt').exists():raise RuntimeError('Refusing to overwrite selected candidate')
    metadata={f'r{i}':read(ROOT/f'experiments/vtuber-v4-planner-r{i}/performance-planner.json') for i in range(1,6)}
    sources={}
    for key in ['arm','body','emotion','eye']:
        sources[key]=max(metadata,key=lambda name:(metadata[name]['validation'][key]['correct_active_recall'],-metadata[name]['validation'][key]['false_positive_rate']))
    reg=min(metadata,key=lambda name:metadata[name]['validation']['regression_mae']);sources.update(values=reg,arm_variant=reg,body_variant=reg)
    architectures={name:metadata[name].get('architecture','nonlinear') for name in set(sources.values())};model=EnsemblePerformancePlanner(architectures,sources)
    for name in architectures:model.components[name].load_state_dict(torch.load(ROOT/f'experiments/vtuber-v4-planner-{name}/performance-planner.pt',weights_only=True)['state_dict'])
    dataset={m['dataset_sha256'] for m in metadata.values()};assert len(dataset)==1
    saved={'schema':SCHEMA,'architecture':'ensemble','architectures':architectures,'head_sources':sources,'dataset_sha256':dataset.pop(),'state_dict':model.state_dict()};torch.save(saved,OUT/'performance-planner.pt')
    result={'schema':SCHEMA,'architecture':'ensemble','architectures':architectures,'head_sources':sources,'checkpoint':'performance-planner.pt','sha256':sha(OUT/'performance-planner.pt'),'dataset':metadata[reg]['dataset'],'dataset_sha256':saved['dataset_sha256'],
            'thresholds':{k:metadata[n]['thresholds'][k] for k,n in sources.items() if k in ['arm','body','emotion','eye']},'validation':{**{k:metadata[n]['validation'][k] for k,n in sources.items() if k in ['arm','body','emotion','eye']},'regression_mae':metadata[reg]['validation']['regression_mae']},
            'parameters':sum(p.numel() for p in model.parameters()),'source':'validation-selected learned heads; synthetic authored labels; no human preference scores','test_used_for_selection':False,'component_metadata_sha256':{k:sha(ROOT/f'experiments/vtuber-v4-planner-{k}/performance-planner.json') for k in architectures}}
    (OUT/'performance-planner.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    parent=ROOT/'experiments/vtuber-v4-gesture-groups-r6';run=read(parent/'run.json')
    for p in parent.glob('*.pt'):shutil.copy2(p,OUT/p.name)
    run.update(stage='learned_composition_candidate',performance_planner=result);run['motion_policy'].update(version='v4.12-composition-planner',one_plan_per_clause=True,quote_aware_segmentation=True)
    run['eligibility']['regression']['reason']='Learned composition candidate; targeted runtime, stability, latency and human preference checks pending.'
    (OUT/'run.json').write_text(json.dumps(run,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'head_sources':sources,'validation':result['validation'],'parameters':result['parameters']}))
if __name__=='__main__':main()
