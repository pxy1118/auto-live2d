import unittest
import torch
from streaming import StreamingExpert

class StreamingTests(unittest.TestCase):
    def setUp(self):
        torch.set_num_threads(2);torch.manual_seed(4)
        self.args=[torch.randn(1,16,1024),torch.zeros(1,16,dtype=torch.bool),torch.zeros(1,5),torch.zeros(1,20,5),torch.randn(1,24,12),torch.zeros(1,24),torch.zeros(1,9)]
    def test_unavailable_audio_cannot_influence_any_predicted_channel(self):
        model=StreamingExpert(5).eval()
        with torch.inference_mode():a=model(*self.args);self.args[4]=torch.randn_like(self.args[4])*100;b=model(*self.args)
        for x,y in zip(a,b):torch.testing.assert_close(x,y)
    def test_history_and_current_expression_affect_the_prediction(self):
        model=StreamingExpert(5).eval()
        with torch.inference_mode():
            a=model(*self.args)[0];self.args[3][:]=.6;b=model(*self.args)[0]
            c=model(*self.args,face_state=torch.ones(1,12))[0]
        self.assertFalse(torch.allclose(a,b));self.assertFalse(torch.allclose(b,c))
    def test_flow_is_repeatable_and_seed_controls_continuous_variation(self):
        model=StreamingExpert(5,'flow').eval()
        a=model.sample(*self.args,seed=41)[0];b=model.sample(*self.args,seed=41)[0];c=model.sample(*self.args,seed=42)[0]
        torch.testing.assert_close(a,b);self.assertFalse(torch.allclose(a,c));self.assertTrue(torch.isfinite(c).all())
    def test_gesture_phase_changes_the_prediction_with_identical_speech_and_history(self):
        model=StreamingExpert(5,phase_conditioned=True).eval()
        with torch.inference_mode():
            a=model(*self.args,motion_phase=torch.tensor([[.1,3.2,1.,.07]]))[0]
            b=model(*self.args,motion_phase=torch.tensor([[1.5,3.2,1.,.07]]))[0]
        self.assertFalse(torch.allclose(a,b))

if __name__=='__main__':unittest.main()
