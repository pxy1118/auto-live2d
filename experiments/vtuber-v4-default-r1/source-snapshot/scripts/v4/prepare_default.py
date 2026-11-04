"""Prepare or activate the explicitly user-accepted default, retaining all studies."""
import argparse
import hashlib
import json
import shutil
from datetime import datetime,timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'experiments/vtuber-v4-default-r1'
def read(p):return json.loads(p.read_text(encoding='utf-8'))
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(p,x):
    temp=p.with_suffix(p.suffix+'.tmp');temp.write_text(json.dumps(x,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');temp.replace(p)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--activate',action='store_true');args=parser.parse_args()
    source=ROOT/'experiments/vtuber-v4-generalization-r1/runtime-candidate'
    context=ROOT/'experiments/vtuber-v4-context-r1';study=read(context/'results.json')
    options=sorted([r for r in study['runs'] if r['mode']=='task_context_first'],key=lambda r:(r['calibrated']['score'],r['seed']))
    chosen=options[len(options)//2]  # Median calibration score, never final-test selection.
    if not (OUT/'run.json').exists():
        OUT.mkdir(parents=True,exist_ok=True);run=read(source/'run.json')
        for name in ['regression.pt','flow.pt','motor-gate.pt','gesture-selector.pt','performance-planner.pt']:shutil.copy2(source/name,OUT/name)
        body=context/f"task_context_first-{chosen['seed']}.pt";assert sha(body)==chosen['checkpoint_sha256'];shutil.copy2(body,OUT/'body-planner.pt')
        run.update(stage='user_accepted_v4_default',promoted=True,experimental=False,
            default_acceptance=dict(source='explicit_user_request',request='我觉得已经可以了，加入默认方案吧',
                recorded_utc=datetime.now(timezone.utc).isoformat(),automated_quality_gate_overridden=True,
                note='User chose this local default. Historical quality metrics and human votes remain unchanged.'))
        run['body_planner']=dict(architecture='context_body.v1',checkpoint='body-planner.pt',sha256=sha(OUT/'body-planner.pt'),
            mode='task_context_first',input_dim=2560,width=128,prompt_sha256=sha(ROOT/'latent/context_prompts.py'),
            dataset_sha256=study['dataset_sha256'],protocol_sha256=study['protocol_sha256'],
            selected_seed=chosen['seed'],selection_rule='median calibration objective across all three seeds; no final-test access',
            shared_encoder=True)
        run['eligibility']['regression'].update(status='default',reason='Explicit user acceptance; coordinated native curves, 4B semantic planner and context-conditioned body branch.')
        write(OUT/'run.json',run)
        write(OUT/'selection.json',dict(body_source=str(body.relative_to(ROOT)),body_seed=chosen['seed'],
            calibration_candidates=[dict(seed=r['seed'],score=r['calibrated']['score']) for r in options],
            rule=run['body_planner']['selection_rule'],old_final_test_loaded=False,scientific_reports_changed=False,
            general_planner_sha256=run['performance_planner']['sha256']))
    else:
        run=read(OUT/'run.json');assert run['body_planner']['sha256']==sha(OUT/'body-planner.pt')
    if args.activate:
        config=ROOT/'latent/stream-run.json';backup=ROOT/'.runtime/v4-default-change/backup/latent/stream-run.json'
        if not backup.exists():raise RuntimeError('Create the pre-change backup first')
        write(config,dict(path=str(OUT.relative_to(ROOT)).replace('\\','/'),promoted=True,rollback_path='experiments/vtuber-v4-composition-r2',
            reason='Explicit user request: 我觉得已经可以了，加入默认方案吧',
            previous_configuration_sha256=sha(backup)))
    print(json.dumps(dict(folder=str(OUT),body_seed=run['body_planner']['selected_seed'],activated=args.activate)),flush=True)
if __name__=='__main__':main()
