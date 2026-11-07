# Feedback training research record

The selected runtime is `experiments/vtuber-v6-acting-feedback-r3-final`.
Intermediate checkpoints stay on the local filesystem and are ignored by Git.
`candidate-comparison.json` preserves their metrics and adoption decisions.

The initial 15 feedback sentences were kept out of the first training attempt.
After its 10/15 feedback replay exposed missed instructions, their explicit
action notes were interpreted as train-only supervision. Subsequent 15/15
replays are training checks, not independent acceptance results.

The final dataset also preserves the intended later action when the actor is
busy and adds neutral setup phrases for multi-sentence feedback. Admission and
safe exit remain the scheduler's responsibility. The old synthetic corpus has
its original supervision; future datasets should further audit differences
between semantic intent and historical admission labels.

`r2-motion-history.json` freezes the 23-dimensional source contract at commit
`72f07e1` for weight transfer and baseline evaluation. It is not a runtime
compatibility path. `calibrate_thresholds.py.snapshot` is an abandoned
per-action threshold experiment; it is not a runnable production entry point.
The final model uses one global threshold selected on validation only.
