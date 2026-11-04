import unittest
from pathlib import Path
import main

class GeneralizationLauncherTests(unittest.TestCase):
    def test_default_launcher_command_keeps_existing_cuda_path(self):
        command=main.latent_worker_command(Path('python'),'cuda')
        self.assertEqual(command[-2:],['--device','cuda']);self.assertNotIn('--stream-experiment',command)
    def test_explicit_large_candidate_uses_cpu_motor_and_cuda_planner(self):
        candidate='experiments/vtuber-v4-generalization-r1/runtime-candidate'
        command=main.latent_worker_command(Path('python'),'cuda',candidate)
        self.assertEqual(command[command.index('--device')+1],'cpu')
        self.assertEqual(command[command.index('--planner-device')+1],'cuda')
        self.assertEqual(command[command.index('--stream-experiment')+1],candidate)
    def test_unknown_or_outside_experiments_are_rejected(self):
        for path in ['../outside','latent','experiments/not-an-existing-experiment']:
            with self.assertRaises(ValueError):main.resolve_stream_experiment(path)

if __name__=='__main__':unittest.main()
