"""Causality checks for the actual PCM extractor used by the new study."""
import unittest
import numpy as np
from speech.features import SpeechFeatures


class ProsodyAudioTests(unittest.TestCase):
    def test_future_pcm_cannot_change_past_audio_features(self):
        sr = 24000
        t = np.arange(sr*4)/sr
        pcm = (.1*np.sin(2*np.pi*240*t)*(np.sin(2*np.pi*2*t)>.2)).astype('float32')
        changed = pcm.copy(); changed[2*sr:] = -.4
        a, b = SpeechFeatures().push(pcm, sr), SpeechFeatures().push(changed, sr)
        for key in ['values','energy','beats']:
            np.testing.assert_array_equal(a[key][:120], b[key][:120])
        np.testing.assert_array_equal(a['motion'][:40], b['motion'][:40])

    def test_silence_cannot_generate_emphasis(self):
        result = SpeechFeatures().push(np.zeros(24000*5, dtype='float32'), 24000)
        self.assertTrue(all(x == 0 for x in result['beats']))
        self.assertTrue(all(x == 0 for x in result['energy']))


if __name__ == '__main__':
    unittest.main()
