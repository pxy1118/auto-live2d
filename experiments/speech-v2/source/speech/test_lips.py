import unittest
import numpy as np
from speech.lips import mouth_envelope

class MouthTests(unittest.TestCase):
    def test_actual_energy_and_pauses_drive_the_mouth(self):
        sr=24000;t=np.arange(sr*2)/sr;wave=np.zeros_like(t)
        wave[(t>.3)&(t<.8)]=.2*np.sin(2*np.pi*180*t[(t>.3)&(t<.8)])
        wave[(t>1.2)&(t<1.6)]=.1*np.sin(2*np.pi*210*t[(t>1.2)&(t<1.6)])
        result=mouth_envelope(wave,sr);a=np.array(result['values'])
        self.assertEqual(len(a),121);self.assertEqual(result['duration_ms'],2000)
        self.assertLess(a[:15].max(),.001);self.assertGreater(a[25:40].max(),.7)
        self.assertLess(a[60:66].max(),.04);self.assertGreater(a[80:90].max(),.4)
        self.assertTrue((a<=.85).all());self.assertEqual(a[-1],0)
    def test_silence_and_invalid_waveforms(self):
        self.assertFalse(any(mouth_envelope(np.zeros(24000),24000)['values']))
        for wave in [[],[float('nan')],[float('inf')]]:
            with self.assertRaises(ValueError):mouth_envelope(wave,24000)

if __name__=='__main__':unittest.main()
