import hashlib,json
from pathlib import Path
import numpy as np
import torch
from hand_forward import HandForward
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'experiments/vtuber-v4-hand-calibration'
def main():
    torch.set_num_threads(2);torch.manual_seed(44071);rows=json.loads((OUT/'rendered-palms.json').read_text())['rows'];report={}
    for side in ['right','left']:
        data=[r for r in rows if r['side']==side];rng=np.random.default_rng(44071);order=rng.permutation(len(data));train=order[:int(len(order)*.8)];val=order[int(len(order)*.8):int(len(order)*.9)];test=order[int(len(order)*.9):]
        x=torch.tensor([r['input'] for r in data]);y=torch.tensor([r['y'] for r in data]);m=HandForward();opt=torch.optim.Adam(m.parameters(),lr=1e-3);best=float('inf')
        for step in range(3500):
            indices=torch.as_tensor(rng.choice(train,256));loss=(m(x[indices])-y[indices]).square().mean();opt.zero_grad();loss.backward();opt.step()
            if (step+1)%250==0:
                with torch.no_grad():error=(m(x[val])-y[val]).abs().mean().item()
                if error<best:best=error;torch.save(m.state_dict(),OUT/f'{side}.pt')
        m.load_state_dict(torch.load(OUT/f'{side}.pt',weights_only=True))
        with torch.no_grad():error=(m(x[test])-y[test]).abs()
        report[side]={'validation_mae':best,'test_mae':error.mean().item(),'test_p95':error.quantile(.95).item(),'samples':len(data),'checkpoint_sha256':hashlib.sha256((OUT/f'{side}.pt').read_bytes()).hexdigest()}
    (OUT/'report.json').write_text(json.dumps({'purpose':'Training loss only; not runtime IK or animation retrieval.','models':report},indent=2));print(json.dumps(report))
if __name__=='__main__':main()
