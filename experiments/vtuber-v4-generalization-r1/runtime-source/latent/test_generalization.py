import json
import unittest
from pathlib import Path
import torch
from semantic_tokens import TokenPerformancePlanner,pad_features,representation
from generalization_data import metrics,CHOICES
from planner_contract import state_vector
ROOT=Path(__file__).resolve().parents[1]

class GeneralizationTests(unittest.TestCase):
    def setUp(self):torch.set_num_threads(2);torch.manual_seed(17)
    def test_masked_padding_cannot_change_predictions(self):
        model=TokenPerformancePlanner(24,width=32).eval()
        x,mask=pad_features([torch.randn(3,24),torch.randn(8,24)],'cpu');state=torch.zeros(2,44)
        with torch.inference_mode():
            a=model(x,mask,state);x[mask]=torch.randn_like(x[mask])*100;b=model(x,mask,state)
        for k in a:torch.testing.assert_close(a[k],b[k])
    def test_history_changes_decisions_and_roundtrip_is_exact(self):
        model=TokenPerformancePlanner(24,width=32).eval();restored=TokenPerformancePlanner(24,width=32).eval();restored.load_state_dict(model.state_dict())
        x=torch.randn(1,12,24);mask=torch.zeros(1,12,dtype=torch.bool);a=torch.tensor([state_vector()]);b=torch.tensor([state_vector({'emotion':'angry','last_body':'cajole'})])
        with torch.inference_mode():first=model(x,mask,a);second=model(x,mask,b);same=restored(x,mask,a)
        self.assertFalse(torch.allclose(first['emotion'],second['emotion']))
        for k in first:torch.testing.assert_close(first[k],same[k])
    def test_both_ablation_modes_preserve_expected_information(self):
        h=torch.arange(30*24,dtype=torch.float32).reshape(30,24)
        self.assertEqual(representation(h,'tail16_mean').shape,(1,24))
        self.assertEqual(representation(h,'full_attention').shape,(30,24))
        torch.testing.assert_close(representation(h,'tail16_mean')[0],h[-16:].mean(0))
        with self.assertRaises(ValueError):representation(h,'unknown')
    def test_metrics_distinguish_raw_and_executed_props(self):
        target={'arm':'grass','body':'none','emotion':'keep','eye':'normal','arm_variant':0,'body_variant':0,'expressions':{},'body_strength':0,'eye_strength':0,'arm_hold_ms':1200,'body_hold_ms':2100,'face_hold_ms':3200,'onset_ms':240}
        rows=[{'target':target}];output={k:torch.full((1,len(v)),-4.) for k,v in CHOICES.items()}
        for k,v in CHOICES.items():output[k][0,v.index(target[k])]=0
        output['arm'][0,0]=-.2;output['values']=torch.zeros(1,12)
        self.assertEqual(metrics(output,rows)['arm']['correct_active_recall'],1)
        self.assertEqual(metrics(output,rows,{'arm':.85})['arm']['correct_active_recall'],0)
    def test_dataset_families_and_context_pairs_are_isolated(self):
        from common import sha
        folder=ROOT/'datasets/vtuber-v4-generalization-v1';manifest=json.loads((folder/'manifest.json').read_text());owners={};families={}
        for split in ['train','validation','test']:
            path=folder/f'{split}.jsonl';self.assertEqual(sha(path),manifest['splits'][split]['sha256'])
            # Integrity audit only. Final-test target labels are not inspected.
            for line in path.read_text(encoding='utf-8').splitlines():
                r=json.loads(line);owners.setdefault(r['text'],set()).add(split);families.setdefault(r['semantic_group'],set()).add(split)
                self.assertEqual(len(r['state_vector']),44)
                if split=='train':self.assertNotIn((r['target']['arm'],r['target']['body']),[('thanks','cajole'),('point','tilt')])
        self.assertTrue(all(len(v)==1 for v in owners.values()));self.assertTrue(all(len(v)==1 for v in families.values()))
    def test_cpu_motor_prefill_does_not_gate_tts_or_duplicate_work(self):
        from streaming import StreamingPolicy
        from concurrent.futures import ThreadPoolExecutor
        from threading import Event
        from types import SimpleNamespace
        unblock=Event();started=Event();calls=[]
        p=StreamingPolicy(SimpleNamespace(device='cpu'));p.load=lambda:None
        p.token_planner=SimpleNamespace(plan=lambda *a:{'schema':'performance.plan.v1'})
        p.planner=p.token_planner;p.motor_executor=ThreadPoolExecutor(max_workers=1)
        def semantic(*args):
            calls.append(args);started.set();unblock.wait(5);return 'feature','mask',{'context_truncated':False}
        p.semantic=semantic
        try:
            result=p.prefill({'text':'你好。'});self.assertTrue(started.wait(1));self.assertTrue(result['motor_prefill_pending'])
            p.prefill({'text':'你好。'});self.assertEqual(len(calls),1)
            unblock.set();self.assertEqual(p.motor_prefills[('你好。','')].result()[0],'feature')
        finally:unblock.set();p.motor_executor.shutdown()
    def test_closing_a_planner_releases_its_instance_semantic_cache(self):
        from generalization_runtime import GeneralizationPlanner
        from types import SimpleNamespace
        p=GeneralizationPlanner.__new__(GeneralizationPlanner);p.device='cpu';p.mode='full_attention';p.thresholds={}
        p.encoder=SimpleNamespace(encode=lambda *a:(torch.randn(5,24),{'tokens':5}));p.model=TokenPerformancePlanner(24,width=32).eval()
        p.plan('first','');p.plan('second','');self.assertEqual(p.semantic.cache_info().currsize,2)
        p.close();self.assertEqual(p.semantic.cache_info().currsize,0);self.assertIsNone(p.model);self.assertIsNone(p.encoder)
    def test_complete_tensor_cache_recovers_missing_metadata_without_loading_a_model(self):
        import tempfile,sys,io
        from contextlib import redirect_stdout
        from unittest.mock import patch
        import cache_generalization_features as caching
        from common import sha
        from generalization_data import key
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);data=root/'data';data.mkdir();out=root/'cache';out.mkdir();source=root/'source.json'
            source.write_text(json.dumps({'repo_id':'test/encoder','revision':'pinned'}));row={'text':'hello','context':''}
            for split in ['train','validation']:(data/f'{split}.jsonl').write_text(json.dumps(row)+'\n')
            (data/'manifest.json').write_text(json.dumps({'splits':{s:{'sha256':sha(data/f'{s}.jsonl')} for s in ['train','validation']}}))
            fingerprint={'encoder_source_sha256':sha(source),'dataset_manifest_sha256':sha(data/'manifest.json'),'splits':['train','validation']}
            torch.save({'fingerprint':fingerprint,'features':{key(row):torch.zeros(2,24)},'timings':[{'encoder_ms':1.5,'tokens':2}]},out/'tokens.pt')
            args=['cache','--source',str(source),'--dataset',str(data),'--output',str(out)]
            with patch.object(sys,'argv',args),patch.object(caching,'FrozenTokenEncoder',side_effect=AssertionError('Must not reload')),redirect_stdout(io.StringIO()):caching.main()
            meta=json.loads((out/'cache.json').read_text());self.assertTrue(meta['metadata_recovered_from_complete_cache']);self.assertFalse(meta['test_encoded']);self.assertEqual(meta['tokens_sha256'],sha(out/'tokens.pt'))

if __name__=='__main__':unittest.main()
