import json,unittest
from pathlib import Path
import torch
from performance_planner import PerformancePlanner,decode,load_planner
from planner_contract import SCHEMA,ARMS,BODIES,EMOTIONS,EYES,state_vector
ROOT=Path(__file__).resolve().parents[1]

class PlannerTests(unittest.TestCase):
    def test_data_isolation_and_held_out_compositions(self):
        rows=[json.loads(line) for line in (ROOT/'datasets/vtuber-v4-planner-v2/records.jsonl').read_text(encoding='utf-8').splitlines()];text_splits={};groups={}
        for r in rows:
            text_splits.setdefault(r['text'],set()).add(r['split']);groups.setdefault(r['semantic_group'],set()).add(r['split'])
            self.assertEqual(len(r['state_vector']),44)
            if r['split']=='train':self.assertNotIn((r['target']['arm'],r['target']['body']),[('thanks','cajole'),('point','tilt')])
        self.assertTrue(all(len(s)==1 for s in text_splits.values()));self.assertTrue(all(len(s)==1 for s in groups.values()));self.assertTrue(any(r['source']=='negation_counterexample' for r in rows));self.assertTrue(any(r['source']=='irony_contrast' for r in rows))
    def test_confidence_only_selects_the_category_and_not_strength(self):
        out={k:torch.full((n,),-10.) for k,n in [('arm',len(ARMS)),('body',len(BODIES)),('emotion',len(EMOTIONS)),('eye',len(EYES)),('arm_variant',3),('body_variant',3)]}
        for k in out:out[k][0]=10.
        out['body'][0]=-10;out['body'][6]=10;out['values']=torch.full((12,),.2)
        p=decode(out);self.assertEqual(p['body'],'cajole');self.assertGreater(p['confidence']['body'],.99);self.assertAlmostEqual(p['body_strength'],.2);self.assertAlmostEqual(p['expressions']['脸红'],.2)
    def test_actual_state_and_architecture_contract(self):
        state=state_vector({'last_body':'cajole','last_body_variant':2});self.assertEqual(len(state),44)
        with self.assertRaises(ValueError):state_vector({'face_state':[float('nan')]*12})
        for architecture in ['linear','nonlinear','body_binary']:
            model=PerformancePlanner(architecture).eval();saved={'schema':SCHEMA,'architecture':architecture,'state_dict':model.state_dict()};restored=load_planner(saved).eval()
            with torch.inference_mode():a=model(torch.zeros(1,1024),torch.tensor([state]));b=restored(torch.zeros(1,1024),torch.tensor([state]))
            for k in a:torch.testing.assert_close(a[k],b[k])

if __name__=='__main__':unittest.main()
