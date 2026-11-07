# Acting feedback r3 final

Runtime `v6.4.0-acting-feedback`; source baseline commit `72f07e1`.

The event head has 329687 parameters, 17 actions and 26 history inputs. It predicts action, variant, strength, duration and a within-sentence text fraction. The continuous head, semantic encoder, 28-label classifier and TTS are frozen.

Dataset: 10578 records (7836 train / 1368 validation / 1374 test), including 7374 legacy synthetic examples, 3096 feedback-authored examples, and 108 interpreted feedback/setup samples. The 15 known feedback utterances are train-only and their replay is not an independent test.

Test macro F1: 0.7762807815820767; neutral false triggers: 0.030434782608695653; anchor-fraction MAE: 0.07211700826883316. The unchanged legacy test subset has lower macro F1 (0.6725 vs 0.7271); see the detailed report for limitations.

Model and thresholds selected on validation only, 3 seeds x 2400 steps; selected 7137 / 2400 / 0.5. Continuous SHA-256 remains `71387ae34888a739ea2759eee6ab0999b21c1bfc57ee426ac97ffe91fc69775d`.

16 real Cubism motion cases / 1920 hand visibility checks and 7 real Qwen speech replays passed. These are functional checks, not human naturalness approval. Local reports/video: `test-results/acting-feedback-r3/`.

Full provenance, contracts, data hashes, selection logs, gates and per-action metrics: `run.json`. Dataset/process details: [feedback training](../../docs/acting-feedback-training.md).
