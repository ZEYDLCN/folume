"""Stand-in conversion processes for the job-timeout tests (the real child needs the OCR engine and takes seconds)."""

from __future__ import annotations

import time


def reads_pages_slowly(conn, data, filename, options, directory, max_memory_mb) -> None:
    for page in range(1, 6):
        time.sleep(0.4)
        conn.send(("progress", "ocr", 0.45 + 0.08 * page))
    conn.send(("done",))
    conn.close()


def hangs_on_a_page(conn, data, filename, options, directory, max_memory_mb) -> None:
    conn.send(("progress", "ocr", 0.5))
    time.sleep(60)
