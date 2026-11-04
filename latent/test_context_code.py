import unittest
import torch
from context_code import CLASSES,class_order,semantic_order,marginals,editorial_strength

class CodeTests(unittest.TestCase):
    def test_mapping_is_bijective_and_restores_semantic_order(self):
        expected=list(range(14))
        for seed in [7137,1741,9283]:
            order=class_order(seed);self.assertEqual(sorted(order),expected)
            self.assertEqual(semantic_order(order,seed),[float(i) for i in expected])

    def test_marginals_preserve_probability_and_forbidden_none(self):
        joint=torch.zeros(2,14);joint[0,0]=1;joint[1,9]=1
        result=marginals(joint);self.assertTrue(torch.allclose(result['logits'].exp().sum(-1),torch.ones(2)))
        self.assertTrue(torch.allclose(result['necessity'].exp().sum(-1),torch.ones(2)))
        self.assertEqual(result['logits'][0].argmax().item(),0)
        self.assertEqual(result['necessity'][0].argmax().item(),0)
        self.assertTrue(all(n!='forbidden' or b=='none' for n,b in CLASSES))
        self.assertTrue(all(n!='required' or b!='none' for n,b in CLASSES))

    def test_editorial_amplitude_is_explicitly_separate_from_probability(self):
        pred=torch.tensor([0,1,3]);intent=torch.tensor([[100.,0.,0.],[0.,100.,0.],[0.,0.,100.]])
        amp=editorial_strength(pred,intent)
        self.assertEqual(float(amp[0]),0);self.assertAlmostEqual(float(amp[1]),.24,places=6)
        self.assertAlmostEqual(float(amp[2]),.6,places=6)
if __name__=='__main__':unittest.main()
