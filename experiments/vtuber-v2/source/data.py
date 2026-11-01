import json
from pathlib import Path
import numpy as np
from common import ROOT, CHANNELS, PROFILE, ASSET_HASH, HORIZON, HZ, RIGHT, LEFT, read, write, sha, digest, feature_message


def profile_for(folder):
    file=Path(folder)/'profile.json'
    return read(file) if file.exists() else PROFILE


def load_dataset(folder, split=None):
    folder = Path(folder)
    profile=profile_for(folder)
    reviewed=(folder/'dataset.json').exists()
    metadata=read(folder/'dataset.json') if reviewed else {}
    if reviewed and (metadata.get('schema')!='reviewed_vtuber.v1' or metadata.get('status')!='sealed'):
        raise ValueError('只允许已封存的审核数据集')
    reviews={r['clip_id']:r for line in (folder/'reviews.jsonl').read_text(encoding='utf-8').splitlines() if line.strip() for r in [json.loads(line)]} if reviewed else {}
    paths = sorted((folder / "samples").glob("*.json"))
    if not paths: raise ValueError("数据集为空")
    rows, source_files = [], []
    for path in paths:
        r = read(path); rec = r["recording"]
        if rec["asset_hash"] != ASSET_HASH or r["profile_sha256"] != profile["sha256"]: raise ValueError("资产或 profile 不匹配")
        if r["annotation"]["source_type"] != "program_authored": raise ValueError("本先导实验只接受显式标记的程序候选")
        if rec.get("limitReached") or rec["duration_ms"] > HORIZON / HZ * 1000: raise ValueError("片段截断或超出时间预算")
        if reviewed:
            review=reviews.get(r.get('clip_id'),{})
            if review.get('decision')!='accepted' or not review.get('visual_reviewed') or not review.get('automated_pass'):
                raise ValueError('未通过审核的片段不得进入训练数据')
            if r.get('candidate_sha256')!=review.get('candidate_sha256') or r.get('split') not in ['train','validation','test']:
                raise ValueError('样本审核来源或拆分不匹配')
            if r.get('review_id')!=review.get('review_id') or r['annotation'].get('human_reviewed') is not False:
                raise ValueError('审核版本不符或错误声明真人审核')
            candidate=folder/'candidates'/(r['clip_id']+'.json')
            if not candidate.exists() or sha(candidate)!=review['candidate_sha256']:raise ValueError('审核后的候选文件发生变化')
        source_files.append({"id": r["id"], "file": path.name, "bytes": path.stat().st_size, "sha256": sha(path)})
        rows.append(r)
    fingerprint = digest(source_files)
    manifest_path = folder / "manifest.json"
    if manifest_path.exists() and read(manifest_path)["sha256"] != fingerprint: raise ValueError("冻结的数据集发生变化")
    manifest={"schema": "reviewed_vtuber.v1" if reviewed else "program_pilot.v1", "sha256": fingerprint, "files": source_files, "sample_count": len(rows),
              "profile_sha256": profile["sha256"], "asset_hash": ASSET_HASH,
              "supervision": "program_authored_assistant_reviewed" if reviewed else "program_authored_unreviewed",
              "independent_groups":len({r['family'] for r in rows}) if reviewed else 1,
              "held_out_split":metadata.get('split_policy')}
    if reviewed:
        manifest.update({'reviews_sha256':sha(folder/'reviews.jsonl'),'native_style_sources':1,'human_reviewed':False,'clip_count':len(reviews),'profile':profile})
        previous=read(manifest_path) if manifest_path.exists() else None
        if previous and previous.get('reviews_sha256')!=manifest['reviews_sha256']:raise ValueError('冻结审核记录发生变化')
        selected=split or metadata.get('default_split','train')
        rows=[r for r in rows if r['split']==selected] if selected!='all' else rows
        manifest['selection']={'split':selected,'sample_count':len(rows),'ids_sha256':digest([r['id'] for r in rows])}
        if not rows:raise ValueError('所选拆分为空')
    return rows,manifest


def tensors(rows, profile=None):
    channels=(profile or PROFILE)['channels']
    lo = np.array([c["min"] for c in channels], np.float32); hi = np.array([c["max"] for c in channels], np.float32)
    grid = np.arange(HORIZON) * 1000 / HZ
    continuous, right, left, valid, states, expression_targets = [], [], [], [], [], []
    expression_names=(profile or PROFILE).get('expressions',[])
    for row in rows:
        rec = row["recording"]; ids = {k:i for i,k in enumerate(rec["parameter_ids"])}
        initial = rec["initial_state"].get("driver", rec["initial_state"].get("values"))
        times = np.array([0.] + [f["time_ms"] for f in rec["frames"]])
        values = np.array([[initial[c["id"]] for c in channels]] + [[f["driver"][ids[c["id"]]] for c in channels] for f in rec["frames"]], np.float32)
        if not np.isfinite(values).all(): raise ValueError("轨迹存在非有限值")
        u = np.stack([np.interp(grid, times, values[:,i]) for i in range(len(channels))], -1)
        if ((u < lo - 1e-4) | (u > hi + 1e-4)).any(): raise ValueError("监督超出训练 profile")
        continuous.append((u-lo)/(hi-lo)*2-1)
        valid.append(grid <= rec["duration_ms"])
        commands = sorted([e for e in rec["commands"] if e["method"] == "gesture.set"], key=lambda e:e["at_ms"])
        index=0; poses={"right":"default", "left":"default"}; rr=[]; ll=[]
        for time in grid:
            while index < len(commands) and commands[index]["at_ms"] <= time + 1e-4:
                p=commands[index]["params"]; poses[p["side"]]=p["pose"]; index+=1
            rr.append(RIGHT.index(poses["right"])); ll.append(LEFT.index(poses["left"]))
        right.append(rr); left.append(ll)
        commands=sorted([e for e in rec['commands'] if e['method']=='expressions.set'],key=lambda e:e['at_ms'])
        flags={name:0 for name in expression_names};index=0;ee=[]
        for time in grid:
            while index<len(commands) and commands[index]['at_ms']<=time+1e-4:
                params=commands[index]['params']
                if params['name'] in flags:flags[params['name']]=int(params.get('enabled',True))
                index+=1
            ee.append([flags[name] for name in expression_names])
        expression_targets.append(ee)
        state=(np.array([initial[c["id"]] for c in channels])-lo)/(hi-lo)*2-1
        states.append(np.r_[state,[1,0,0,1,0]])
    return {"actions":np.array(continuous,np.float32), "right":np.array(right,np.int64), "left":np.array(left,np.int64),
            "valid":np.array(valid,bool), "state":np.array(states,np.float32), 'expressions':np.array(expression_targets,np.float32)}


def prepare(folder, split=None):
    rows, manifest = load_dataset(folder,split)
    if not (Path(folder)/'manifest.json').exists():
        frozen={k:v for k,v in manifest.items() if k!='selection'}
        write(Path(folder)/"manifest.json", frozen)
    return rows, manifest, tensors(rows,profile_for(folder))
