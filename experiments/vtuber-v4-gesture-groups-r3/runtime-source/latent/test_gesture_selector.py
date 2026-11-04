import unittest
import torch
from gesture_selector import LABELS,choose_gesture

class GestureSelectionTests(unittest.TestCase):
    def test_retired_winner_becomes_none_without_promoting_the_runner_up(self):
        probabilities=torch.tensor([.01,.07,.86,.01,.01,.01,.01,.01,.01])
        self.assertEqual(choose_gesture(probabilities),('none',0.))

    def test_remaining_confidence_is_not_renormalized(self):
        probabilities=torch.tensor([.03,.72,.2,.01,.01,.01,.01,.005,.005])
        name,confidence=choose_gesture(probabilities)
        self.assertEqual(name,'wave');self.assertAlmostEqual(confidence,.72,places=5)

    def test_checkpoint_class_indices_remain_compatible(self):
        self.assertEqual(len(LABELS),9);self.assertEqual(LABELS[2],'cheer')

if __name__=='__main__':unittest.main()
