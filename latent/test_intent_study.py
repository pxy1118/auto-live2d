"""Tests target set semantics, degenerate decisions and scene isolation."""
import json
import sys
import unittest
from pathlib import Path
import torch
from intent_study import set_loss,decide,metrics

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts/v4'))
from build_intent_data import body_annotation,validate_annotation,rows_for,split_families
from intent_scenes import SCENES

class IntentStudyTests(unittest.TestCase):
    def test_multiple_actions_share_acceptable_probability(self):
        accepted=torch.tensor([[False,True,False,True,False,False,False]])
        a=torch.tensor([[-4.,4.,-4.,2.,-4.,-4.,-4.]])
        b=torch.tensor([[-4.,2.,-4.,4.,-4.,-4.,-4.]])
        self.assertAlmostEqual(float(set_loss(a,accepted)),float(set_loss(b,accepted)),places=6)
        self.assertGreater(float(set_loss(-a,accepted)),float(set_loss(a,accepted)))
        with self.assertRaises(ValueError):set_loss(a,torch.zeros_like(accepted))

    def test_none_cannot_pass_required_and_always_active_fails_forbidden(self):
        rows=[dict(family='a',body_annotation=body_annotation('F')),
              dict(family='b',body_annotation=body_annotation('R:lean:nod')),
              dict(family='c',body_annotation=body_annotation('O:none:tilt'))]
        none=metrics(rows,torch.tensor([0,0,0]),torch.zeros(3))
        active=metrics(rows,torch.tensor([1,1,1]),torch.zeros(3)+.6)
        self.assertEqual(none['forbidden_activation'],0)
        self.assertEqual(none['required_success'],0)
        self.assertEqual(active['forbidden_activation'],1)
        self.assertEqual(active['required_success'],1)
        self.assertLess(none['acceptable_rate'],1)
        self.assertLess(active['acceptable_rate'],1)

    def test_gate_rejects_and_restores_without_using_confidence_as_amplitude(self):
        logits=torch.tensor([[1.,.9,0.,0.,0.,0.,0.],[1.,.9,0.,0.,0.,0.,0.]])
        intention=torch.tensor([[10.,0.,0.],[0.,0.,10.]])
        pred,amp=decide(logits,torch.tensor([.23,.61]),active_threshold=.7,necessity=intention)
        self.assertEqual(pred.tolist(),[0,1]);self.assertEqual(float(amp[0]),0)
        self.assertAlmostEqual(float(amp[1]),.61,places=6)

    def test_scene_family_split_and_annotation_partition(self):
        split=split_families();self.assertEqual(len(SCENES),100)
        family_sets={s:set() for s in ['train','development','calibration']};counts={s:0 for s in family_sets}
        for scene in SCENES:
            group=split[scene['family']];family_sets[group].add(scene['family']);counts[group]+=1
            for row in rows_for(scene,group):validate_annotation(row['body_annotation'])
        self.assertEqual(counts,dict(train=60,development=20,calibration=20))
        self.assertFalse(family_sets['train']&family_sets['development'])
        self.assertFalse(family_sets['train']&family_sets['calibration'])
        self.assertFalse(family_sets['calibration']&family_sets['development'])

    def test_context_contains_only_past_dialogue_and_current_viewer_turn(self):
        scene=SCENES[52];rows=[r for r in rows_for(scene,'train') if r['history_variant']=='canonical']
        self.assertNotIn(scene['turns'][0]['text'],rows[0]['context'])
        self.assertIn(scene['turns'][0]['text'],rows[1]['context'])
        self.assertNotIn(scene['turns'][2]['text'],rows[1]['context'])
        self.assertEqual(rows[0]['state']['emotion'],'neutral')
        self.assertEqual(rows[1]['state']['emotion'],'shy')

if __name__=='__main__':unittest.main()
