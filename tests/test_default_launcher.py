import subprocess
import sys
import unittest
from unittest.mock import patch
import main

NEW='experiments/vtuber-v6-acting-feedback-r3-final'

class DefaultLauncherTests(unittest.TestCase):
    def test_removed_launch_modes_are_not_accepted(self):
        for option in ['--legacy','--semantic']:
            with self.subTest(option=option):
                result=subprocess.run([sys.executable,str(main.ROOT/'main.py'),option],capture_output=True,text=True)
                self.assertEqual(result.returncode,2)
                self.assertIn('unrecognized arguments',result.stderr)

    def test_normal_launch_uses_current_profile_and_cuda(self):
        with patch.object(main,'read',return_value=dict(path=NEW,promoted=True)):
            self.assertEqual(main.choose_stream_profile(),(NEW,'default'))
            self.assertEqual(main.choose_stream_profile(explicit=NEW),(NEW,'explicit'))
        command=main.latent_worker_command('python','cuda',NEW)
        self.assertEqual(command[command.index('--device')+1],'cuda')
        self.assertNotIn('--planner-device',command)
        self.assertNotIn('semantic.serve',command)

    def test_new_runtime_package_is_accepted_only_with_v6_schema(self):
        with patch.object(main,'read',return_value={'schema':'vtuber.v6.native28_motion','promoted':False}):
            command=main.latent_worker_command('python','cuda',NEW)
            self.assertIn('--stream-experiment',command)
        with patch.object(main,'read',return_value={'schema':'emotion_action.runtime.v1'}):
            with self.assertRaises(ValueError):main.latent_worker_command('python','cuda',NEW)

if __name__=='__main__':unittest.main()
