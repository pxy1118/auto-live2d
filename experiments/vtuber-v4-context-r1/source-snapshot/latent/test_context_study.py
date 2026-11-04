"""Contract, causal field order and honest same-text comparison tests."""
import json
import unittest
import torch
from context_prompts import messages,parse_direct
from run_context_study import contrast_metrics

class ContextTests(unittest.TestCase):
    def test_input_variants_preserve_payload_and_do_not_accept_annotations(self):
        for mode in ['legacy_json','context_first','task_context_first']:
            mm=messages('当前台词','过去对白',mode);content=mm[-1]['content'];payload=json.loads(content)
            self.assertEqual(payload,dict(text='当前台词',context='过去对白',style='natural'))
            self.assertEqual(set(payload),{'text','context','style'})
            self.assertEqual(content.index('"context"')<content.index('"text"'),mode!='legacy_json')
        with self.assertRaises(ValueError):messages('台词','事实','unknown')
        with self.assertRaises(TypeError):messages('台词','事实','context_first',annotation='required')

    def test_direct_contract_is_strict_and_invalid_is_not_silently_repaired(self):
        value=parse_direct('{"necessity":"required","body":"lean","strength":0.6}')
        self.assertEqual(value['body'],'lean')
        invalid=[
            '```json\n{"necessity":"forbidden","body":"none","strength":0}\n```',
            '{"necessity":"forbidden","body":"lean","strength":0.2}',
            '{"necessity":"required","body":"none","strength":0}',
            '{"necessity":"optional","body":"none","strength":0.2}',
            '{"necessity":"optional","body":"lean","strength":true}',
            '{"necessity":"optional","body":"lean","strength":NaN}',
            '{"necessity":"optional","body":"cheer","strength":0.5}',
            '{"necessity":"optional","body":"lean","strength":0.2,"outfit":"new"}',
        ]
        for text in invalid:
            with self.subTest(text=text),self.assertRaises(ValueError):parse_direct(text)

    def test_same_action_may_be_valid_in_both_contexts(self):
        rows=[dict(id='a',scene_id='a',family='same',text='同一句话',body_annotation=dict(acceptable=['lean','turn'])),
              dict(id='b',scene_id='b',family='same',text='同一句话',body_annotation=dict(acceptable=['none','lean']))]
        result=contrast_metrics(rows,torch.tensor([1,1]));self.assertEqual(result['both_acceptable'],1)
        self.assertFalse(result['details'][0]['disjoint_sets'])
        rows[1]['body_annotation']['acceptable']=['none']
        result=contrast_metrics(rows,torch.tensor([1,1]));self.assertEqual(result['both_acceptable'],0)
        self.assertTrue(result['details'][0]['disjoint_sets'])

if __name__=='__main__':unittest.main()
