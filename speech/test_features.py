import unittest
import numpy as np
from speech.features import SpeechFeatures


class FeatureTests(unittest.TestCase):
    def test_chunk_boundaries_preserve_mouth_and_emphasis_state(self):
        sr=24000;t=np.arange(sr*3)/sr;wave=np.zeros(len(t),dtype=np.float32)
        for lo,hi,gain in [(.2,.9,.16),(1.5,2.3,.22)]:
            active=(t>=lo)&(t<hi);wave[active]=gain*np.sin(2*np.pi*180*t[active])
        features=SpeechFeatures();clips=[]
        for chunk in np.array_split(wave,6):clips.append(features.push(chunk,sr))
        self.assertAlmostEqual(clips[0]['values'][-1],clips[1]['values'][0],places=5)
        self.assertGreater(max(clips[1]['values']),.6)
        self.assertLess(max(clips[5]['values'][12:]),.02)
        self.assertLess(max(clips[2]['beats'][18:]),.02)
        for clip in clips:
            self.assertEqual(len(clip['values']),31)
            self.assertTrue(all(0<=v<=.85 for v in clip['values']))
            self.assertTrue(all(0<=v<=1 for key in ['beats','energy'] for v in clip[key]))
    def test_silence_never_nods_or_opens_mouth(self):
        result=SpeechFeatures().push(np.zeros(24000),24000)
        self.assertFalse(any(result[key][i] for key in ['values','energy','beats'] for i in range(61)))


if __name__=='__main__':unittest.main()
