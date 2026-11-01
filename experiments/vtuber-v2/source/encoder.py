import time
import torch
from transformers import AutoTokenizer, Qwen3_5ForConditionalGeneration
from common import ROOT, SOURCE, feature_message


class SemanticEncoder:
    def __init__(self, device="cuda"):
        self.device=device
        if device == "cuda" and not torch.cuda.is_available(): raise RuntimeError("CUDA 不可用")
        path=ROOT / "models" / SOURCE["repo_id"].split("/")[-1]
        self.tokenizer=AutoTokenizer.from_pretrained(path, local_files_only=True)
        self.wrapper=Qwen3_5ForConditionalGeneration.from_pretrained(path, local_files_only=True, dtype=torch.bfloat16 if device=="cuda" else torch.float32, attn_implementation="sdpa")
        self.backbone=self.wrapper.model.language_model.to(device).eval()
        self.wrapper.requires_grad_(False)

    def encode(self, text, context="", style="natural"):
        import json
        begin=time.perf_counter()
        content=json.dumps(feature_message(text,context,style),ensure_ascii=False)
        prompt=self.tokenizer.apply_chat_template([{"role":"user","content":content}],tokenize=False,add_generation_prompt=True,enable_thinking=False)
        encoded=self.tokenizer(prompt,return_tensors="pt").to(self.device)
        if encoded.input_ids.shape[1]>512: raise ValueError("输入超过 512 token，请缩短语境")
        if self.device=="cuda": torch.cuda.synchronize()
        with torch.inference_mode(): h=self.backbone(**encoded,use_cache=False,return_dict=True).last_hidden_state[0]
        feature=h[-16:].float(); padding=16-feature.shape[0]
        if padding: feature=torch.cat([torch.zeros(padding,h.shape[-1],device=self.device),feature])
        mask=torch.arange(16,device=self.device)<padding
        if self.device=="cuda": torch.cuda.synchronize()
        return feature.detach(), mask, {"tokens":encoded.input_ids.shape[1],"encoder_ms":(time.perf_counter()-begin)*1000}
