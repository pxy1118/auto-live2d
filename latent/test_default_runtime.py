import json
import unittest
from pathlib import Path
from types import SimpleNamespace
import torch
from transformers import AutoTokenizer
from common import ROOT
from body_intent_runtime import bounded_context,ContextBodyAdapter,ContextBodyPlanner
from semantic_tokens import TokenPerformancePlanner
from generalization_runtime import GeneralizationPlanner
from run_intent_adapter_study import BodyAdapter
from planner_contract import state_vector

class DefaultRuntimeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        torch.set_num_threads(2)
        cls.tokenizer=AutoTokenizer.from_pretrained(ROOT/'models/Qwen3.5-4B',local_files_only=True)

    def test_short_input_is_unchanged_and_long_context_retains_facts_and_latest_turn(self):
        text='这句话必须完整保留。'
        context='事实：正在平静朗读剧本。\n'+'很久以前讨论过花园的布置。'*70+'\n观众：现在读下一行台词。'
        result,truncated=bounded_context(self.tokenizer,text,context,'task_context_first')
        self.assertTrue(truncated);self.assertTrue(result.startswith('事实：正在平静朗读剧本。'))
        self.assertTrue(result.endswith('观众：现在读下一行台词。'));self.assertIn('较早语境已省略',result)
        from context_prompts import prompt
        self.assertLessEqual(len(self.tokenizer(prompt(self.tokenizer,text,result,'task_context_first'),add_special_tokens=False)['input_ids']),512)
        self.assertEqual(bounded_context(self.tokenizer,text,'普通短语境','task_context_first'),('普通短语境',False))
        with self.assertRaises(ValueError):bounded_context(self.tokenizer,'🧬'*240,'','task_context_first')

    def test_deployed_body_matches_research_decoder_with_actual_weights(self):
        folder=ROOT/'experiments/vtuber-v4-default-r1';spec=json.loads((folder/'run.json').read_text())['body_planner']
        saved=torch.load(folder/spec['checkpoint'],map_location='cpu',weights_only=True)
        base=torch.load(ROOT/'experiments/vtuber-v4-generalization-r1/selected-planner.pt',map_location='cpu',weights_only=True)
        reference=BodyAdapter(base).eval();reference.load_state_dict(saved['state_dict'])
        deployed=ContextBodyAdapter(2560).eval();deployed.load_state_dict(saved['state_dict'])
        torch.manual_seed(9);x=torch.randn(2,9,2560);mask=torch.tensor([[False]*6+[True]*3,[False]*9]);state=torch.tensor([state_vector(),state_vector({'emotion':'angry'})])
        with torch.inference_mode():a=reference(x,mask,state);b=deployed(x,mask,state)
        for key in a:torch.testing.assert_close(a[key],b[key])

    def test_shared_encoder_is_reused_and_cleared_without_loading_another_backbone(self):
        calls=[]
        class Backbone:
            def __call__(self,input_ids,**kwargs):calls.append(1);return SimpleNamespace(last_hidden_state=torch.zeros(1,input_ids.shape[1],2560))
        encoder=SimpleNamespace(tokenizer=self.tokenizer,backbone=Backbone())
        folder=ROOT/'experiments/vtuber-v4-default-r1';spec=json.loads((folder/'run.json').read_text())['body_planner']
        body=ContextBodyPlanner(folder,spec,encoder,'cpu')
        self.assertIs(body.encoder,encoder);self.assertTrue(all(not p.requires_grad for p in body.model.parameters()))
        body.plan('你好。','普通问候。');body.plan('你好。','普通问候。',{'last_body':'lean'})
        self.assertEqual(len(calls),1);body.close();self.assertIsNone(body.encoder)
        self.assertEqual(body.semantic.cache_info().currsize,0)

    def test_body_override_preserves_all_other_plan_channels(self):
        p=GeneralizationPlanner.__new__(GeneralizationPlanner);p.device='cpu';p.mode='full_attention';p.thresholds={}
        p.encoder=SimpleNamespace(encode=lambda *a:(torch.randn(5,24),{'tokens':5}));p.model=TokenPerformancePlanner(24,width=32).eval()
        baseline=p.plan('固定台词','事实语境')
        p.body_planner=SimpleNamespace(plan=lambda *args:dict(body='cajole',body_strength=.23,confidence=.18),last_timing={'context_truncated':False})
        current=p.plan('固定台词','事实语境')
        for key in baseline:
            if key=='confidence':
                for part in ['arm','emotion','eye']:self.assertEqual(current[key][part],baseline[key][part])
            elif key not in ['body','body_strength']:self.assertEqual(current[key],baseline[key])
        self.assertEqual(current['body'],'cajole');self.assertEqual(current['body_strength'],.23)
        self.assertEqual(current['confidence']['body'],.18)
        p.semantic.cache_clear()

if __name__=='__main__':unittest.main()
