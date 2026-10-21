"""Serves the test fake of an OpenAI-compatible model over real HTTP so end-to-end runs can use it.

Usage: python fake_llm_server.py PORT
"""

import sys
from pathlib import Path

import uvicorn

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend" / "tests"))

from fake_llm import FakeLLM  # noqa: E402

if __name__ == "__main__":
    llm = FakeLLM()
    # lets the end-to-end script check exactly what (and how often) the model was sent something
    llm.app.get("/__requests")(lambda: [r["body"] for r in llm.requests])
    uvicorn.run(llm.app, host="127.0.0.1", port=int(sys.argv[1]), log_level="warning")
