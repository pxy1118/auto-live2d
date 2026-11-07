"""Dataset leakage, provenance and raw-review immutability checks."""
import json
import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from common import ROOT,sha
from build_acting_feedback import OUT,check_groups
from catalog_contract import MODEL_ACTION_IDS
from motion_history import state_vector

class FeedbackDatasetTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest=json.loads((OUT/'manifest.json').read_text(encoding='utf-8'))
        cls.rows=[json.loads(x) for x in (OUT/'records.jsonl').read_text(encoding='utf-8').splitlines()]

    def test_hashes_and_group_separation(self):
        for name,expected in self.manifest['artifacts'].items():self.assertEqual(sha(OUT/name),expected,name)
        self.assertEqual(check_groups(self.rows)['cross_split_texts'],0)
        self.assertEqual(len(self.rows),10578)
        for r in self.rows:
            self.assertIn(r['target']['id'],MODEL_ACTION_IDS);self.assertEqual(len(state_vector(r['history'])),26)
        self.assertTrue(all(r['split']=='train' for r in self.rows if r['source']=='feedback_interpreted'))

    def test_raw_human_files_remain_immutable_and_preferences_are_not_motion_labels(self):
        sources=json.loads((OUT/'source-hashes.json').read_text(encoding='utf-8'))
        for name,expected in sources.items():self.assertEqual(sha(ROOT/name),expected,name)
        votes=[json.loads(x) for x in (OUT/'preferences.jsonl').read_text(encoding='utf-8').splitlines()]
        self.assertEqual(len(votes),99)
        self.assertTrue(all(v['training_ready'] is False and v['use']=='audit_only' for v in votes))
        replay=[json.loads(x) for x in (OUT/'acceptance.jsonl').read_text(encoding='utf-8').splitlines()]
        self.assertTrue(all(v['use']=='training_replay_only' for v in replay))

    def test_interpreted_examples_do_not_relabel_emotion_probabilities(self):
        self.assertEqual(self.manifest['counts']['raw_human_motion_labels'],0)
        self.assertEqual(self.manifest['counts']['feedback_interpreted_cases'],15)
        for r in self.rows:
            self.assertNotIn('emotion',r['target']);self.assertNotIn('affect',r['target'])
        self.assertEqual({r['source'] for r in self.rows},{'authored_legacy','feedback_authored','feedback_interpreted'})

if __name__=='__main__':unittest.main()
