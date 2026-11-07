"""Read-only audit of human preferences and the exact takes they reference.

Scenario coverage is an authoring hint, not classifier ground truth. This does
not edit ratings or export training labels. No model calls or audio generation.
"""
import argparse
import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path


def read(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def audit(root):
    sources = {}
    rows = []
    case_count = 0
    rating_count = 0
    for path in sorted(root.glob("*/case.json")):
        case_count += 1
        case = read(path)
        ratings = [(p, read(p)) for p in sorted(path.parent.glob("rating-*.json"))]
        ratings = [(p, r) for p, r in ratings if r.get("source") == "human"]
        rating_count += len(ratings)
        if not ratings:
            continue
        selected_path, rating = max(ratings, key=lambda pair: pair[1]["at"])
        for p in [path, *(p for p, _ in ratings)]:
            sources[str(p.resolve())] = hashlib.sha256(p.read_bytes()).hexdigest()
        row = {k: rating[k] for k in ["case_id", "choice", "scores", "issues", "note", "takes", "at"]}
        row.update(text=case["text"], context=case.get("context", ""), scenario_id=case.get("scenario_id"),
                   rating_file=str(selected_path.resolve()), runtime=rating["provenance"]["runtime_version"], candidates={})
        for candidate, take_id in rating["takes"].items():
            p = path.parent / f"take-{take_id}.json"
            take = read(p)
            sources[str(p.resolve())] = hashlib.sha256(p.read_bytes()).hexdigest()
            if not take.get("complete") or take["audio_sha256"] != rating["audio_sha256"]:
                raise ValueError(f"Invalid rated take: {p}")
            peaks = defaultdict(float)
            ranges = defaultdict(list)
            points = {}
            wink_samples = 0
            for sample in take["samples"]:
                if sample["playback_phase"] != "playing":
                    continue
                for k, v in sample["affect"].get("effective", {}).items():
                    peaks[k] = max(peaks[k], v)
                for k in ["ParamEyeBallX", "ParamEyeBallY", "ParamEyeLOpen", "ParamEyeROpen", "key1", "key2", "key7", "key13"]:
                    if k in sample["actual"]:
                        ranges[k].append(sample["actual"][k])
                wink_samples += bool(sample["expression"]["accent"])
                source = sample["affect"].get("source")
                if source:
                    points[source["text"]] = dict(sorted(source["probabilities"].items(), key=lambda x: -x[1])[:3])
            row["candidates"][candidate] = dict(
                complete=True, samples=len(take["samples"]),
                affect_peaks=dict(sorted(peaks.items(), key=lambda x: -x[1])[:4]),
                actual_ranges={k: [min(v), max(v)] for k, v in ranges.items()},
                wink_samples=wink_samples, classifier_points=points,
                actions=[{k: a.get(k) for k in ["part", "name", "variant", "source"]} for a in take["actions"]],
            )
        rows.append(row)
    return dict(schema="performance.feedback.audit.v1", training_ready=False,
                counts=dict(cases=case_count, rated_cases=len(rows), human_rating_files=rating_count,
                            notes=sum(bool(r["note"]) for r in rows),
                            rated_scenarios=len({r["scenario_id"] for r in rows if r["scenario_id"]}),
                            choices=dict(Counter(r["choice"] for r in rows)),
                            issues=dict(Counter(i for r in rows for i in r["issues"])),
                            runtime=dict(Counter(r["runtime"] for r in rows))),
                source_sha256=sources, rows=rows)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path("datasets/emotion-acting-review-v1"))
    parser.add_argument("--out", type=Path, default=Path("test-results/review-feedback"))
    args = parser.parse_args()
    result = audit(args.root)
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "audit.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    c = result["counts"]
    lines = ["# 人工反馈审阅", "", f"已评分 {c['rated_cases']} 个样本，{c['notes']} 条文字备注；共有 {c['cases']} 个准备过的样本。",
             "", "每个样本仅统计最新人工评分，引用评分中的实际 take；原始文件和旧评分保留。哈希清单见 audit.json。",
             "", f"选择统计：{c['choices']}。A/B/C 共享表情，主要改变动作；这些选择不能作为面部生成标签。",
             "", "场景标签是练习编写意图。下列概率来自原始分类器，不能用场景名直接替换。training_ready=false。", ""]
    for row in sorted(result["rows"], key=lambda r: r["scenario_id"] or r["case_id"]):
        if not row["note"] and not row["issues"]:
            continue
        a = row["candidates"]["A"]
        peaks = ", ".join(f"{k}={v:.2f}" for k, v in a["affect_peaks"].items() if v > .01)
        lines += [f"## {row['scenario_id'] or row['case_id']}", "", row["text"], "",
                  f"选择：{row['choice']}；问题：{'、'.join(row['issues']) or '未勾选'}。",
                  f"备注：{row['note'] or '无'}", "", f"A 的情绪曲线峰值：{peaks or '无有效情绪'}。",
                  f"A 的动作：{a['actions'] or '无'}；wink 采样数：{a['wink_samples']}。", "",
                  f"记录：`{row['case_id']}`；运行时 `{row['runtime']}`。", ""]
    (args.out / "audit.md").write_text("\n".join(lines), encoding="utf-8")
    print(json.dumps(c, ensure_ascii=False))


if __name__ == "__main__":
    main()
