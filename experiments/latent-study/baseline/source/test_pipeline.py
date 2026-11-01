import tempfile
from pathlib import Path
import unittest
import numpy as np
import torch
from common import CHANNELS,HORIZON,feature_message
from data import tensors
from trajectory import compile_trajectory
from networks import ActionExpert

torch.set_num_threads(2)

class PipelineTests(unittest.TestCase):
    def test_supervision_uses_driver_not_physics_output(self):
        initial={c['id']:c['neutral'] for c in CHANNELS}; driver=[initial[c['id']] for c in CHANNELS]; driver[0]=6
        row={'recording':{'parameter_ids':[c['id'] for c in CHANNELS],'initial_state':{'driver':initial},'duration_ms':200,
                         'frames':[{'time_ms':100,'driver':driver,'actual':[999]*12},{'time_ms':200,'driver':driver,'actual':[999]*12}],'commands':[]}}
        data=tensors([row]);self.assertAlmostEqual(data['actions'][0,1,0],6/18,places=5)
        self.assertEqual(data['actions'].shape,(1,64,12));self.assertFalse(data['valid'][0,-1])

    def test_feature_input_contains_no_teacher_or_sample_identifiers(self):
        self.assertEqual(set(feature_message('你好')),{'text','context','style'})

    def test_trajectory_rejects_nonfinite_or_out_of_bounds(self):
        values=np.tile([c['neutral'] for c in CHANNELS],(64,1)).astype(float)
        for bad in [float('nan'),1000]:
            values[3,0]=bad
            with self.assertRaises(ValueError):compile_trajectory(values,[0]*64,[0]*64,{})

    def test_native_hand_transition_scheduler_suppresses_short_flickers(self):
        values=np.tile([c['neutral'] for c in CHANNELS],(64,1));labels=[1]*20+[0]*44
        result,stats=compile_trajectory(values,labels,[0]*64,{'source':'latent_policy'})
        self.assertEqual(stats['gesture_accepted'],2)
        self.assertEqual([e['at_ms'] for e in result['params']['events'] if e['method']=='gesture.set'],[0,2000])
        labels=[0]*64;labels[3]=1
        _,stats=compile_trajectory(values,labels,[0]*64,{})
        self.assertEqual(stats['gesture_accepted'],0);self.assertEqual(stats['gesture_suppressed'],1)

    def test_models_have_finite_gradients_and_weights_roundtrip(self):
        torch.manual_seed(41)
        h=torch.randn(2,16,1024);state=torch.randn(2,17);mask=torch.zeros(2,16,dtype=torch.bool)
        for kind in ['regression','flow']:
            model=ActionExpert(kind)
            output,rr,ll=model(h,state,mask,torch.randn(2,64,12),torch.ones(2)*.5) if kind=='flow' else model(h,state,mask)
            loss=output.square().mean()+rr.square().mean()+ll.square().mean();loss.backward()
            self.assertTrue(any(p.grad is not None and torch.any(p.grad!=0) for p in model.parameters()))
            model.eval()
            with tempfile.TemporaryDirectory(prefix='latent-unit-') as temporary:
                path=Path(temporary)/'model.pt';torch.save(model.state_dict(),path);restored=ActionExpert(kind);restored.load_state_dict(torch.load(path,weights_only=True));restored.eval()
                a=model.sample(h,state,mask,steps=2,seed=41)[0];b=restored.sample(h,state,mask,steps=2,seed=41)[0]
                self.assertTrue(torch.equal(a,b));self.assertTrue(torch.isfinite(a).all())

if __name__=='__main__':unittest.main()
