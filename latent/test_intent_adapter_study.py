"""Verify the isolated body branch starts equivalent to the frozen old decoder."""
import unittest
import torch
from semantic_tokens import TokenPerformancePlanner
from run_intent_adapter_study import BodyAdapter
from planner_contract import STATE_DIM

class BodyAdapterTests(unittest.TestCase):
    def test_initial_body_and_strength_match_with_padding(self):
        torch.manual_seed(37);original=TokenPerformancePlanner(32).eval()
        saved=dict(input_dim=32,width=128,state_dict=original.state_dict());adapter=BodyAdapter(saved).eval()
        x=torch.randn(2,7,32);mask=torch.tensor([[False]*5+[True]*2,[False]*7]);state=torch.randn(2,STATE_DIM)
        with torch.inference_mode():before=original(x,mask,state);after=adapter(x,mask,state)
        self.assertTrue(torch.allclose(before['body'],after['logits'],atol=1e-6,rtol=1e-6))
        self.assertTrue(torch.allclose(before['values'][:,0],after['strength'],atol=1e-6,rtol=1e-6))

    def test_branch_training_does_not_share_production_weights(self):
        original=TokenPerformancePlanner(32).eval();before=original.projection[1].weight.detach().clone()
        adapter=BodyAdapter(dict(input_dim=32,width=128,state_dict=original.state_dict()))
        with torch.no_grad():adapter.shared.projection[1].weight.add_(1.)
        self.assertTrue(torch.equal(original.projection[1].weight,before))
        self.assertFalse(adapter.shared.heads['arm'].weight.requires_grad)
        self.assertFalse(adapter.shared.heads['eye'].weight.requires_grad)
        self.assertTrue(adapter.shared.projection[1].weight.requires_grad)
        self.assertTrue(adapter.head.necessity[0].weight.requires_grad)

if __name__=='__main__':unittest.main()
