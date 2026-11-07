# Native28 motion r2 — 2026-11-06

Runtime: `v6.1.0-native28-motion`; schema: `vtuber.v6.native28_motion`.

This round trains the existing-action event head only. No new gestures or emotion-specific segments are authored. Classifier, Qwen3.5-0.8B encoder and Qwen TTS voice remain frozen on GPU. The background checkpoint is copied byte-for-byte from r1.

## Offline action selection

7374 existing authored synthetic-supervision records; no new human ratings. Train/validation/test splits remain separate. Preparation selects causal predecessors within each split, carries fast/mood curve state, samples playback offsets, varies style, and encodes physical action history only. Future action IDs have an explicit untrained history slot. Test labels are not used for checkpoint or threshold selection.

| Unified14 metric | r1 re-evaluated | r2 |
| --- | ---: | ---: |
| Macro F1 | 0.587838 | 0.727105 |
| False triggers on none targets | 0.054674 | 0.038801 |
| Accuracy | 0.816777 | 0.885210 |

Baseline comparison uses the same native-affect features and unified target: choose coordinated arm gesture first, otherwise standalone body. r1 predictions of archived emotion segments count as out of scope rather than silently becoming none. This comparison is not interchangeable with r1's separately reported arm/body F1.

Selection: validation only, seed 24041, step 1600, confidence threshold 0.35. Event head: 328532 parameters, semantic1024 + affect64 + action-history23. No legacy7 emotion or12 face-history inputs. Per-action F1 varies: cajole remains 0.222; aggregate improvement does not establish naturalness.

The 622345-parameter continuous head has the identical SHA-256 `71387ae34888a739ea2759eee6ab0999b21c1bfc57ee426ac97ffe91fc69775d` as r1. MAE ratio to r1 is1 by identity. Its historical normalized test MAE0.023253 and ratio0.629550 to v5 are inherited metrics, not new evaluations on the changed runtime distribution.

## Runtime validation

- 71 Node tests,13 GPU/emotion tests,3 launcher checks, TypeScript and production build passed.
- Isolated production browser: real TTS, native28 affect, live action history, pause/cancel/manual neutral and responsive layout passed.
- Three rendered palm-wave variants keep the single primary arm; measured wrist ranges: 0.381, 0.324, 0.356. Palm maximum y: 0.460, 0.462, 0.453.
- Same short text: before first sound884ms, after783ms; one TTS stream in both. This is one paired observation, not a p95 latency claim.
- Approximately500-character input: two prefetched TTS groups, join207ms,50 affect points,20 clause plans, zero underruns.
- Retained motion-update round-trip p95: short174.7ms, long63.2ms, render smoke90.8ms; each below400ms. Session diagnostics retain the latest80 metric rows, so long-input values describe that retained window.
- Regression coverage includes initial buffering freeze, face/eye/cue/pose clocks, cross-unit cumulative time, no clock rewind at session replacement, stale/duplicate plan rejection, and body offset applied once at gesture exit.

Raw evidence: `test-results/native28-refactor-r2/{before,after,long,smoke}/report.json`; runtime summary: `runtime-validation.json`. Source backup: `.runtime/backups/native28-r2-20261106/`. Old emotion segments/preview are snapshots in `research/emotion-catalog-r1-archive/`.

## Boundaries

No full naturalness or emotion-intensity calibration study was conducted. Curve timings still use character-position fractions of real audio duration, without word-level alignment. Adding a runtime action registration does not train a new output class. The first-sound p95 comparison remains unmeasured because the pre-change capture contains one sample.
