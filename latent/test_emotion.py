"""v6 latent tests.

Allow both cd latent && python -m unittest test_* and
python -m unittest latent.test_* from the repository root.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import json
import unittest

import torch

from common import ROOT
from emotion import (
    EmotionClassifier, build_timeline, emotion_inputs, emotion_spans, speaker_text,
    validate_timeline,
)
from emotion_config import LABELS, THRESHOLDS


def _spans(text):
    spans = emotion_spans(text)
    return spans, emotion_inputs(text, spans)


class ObservationTests(unittest.TestCase):
    def test_shared_multiline_fixtures_match_backend_observations(self):
        fixture = json.loads((ROOT / 'tests/fixtures/emotion-curve-v2.json').read_text(encoding='utf-8'))
        self.assertGreaterEqual(len(fixture['observation_cases']), 5)
        for case in fixture['observation_cases']:
            with self.subTest(name=case['name']):
                text = case['text']
                spans, windows = _spans(text)
                actual = build_timeline(text, spans, windows, [{} for _ in spans])
                self.assertEqual(actual, case['timeline'])
                self.assertEqual(''.join(text[point['start']:point['end']] for point in actual['points']), text)

    def test_quote_scope_is_structural_and_never_rewrites_unquoted_text(self):
        self.assertEqual(speaker_text('她说“我很生气”，我只是读留言。'), '她说，我只是读留言。')
        self.assertEqual(speaker_text('我没有生气，只是在解释。'), '我没有生气，只是在解释。')
        self.assertEqual(speaker_text('“我很生气”'), '')
        self.assertEqual(speaker_text('他说「她说『生气』」，我很开心。'), '他说，我很开心。')

    def test_spans_cover_text_contiguously_in_code_points(self):
        text = '你好😀，今天好开心呀，可是这个消息让我很难过。'
        spans, windows = _spans(text)
        self.assertGreater(len(spans), 1)
        self.assertEqual(spans[0]['start'], 0)
        self.assertEqual(spans[-1]['end'], len(text))
        self.assertEqual(''.join(text[span['start']:span['end']] for span in spans), text)
        self.assertTrue(all(window.endswith(span['text']) for window, span in zip(windows, spans)))

    def test_causal_window_never_contains_later_phrases(self):
        text = '今天好开心呀，可是这个消息让我很难过。'
        spans, windows = _spans(text)
        self.assertNotIn('难过', windows[0])
        self.assertTrue(windows[-1].endswith(spans[-1]['text']))
        previous = '其实我一直很担心。'
        spans, windows = _spans('你突然这样夸我，我有点不好意思啦。')
        windows = emotion_inputs('你突然这样夸我，我有点不好意思啦。', spans, previous)
        self.assertTrue(windows[0].startswith('其实我一直很担心。'))

    def test_invalid_text_is_rejected(self):
        with self.assertRaises(ValueError):
            emotion_spans(None)
        with self.assertRaises(ValueError):
            build_timeline('', [], [], [], THRESHOLDS)


@unittest.skipUnless(torch.cuda.is_available(), '需要 CUDA 运行真实情感分类器')
class ActualEmotionModelTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        torch.set_num_threads(4)
        cls.classifier = EmotionClassifier(ROOT / 'latent/emotion-source.json')

    def test_six_chinese_samples_expose_all_28_raw_scores(self):
        samples = [
            ('大家好呀，今天很高兴见到你。', 'joy'),
            ('太过分了，我真的很生气！', 'anger'),
            ('我有点难过，想安静一会儿。', 'sadness'),
            ('你突然这样夸我，我有点不好意思啦。', 'embarrassment'),
            ('我没有生气，只是在解释。', None),
            ('她说“我太生气了”，我只是在读这句留言。', None),
        ]
        results = self.classifier.classify_many([text for text, _ in samples])
        self.assertEqual(len(results), len(samples))
        for (text, target), result in zip(samples, results):
            self.assertTrue(result['probabilities'], text)
            self.assertEqual(set(result['probabilities']), set(LABELS))
            self.assertEqual(len(result['probabilities']), 28)
            self.assertTrue(all(0. <= value <= 1. for value in result['probabilities'].values()))
            if target is not None:
                self.assertGreater(result['probabilities'][target], THRESHOLDS[target], text)
        self.assertEqual(self.classifier.info()['parameters'], 307551772)
        self.assertTrue(all(parameter.is_cuda for parameter in self.classifier.model.parameters()))
        self.assertEqual(next(self.classifier.model.parameters()).dtype, torch.float32)

    def test_fully_quoted_text_uses_default_policy_without_invented_posterior(self):
        result = self.classifier.classify_many(['“我好生气！”'])[0]
        self.assertEqual(result['probabilities'], {})
        self.assertTrue(result['policy_default'])
        self.assertTrue(result['quoted_text_excluded'])

    def test_timeline_structure_covers_text_and_quotes_are_excluded(self):
        text = '今天真的很开心，可是他说“我太难过了”，我只好安慰他。'
        timeline = self.classifier.timeline(text)
        validate_timeline(timeline, text)
        self.assertEqual(timeline['schema'], 'emotion.timeline.v2')
        self.assertEqual(timeline['labels'], list(LABELS))
        self.assertEqual(set(timeline['thresholds']), set(LABELS))
        points = timeline['points']
        self.assertGreaterEqual(len(points), 2)
        self.assertEqual(points[0]['start'], 0)
        self.assertEqual(points[-1]['end'], len(text))
        for point in points:
            self.assertEqual(''.join(text[point['start']:point['end']]).strip(), point['text'])
            self.assertTrue(point['window_text'].endswith(point['text']))
            if point['policy_default']:
                self.assertEqual(point['probabilities'], {})
            else:
                self.assertEqual(set(point['probabilities']), set(LABELS))
                self.assertIn('quoted_text_excluded', point)

    def test_emotion_context_changes_the_first_window(self):
        text = '我有点不好意思啦。'
        plain = self.classifier.timeline(text)
        warmed = self.classifier.timeline(text, '你突然这样夸我，')
        self.assertNotEqual(plain['points'][0]['window_text'], warmed['points'][0]['window_text'])
        self.assertTrue(warmed['points'][0]['window_text'].startswith('你突然这样夸我，'))
        validate_timeline(warmed, text)

    def test_empty_and_invalid_inputs_are_rejected(self):
        with self.assertRaises(ValueError):
            self.classifier.timeline('')
        with self.assertRaises(ValueError):
            self.classifier.timeline('   ')
        with self.assertRaises(ValueError):
            self.classifier.timeline(None)
        timeline = self.classifier.timeline('我今天很开心。')
        broken = json.loads(json.dumps(timeline))
        broken['points'][0]['start_fraction'] = 0.5
        with self.assertRaises(ValueError):
            validate_timeline(broken, '我今天很开心。')
        broken = json.loads(json.dumps(timeline))
        broken['points'][0]['probabilities'] = {}
        with self.assertRaises(ValueError):
            validate_timeline(broken, '我今天很开心。')


if __name__ == '__main__':
    unittest.main()
