"""Compare saved heads on identical cached inputs. This is a training-fit audit."""
import argparse
from pathlib import Path
import numpy as np
import torch
from common import ROOT, CHANNELS, read, write
from data import prepare
from networks import ActionExpert


@torch.inference_mode()
def compare(study):
    torch.set_num_threads(4)
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    rows, manifest, data = prepare(ROOT / 'datasets/pilot-v1')
    cached = torch.load(ROOT / 'datasets/pilot-v1/features.pt', weights_only=True)
    if cached['dataset_sha256'] != manifest['sha256']:
        raise ValueError('Feature cache does not match the frozen dataset')
    features, mask = cached['features'].to(device), cached['mask'].to(device)
    y, state = torch.from_numpy(data['actions']).to(device), torch.from_numpy(data['state']).to(device)
    neutral = torch.tensor([2*(c['neutral']-c['min'])/(c['max']-c['min'])-1 for c in CHANNELS], device=device)
    valid = torch.from_numpy(data['valid']).to(device)[:, :, None].expand_as(y)
    motion = ((y-neutral).abs() > .03) & valid
    axes = motion.any(0).any(0)

    def metrics(raw, right, left):
        pred = raw.clamp(-1, 1)
        error = (pred-y).abs()
        excess = (raw.abs()-1).clamp_min(0)
        valid_mae = error[valid].mean()
        return {
            'valid_all_axis_mae': float(valid_mae),
            'valid_observed_axis_mae': float(error[:, :, axes][valid[:, :, axes]].mean()),
            'motion_only_mae': float(error[motion].mean()),
            'per_axis_motion_mae': {c['id']: float(error[:, :, i][motion[:, :, i]].mean()) for i, c in enumerate(CHANNELS) if axes[i]},
            'first_difference_mae': float(((pred[:, 1:]-pred[:, :-1])-(y[:, 1:]-y[:, :-1])).abs().mean()),
            'raw_out_of_range_fraction': float((excess > 0).float().mean()),
            'raw_normalized_excess_mean': float(excess.mean()),
            'raw_normalized_excess_max': float(excess.max()),
            'right_frame_accuracy': float((right.argmax(-1).cpu() == torch.from_numpy(data['right'])).float().mean()),
            'left_frame_accuracy': float((left.argmax(-1).cpu() == torch.from_numpy(data['left'])).float().mean()),
        }

    report = {
        'schema': 'latent_comparison.v1', 'dataset_sha256': manifest['sha256'],
        'held_out_evaluation': False, 'supervision': manifest['supervision'],
        'metric_range': 'affine profile normalization [-1,1]; motion iff absolute displacement >0.03; motion/MAE exclude padded frames',
        'all_neutral_motion_mae': float((y-neutral).abs()[motion].mean()),
        'motion_elements': int(motion.sum()), 'runs': {},
    }
    for name in ['baseline', 'original-loss-control', 'activity-balanced']:
        folder = Path(study) / name
        run = read(folder / 'run.json')
        report['runs'][name] = {}
        for kind in ['regression', 'flow']:
            saved = torch.load(folder / (kind+'.pt'), weights_only=True)
            model = ActionExpert(kind, saved['width'], saved['layers']).to(device).eval()
            model.load_state_dict(saved['state_dict'])
            raw, right, left = model.sample(features, state, mask, seed=41)
            item = metrics(raw, right, left)
            shuffled, _, _ = model.sample(features.roll(1, 0), state, mask.roll(1, 0), seed=41)
            item['shuffled_features_motion_mae'] = float((shuffled.clamp(-1, 1)-y).abs()[motion].mean())
            item.update({'parameters': run['models'][kind]['parameters'], 'steps': run['models'][kind]['steps'], 'loss': run.get('loss_variant', 'original')})
            report['runs'][name][kind] = item
            del model
    write(Path(study) / 'comparison.json', report)
    print('Wrote comparison.json; all numbers measure training fit only.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--study', default='experiments/latent-study')
    compare(parser.parse_args().study)
