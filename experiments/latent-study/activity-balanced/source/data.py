import json
from pathlib import Path
import numpy as np
from common import ROOT, CHANNELS, PROFILE, ASSET_HASH, HORIZON, HZ, RIGHT, LEFT, read, write, sha, digest, feature_message


def load_dataset(folder):
    folder = Path(folder)
    paths = sorted((folder / "samples").glob("*.json"))
    if not paths: raise ValueError("数据集为空")
    rows, source_files = [], []
    for path in paths:
        r = read(path); rec = r["recording"]
        if rec["asset_hash"] != ASSET_HASH or r["profile_sha256"] != PROFILE["sha256"]: raise ValueError("资产或 profile 不匹配")
        if r["annotation"]["source_type"] != "program_authored": raise ValueError("本先导实验只接受显式标记的程序候选")
        if rec.get("limitReached") or rec["duration_ms"] > HORIZON / HZ * 1000: raise ValueError("片段截断或超出时间预算")
        source_files.append({"id": r["id"], "file": path.name, "bytes": path.stat().st_size, "sha256": sha(path)})
        rows.append(r)
    fingerprint = digest(source_files)
    manifest_path = folder / "manifest.json"
    if manifest_path.exists() and read(manifest_path)["sha256"] != fingerprint: raise ValueError("冻结的数据集发生变化")
    return rows, {"schema": "program_pilot.v1", "sha256": fingerprint, "files": source_files, "sample_count": len(rows),
                  "profile_sha256": PROFILE["sha256"], "asset_hash": ASSET_HASH, "supervision": "program_authored_unreviewed", "independent_groups": 1, "held_out_split": None}


def tensors(rows):
    lo = np.array([c["min"] for c in CHANNELS], np.float32); hi = np.array([c["max"] for c in CHANNELS], np.float32)
    grid = np.arange(HORIZON) * 1000 / HZ
    continuous, right, left, valid, states = [], [], [], [], []
    for row in rows:
        rec = row["recording"]; ids = {k:i for i,k in enumerate(rec["parameter_ids"])}
        initial = rec["initial_state"].get("driver", rec["initial_state"].get("values"))
        times = np.array([0.] + [f["time_ms"] for f in rec["frames"]])
        values = np.array([[initial[c["id"]] for c in CHANNELS]] + [[f["driver"][ids[c["id"]]] for c in CHANNELS] for f in rec["frames"]], np.float32)
        if not np.isfinite(values).all(): raise ValueError("轨迹存在非有限值")
        u = np.stack([np.interp(grid, times, values[:,i]) for i in range(len(CHANNELS))], -1)
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
        state=(np.array([initial[c["id"]] for c in CHANNELS])-lo)/(hi-lo)*2-1
        states.append(np.r_[state,[1,0,0,1,0]])
    return {"actions":np.array(continuous,np.float32), "right":np.array(right,np.int64), "left":np.array(left,np.int64),
            "valid":np.array(valid,bool), "state":np.array(states,np.float32)}


def prepare(folder):
    rows, manifest = load_dataset(folder)
    write(Path(folder)/"manifest.json", manifest)
    return rows, manifest, tensors(rows)
