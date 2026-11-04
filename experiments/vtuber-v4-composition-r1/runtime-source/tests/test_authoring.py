import json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import numpy as np
from scripts.v4 import build_dataset as base
from scripts.v4 import build_body

IDS='AngleX AngleY AngleZ PositionX PositionY PositionZ LeanInput ShoulderX ShoulderYy ParamEyeBallX ParamEyeBallY EyeSmile ParamBrowLY ParamBrowRY ParamBrowLAngle ParamBrowRAngle BrowInnerUp LEyeSquint REyeSquint ParamEyeLOpen ParamEyeROpen ParamMouthForm MouthX Mouthpucker CheeckPuff Param36 Param39 Param41 Param42 Param43 Param62 Param59 Param60 Param61 Movement1 Movement2 Movement3 Param40'.split()
def profile():return {'sha256':'fixture','channels':[{'id':id,'min':-30 if id.startswith(('Angle','Position')) else -1,'max':30 if id.startswith(('Angle','Position')) else 1.5 if id.endswith('Open') else 1,'default':1 if id.endswith('Open') else 0} for id in IDS]}
def audio():return {'file':'audio/test.wav','sha256':'fixture','duration_ms':3000,'features':{'energy':[.5]*181,'beats':[.2]*181}}
class AuthoringTests(unittest.TestCase):
    def test_fractional_arm_and_face_values_survive_integer_defaults(self):
        s={'id':'s014','text':'测试','context':'解释','emotion':'shy','intent':'point','split':'train'}
        c=base.make_clip(s,4,profile(),audio());v=np.asarray(c['values'])
        self.assertGreater(np.abs(v[:,IDS.index('Param36')]).max(),.03)
        self.assertGreater(np.abs(v[:,IDS.index('Param62')]).max(),.03)
        self.assertGreater(v[:,IDS.index('Mouthpucker')].max(),.1)
        self.assertGreater(v[:,IDS.index('ParamEyeLOpen')].min(),.5)
        self.assertLess(v[:,IDS.index('ParamEyeLOpen')].min(),.99)
    def test_wave_has_visible_fractional_arm_targets(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);old=root/'old';out=root/'new';old.mkdir()
            for name,data in [('profile.json',profile()),('manifest.json',{'items':[]}),('sequences.json',[])]:base.write(old/name,data)
            with patch.object(build_body,'OLD',old),patch.object(build_body,'OUT',out),patch.object(build_body,'WORDS',{'wave':['你好']}),patch.object(base,'fetch',return_value={}),patch.object(base,'audio_for',return_value=audio()),patch.object(base,'OUT',out):
                build_body.build()
            c=json.loads((out/'clips/body-wave-00-v3.json').read_text(encoding='utf-8'));v=np.asarray(c['values'])
            self.assertGreater(v[:,IDS.index('Param36')].max(),.7)
            self.assertGreater(v[:,IDS.index('Param42')].ptp() if hasattr(v[:,0],'ptp') else np.ptp(v[:,IDS.index('Param42')]),.3)
if __name__=='__main__':unittest.main()
