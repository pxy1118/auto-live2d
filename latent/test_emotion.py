import json,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import torch
from common import ROOT
from emotion import EmotionClassifier,avatar_affect,speaker_text,curve_evidence,emotion_spans,emotion_inputs,GROUPS
from emotion_action import EmotionActionPolicy
from streaming import StreamingPolicy

class EmotionAdapterTests(unittest.TestCase):
    def test_quote_scope_is_structural_and_does_not_rewrite_unquoted_text(self):
        self.assertEqual(speaker_text('她说“我很生气”，我只是读留言。'),'她说，我只是读留言。')
        self.assertEqual(speaker_text('我没有生气，只是在解释。'),'我没有生气，只是在解释。')
        self.assertEqual(speaker_text('“我很生气”'),'')
        self.assertEqual(speaker_text('他说「她说『生气』」，我很开心。'),'他说，我很开心。')
    def test_probability_threshold_and_render_strength_remain_distinct(self):
        thresholds=json.loads((ROOT/'models/multilingual-emotions-base/thresholds.json').read_text())
        scores={label:0. for label in thresholds};scores['joy']=.4
        result=avatar_affect(scores,thresholds)
        self.assertEqual(result['emotion'],'happy');self.assertEqual(result['probability'],.4);self.assertEqual(result['threshold'],.28)
        self.assertNotEqual(result['strength'],result['probability'])
        scores['joy']=.1;self.assertEqual(avatar_affect(scores,thresholds)['emotion'],'neutral')
    def test_classifier_conditions_the_motion_model_and_an_explicit_director_wins(self):
        policy=EmotionActionPolicy.__new__(EmotionActionPolicy);policy.load=lambda:None;policy.motion_updates=0
        capture=[]
        with patch.object(StreamingPolicy,'predict',lambda _self,data:capture.append(data) or {}):
            policy.predict({'affect':{'emotion':'happy','strength':.65}})
            self.assertEqual(capture[-1]['director'][1],.65);self.assertEqual(capture[-1]['director'][8],1);self.assertFalse(capture[-1]['include_plan'])
            explicit=[0.,0.,.9,0.,0.,0.,0.,.9,1.]
            policy.predict({'director':explicit,'affect':{'emotion':'happy','strength':.65}})
            self.assertEqual(capture[-1]['director'],explicit)
    def test_continuous_evidence_is_not_a_probability_or_a_winner_take_all(self):
        thresholds=json.loads((ROOT/'models/multilingual-emotions-base/thresholds.json').read_text())
        scores={label:0. for label in thresholds};scores.update(joy=.7,embarrassment=.7)
        result=curve_evidence(scores,thresholds);self.assertGreater(result['weights']['happy'],.2);self.assertGreater(result['weights']['shy'],.2)
        self.assertLessEqual(sum(result['weights'].values()),1.)
        scores={label:0. for label in thresholds};scores['joy']=thresholds['joy']+1e-8
        self.assertLess(curve_evidence(scores,thresholds)['weights']['happy'],.001)
        scores.update(joy=0.,embarrassment=.79,remorse=.78)
        result=curve_evidence(scores,thresholds)
        self.assertGreater(result['weights']['shy'],.65);self.assertLess(result['weights']['sad'],.25)
        self.assertEqual(scores['remorse'],.78)
    def test_phrase_observations_preserve_quotes_and_unicode_offsets(self):
        text='你好😀，今天好开心呀，可是这个消息让我很难过。'
        spans=emotion_spans(text);self.assertGreater(len(spans),1);self.assertEqual(''.join(text[s['start']:s['end']] for s in spans),text)
        quoted='她说“我好生气，你太过分了！”，我只是在读留言。'
        self.assertEqual(len(emotion_spans(quoted)),1)
        inputs=emotion_inputs(text,spans);self.assertNotIn('难过',inputs[0]);self.assertTrue(inputs[-1].endswith(spans[-1]['text']))
    def test_motion_conditions_use_the_same_continuous_mixture_as_the_renderer(self):
        policy=EmotionActionPolicy.__new__(EmotionActionPolicy);policy.load=lambda:None;policy.motion_updates=0
        capture=[];weights=dict.fromkeys(GROUPS,0.);weights.update(happy=.4,shy=.3)
        with patch.object(StreamingPolicy,'predict',lambda _self,data:capture.append(data) or {}):
            policy.predict({'affect':{'weights':weights}})
            self.assertEqual(capture[-1]['director'][1],.4);self.assertEqual(capture[-1]['director'][3],.3)
            self.assertEqual(capture[-1]['director'][7],.4)
            with self.assertRaises(ValueError):policy.predict({'affect':{'weights':{**weights,'angry':float('nan')}}})

class ActualEmotionModelTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        torch.set_num_threads(4);cls.classifier=EmotionClassifier(ROOT/'latent/emotion-source.json')
    def test_native_chinese_sanity_cases_with_actual_pinned_weights(self):
        texts=['大家好呀，今天很高兴见到你。','太过分了，我真的很生气！','我有点难过，想安静一会儿。','你突然这样夸我，我有点不好意思啦。','我没有生气，只是在解释。','她说“我太生气了”，我只是在读这句留言。']
        results=self.classifier.classify_many(texts)
        self.assertEqual([row['emotion'] for row in results],['happy','angry','sad','shy','neutral','neutral'])
        self.assertTrue(results[-1]['quoted_text_excluded'])
        self.assertEqual(self.classifier.info()['parameters'],307551772)
        self.assertEqual(self.classifier.info()['device'],'cuda')
        self.assertTrue(all(param.is_cuda for param in self.classifier.model.parameters()))
        self.assertEqual(next(self.classifier.model.parameters()).dtype,torch.float32)
    def test_fully_quoted_input_uses_neutral_policy_without_fabricated_probability(self):
        result=self.classifier.classify_many(['“我好生气！”'])[0]
        self.assertEqual(result['emotion'],'neutral');self.assertEqual(result['probability'],0.)
        self.assertTrue(result['policy_default']);self.assertEqual(result['scores'],{})
        self.assertTrue(all(value==0 for value in result['weights'].values()))

    def test_one_encoder_action_contract_keeps_sentence_plans_and_honest_emotion_scores(self):
        policy=EmotionActionPolicy(SimpleNamespace(device='cuda'),'experiments/vtuber-v5-emotion-action-r1');policy.emotion_classifier=self.classifier
        policy.semantic=lambda *args:(torch.zeros(16,1024,device='cuda'),torch.zeros(16,dtype=torch.bool,device='cuda'),{'tokens':16,'context_truncated':False})
        text='大家好呀。谢谢你一直陪着我。';parts=[{'clause':3,'text':'大家好呀。','start':0,'end':5},{'clause':4,'text':'谢谢你一直陪着我。','start':5,'end':len(text)}]
        result=policy.prefill({'text':text,'context':'和观众聊天','clauses':parts})
        self.assertEqual(len(result['performance_plans']),2)
        self.assertFalse(policy.info()['uses_4b']);self.assertIsNone(policy.token_planner)
        self.assertEqual(policy.info()['execution']['emotion_device'],'cuda')
        self.assertEqual(list(policy.models),['regression'])
        for row in result['performance_plans']:
            self.assertEqual(row['performance_plan']['confidence']['emotion'],row['affect']['probability'])
            self.assertEqual(row['performance_plan']['emotion_threshold'],row['affect']['threshold'])
        with self.assertRaises(ValueError):policy.prefill({'text':text,'clauses':[dict(parts[0],start=99)]})
        text='今天很开心呀，看到你真好，可是那样做太过分了，我真的很生气。'
        result=policy.prefill({'text':text})
        points=result['affect_timeline']['points'];self.assertGreater(len(points),1)
        self.assertTrue(any(p['weights']['happy']>.2 for p in points));self.assertTrue(any(p['weights']['angry']>.2 for p in points))
        self.assertTrue(all(len(p['probabilities'])==28 for p in points))
        text='你突然这样夸我，我有点不好意思啦。'
        result=policy.prefill({'text':text});points=result['affect_timeline']['points']
        self.assertGreater(points[-1]['weights']['shy'],.5);self.assertIn('夸我',points[-1]['window_text'])
        result=policy.prefill({'text':'我有点不好意思啦。','emotion_context':'你突然这样夸我，'})
        self.assertGreater(result['affect_timeline']['points'][0]['weights']['shy'],.5)

if __name__=='__main__':unittest.main()
