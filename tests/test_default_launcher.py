import unittest
from unittest.mock import patch
import main

NEW='experiments/vtuber-v4-default-r1'
OLD='experiments/vtuber-v4-composition-r2'

class DefaultLauncherTests(unittest.TestCase):
    def test_semantic_launch_uses_generative_worker_without_old_heads(self):
        self.assertEqual(main.latent_worker_command('python','cuda',NEW,semantic=True),['python','-m','semantic.serve','--device','cuda'])

    def test_normal_launch_uses_promoted_profile_and_legacy_is_explicit(self):
        with patch.object(main,'read',return_value=dict(path=NEW,promoted=True,rollback_path=OLD)):
            self.assertEqual(main.choose_stream_profile(),(NEW,'default'))
            self.assertEqual(main.choose_stream_profile(legacy=True),(OLD,'legacy'))
            self.assertEqual(main.choose_stream_profile(explicit=OLD),(OLD,'explicit'))
        command=main.latent_worker_command('python','cuda',NEW)
        self.assertEqual(command[command.index('--device')+1],'cpu')
        self.assertEqual(command[command.index('--planner-device')+1],'cuda')

    def test_unpromoted_configuration_keeps_legacy_and_missing_default_fails(self):
        with patch.object(main,'read',return_value=dict(path=NEW,promoted=False)):
            self.assertEqual(main.choose_stream_profile(),(None,'legacy'))
        with patch.object(main,'read',return_value=dict(path='experiments/missing',promoted=True)):
            with self.assertRaises(ValueError):main.choose_stream_profile()
        with self.assertRaises(ValueError):main.choose_stream_profile(explicit=NEW,legacy=True)

if __name__=='__main__':unittest.main()
