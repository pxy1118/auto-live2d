import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROFILE = json.loads((ROOT / "latent/profile.json").read_text(encoding="utf-8"))
CHANNELS = PROFILE["channels"]
SOURCE = json.loads((ROOT / "latent/encoder-source.json").read_text(encoding="utf-8"))
HORIZON, HZ = 64, 10
ASSET_HASH = "77bea8c13820edd4167ebda37c5a5bd78b782186bdf6c58a5c47bf5efff79df6"
RIGHT, LEFT = ["default", "point_index", "grass"], ["default", "chest"]


def read(path): return json.loads(Path(path).read_text(encoding="utf-8-sig"))
def write(path, value): Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")
def sha(path):
    with Path(path).open("rb") as stream: return hashlib.file_digest(stream, "sha256").hexdigest()
def digest(value): return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def feature_message(text, context="", style="natural"):
    if not isinstance(text, str) or not text.strip() or len(text) > 1500: raise ValueError("请输入 1～1500 字的台词")
    if not isinstance(context, str) or len(context) > 2000: raise ValueError("语境过长")
    if style not in ["natural", "restrained", "lively"]: raise ValueError("未知风格")
    # Deliberately excludes action IDs, target amplitudes, timing and sample identifiers.
    return {"text": text, "context": context, "style": style}
