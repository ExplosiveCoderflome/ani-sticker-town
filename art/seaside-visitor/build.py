"""Existing command for rebuilding the sea-market visitor's animations."""
import runpy
from pathlib import Path


if __name__ == "__main__":
    runpy.run_path(str(Path(__file__).resolve().parents[2] / "tools/build_actor_motion.py"), run_name="__main__")
