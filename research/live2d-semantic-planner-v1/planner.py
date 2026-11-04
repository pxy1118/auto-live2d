"""Compatibility CLI for the prototype promoted to semantic/planner.py."""
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from semantic.planner import *

if __name__ == "__main__":
    main()
