"""Starts the Folume API on a Gradio-type Space (which runs `python app.py` and sends traffic to port 7860).

There is no Gradio interface: the Space is only a free place for the API to run. The server stores nothing.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "src"))

os.environ.setdefault("FOLUME_DATA_DIR", "/tmp/folume-jobs")
os.environ.setdefault("FOLUME_SYNC_DB", "/tmp/folume-sync.sqlite3")

if __name__ == "__main__":  # conversions run in child processes that import this file: only the parent starts the server
    import uvicorn

    from folume.main import create_app

    uvicorn.run(create_app(), host="0.0.0.0", port=int(os.environ.get("PORT", "7860")))
