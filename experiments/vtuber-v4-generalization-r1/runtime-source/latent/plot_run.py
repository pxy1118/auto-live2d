"""Replot saved predictions without rerunning the encoder."""
from pathlib import Path
import numpy as np
from common import ROOT, CHANNELS, read


def plot_run(folder, rows, targets, outputs):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    fig, axes = plt.subplots(3, 2, figsize=(10, 8), layout='constrained')
    grid = np.arange(64) / 10
    specs = [('nod', 1), ('shake_head', 0), ('look_left', 0),
             ('point_index', 'right'), ('hand_chest', 'left'), ('smile', 9)]
    for ax, (label, axis) in zip(axes.flat, specs):
        sample = outputs['regression-' + label]['sample_id']
        index = next(i for i, r in enumerate(rows) if r['id'] == sample)
        if isinstance(axis, int):
            channel = CHANNELS[axis]
            truth = (targets['actions'][index, :, axis] + 1) / 2 * (channel['max'] - channel['min']) + channel['min']
            title = label + ' / ' + channel['id']
        else:
            truth = targets[axis][index]
            title = label + ' / ' + axis + ' pose'
            ax.set_yticks([0, 1], ['default', 'point_index' if axis == 'right' else 'chest'])
        ax.plot(grid, truth, 'k--', label='Program supervision', lw=1.4)
        for kind, color in [('regression', '#3679a8'), ('flow', '#d18b39')]:
            prediction = outputs[kind + '-' + label]
            value = np.array(prediction['values'])[:, axis] if isinstance(axis, int) else prediction[axis]
            ax.plot(grid, value, color=color, label=kind, lw=1.2, alpha=.9)
        ax.set_title(title, fontsize=10)
        ax.set_xlabel('Time (s)')
        ax.grid(alpha=.2)
    axes.flat[0].legend(fontsize=8)
    fig.suptitle('Seen program-supervision examples only; not a generalization test', fontsize=11)
    fig.savefig(Path(folder) / 'trajectories.png', dpi=160)
    plt.close(fig)


if __name__ == '__main__':
    import argparse
    from data import prepare
    parser = argparse.ArgumentParser()
    parser.add_argument('experiment')
    args = parser.parse_args()
    rows, _, targets = prepare(ROOT / 'datasets/pilot-v1')
    plot_run(args.experiment, rows, targets, read(Path(args.experiment) / 'predictions.json'))
