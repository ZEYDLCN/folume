"""Serves a few papers in arXiv's Atom format so end-to-end runs can follow a topic without the internet.

Usage: python fake_arxiv_server.py PORT

`/api/query?search_query=...` answers with the same three papers whatever is asked, and `/__requests` lists the
queries received so a script can check what the server asked for.
"""

import sys

import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response

ENTRY = """<entry>
  <id>http://arxiv.org/abs/{id}v1</id>
  <updated>{date}</updated>
  <published>{date}</published>
  <title>{title}</title>
  <summary>{summary}</summary>
  <author><name>{author}</name></author>
  <link href="http://arxiv.org/abs/{id}v1" rel="alternate" type="text/html"/>
  <arxiv:primary_category term="cs.LG" scheme="http://arxiv.org/schemas/atom"/>
  <category term="cs.LG" scheme="http://arxiv.org/schemas/atom"/>
</entry>"""

PAPERS = [
    ("2401.01234", "2024-01-03T09:30:00Z", "Sparse Routing for Efficient Transformers", "We study routing. It is sparse and fast.", "Quinn Rossi"),
    ("1810.04805", "2024-01-02T09:30:00Z", "BERT: Pre-training of Deep Bidirectional Transformers", "We introduce a new language representation model.", "Jacob Devlin"),
    ("hep-th/9901001", "2024-01-01T09:30:00Z", "An old-style identifier", "Short abstract.", "Ada Lovelace"),
]

app = FastAPI()
received: list[str] = []


@app.get("/api/query")
def query(request: Request) -> Response:
    received.append(request.query_params.get("search_query", ""))
    entries = "\n".join(ENTRY.format(id=i, date=d, title=t, summary=s, author=a) for i, d, t, s, a in PAPERS)
    body = f"""<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
<title>ArXiv Query</title>
{entries}
</feed>"""
    return Response(body, media_type="application/atom+xml")


@app.get("/__requests")
def requests() -> JSONResponse:
    return JSONResponse(received)


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=int(sys.argv[1]), log_level="warning")
