"""Use pinned CUDA-graph inference without changing the training environment."""
import sys
from speech.config import ROOT, read, sha


def accelerate(model, device):
    import torch
    vendor = ROOT / 'vendor/faster-qwen3-tts'
    source = read(vendor / 'SOURCE.json')
    for entry in source['files']:
        if sha(vendor / entry['file']) != entry['sha256']:
            raise ValueError('TTS accelerator source changed: ' + entry['file'])
    sys.path.insert(0, str(vendor))
    from faster_qwen3_tts import FasterQwen3TTS
    from faster_qwen3_tts.predictor_graph import PredictorGraph
    from faster_qwen3_tts.talker_graph import TalkerGraph
    talker = model.model.talker
    config = model.model.config.talker_config
    predictor = PredictorGraph(talker.code_predictor, talker.code_predictor.model.config,
                               config.hidden_size, device=device, dtype=torch.bfloat16,
                               do_sample=True, top_k=50, temperature=.9)
    graph = TalkerGraph(talker.model, config, device=device, dtype=torch.bfloat16, max_seq_len=1536)
    fast = FasterQwen3TTS(model, predictor, graph, device=device, dtype=torch.bfloat16, max_seq_len=1536)
    fast.warmup()
    return fast, {'repository': source['repository'], 'revision': source['revision'], 'version': source['version']}
