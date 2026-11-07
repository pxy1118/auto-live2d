"""Frozen GPU inference and native28/action-history contracts."""
import hashlib
import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
import torch
from common import ROOT
from emotion_catalog import EmotionCatalogPolicy,RUNTIME_VERSION
from emotion import validate_timeline
from motion_history import state_vector,STATE_DIM
from emotion_config import AFFECT_DIM
RUN='experiments/vtuber-v6-native28-motion-r2'

class HistoryTests(unittest.TestCase):
    def test_pure_history(self):
        self.assertEqual(STATE_DIM,23)
        self.assertEqual(len(state_vector()),23)
        with self.assertRaises(ValueError):state_vector({'emotion':'happy'})
        self.assertEqual(state_vector({'last_action':'future'})[14],1.)

@unittest.skipUnless(torch.cuda.is_available(),'CUDA required')
class PolicyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        torch.set_num_threads(4)
        from encoder import SemanticEncoder
        cls.encoder=SemanticEncoder('cuda')
        cls.policy=EmotionCatalogPolicy(cls.encoder,RUN)
        cls.policy.load()
    def feature(self):
        text='大家好，今天很开心。谢谢你陪着我。'
        p=self.policy.prefill({'session_id':'test','text':text,'clauses':[{'clause':0,'text':text,'start':0,'end':len(text)}]})
        validate_timeline(p['affect_timeline'],text)
        row=p['clauses'][0]
        return {'session_id':'test','clause':0,'feature_id':row['feature_id'],'affect':[0.]*(AFFECT_DIM-3)+[0.,0.,1.]}
    def test_info_and_frozen_models(self):
        info=self.policy.info()
        self.assertTrue(info['ready']);self.assertEqual(info['runtime_version'],RUNTIME_VERSION)
        self.assertEqual(info['execution']['emotion_device'],'cuda')
        self.assertEqual(len(info['action_catalog']['actions']),14)
        self.assertFalse(any(p.requires_grad for p in self.encoder.backbone.parameters()))
        a=ROOT/RUN/'continuous.pt';b=ROOT/'experiments/vtuber-v6-emotion-catalog-r1/continuous.pt'
        self.assertEqual(hashlib.sha256(a.read_bytes()).digest(),hashlib.sha256(b.read_bytes()).digest())
    def test_playback_plan_and_cached_continuous(self):
        data=self.feature();before=self.encoder.encode
        self.encoder.encode=lambda *a,**k:(_ for _ in ()).throw(AssertionError('must reuse cached clause feature'))
        try:
            p=self.policy.plan({**data,'planner_state':{'last_action':'wave','last_variant':1,'age_ms':1000,'phase':'idle'}})
            self.assertEqual(set(p['plan']),{'schema','clause','action','confidence'})
            self.assertEqual(p['plan']['schema'],'performance.plan.v3')
            out=self.policy.predict(data)
            self.assertEqual(len(out['channels']),9);self.assertEqual(len(out['values']),24)
            self.assertTrue(torch.isfinite(torch.tensor(out['values'])).all())
        finally:self.encoder.encode=before
        for changed in [{'session_id':'stale'},{'clause':1},{'feature_id':'unknown'}]:
            with self.assertRaises(ValueError):self.policy.plan({**data,**changed})
    def test_400_char_unit_uses_bounded_semantic_clauses(self):
        first='今天我们慢慢把事情说清楚。'*12
        text=first+'谢谢你一直陪着我。'*12
        self.assertTrue(240<len(text)<=400)
        spans=[{'clause':0,'text':first,'start':0,'end':len(first)},{'clause':1,'text':text[len(first):],'start':len(first),'end':len(text)}]
        p=self.policy.prefill({'text':text,'clauses':spans})
        self.assertEqual(len(p['clauses']),2)
        with self.assertRaises(ValueError):self.policy.prefill({'text':text})

if __name__=='__main__':unittest.main()
