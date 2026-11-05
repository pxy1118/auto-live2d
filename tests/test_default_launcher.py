import subprocess
import sys
import unittest
from unittest.mock import patch
import main

NEW='experiments/vtuber-v5-emotion-action-r1'

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

    def test_missing_or_disabled_default_fails_without_fallback(self):
        with patch.object(main,'read',return_value=dict(path=NEW,promoted=False)):
            with self.assertRaises(ValueError):main.choose_stream_profile()
        with patch.object(main,'read',return_value=dict(path='experiments/missing',promoted=True)):
            with self.assertRaises(ValueError):main.choose_stream_profile()

if __name__=='__main__':unittest.main()
