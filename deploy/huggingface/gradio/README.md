---
title: Folume API
emoji: 📖
colorFrom: red
colorTo: yellow
sdk: gradio
sdk_version: 5.0.0
python_version: "3.12"
app_file: app.py
pinned: false
---

# Folume API

The conversion server of [Folume](https://github.com/ZEYDLCN/folume). This Space only starts the API (`app.py`); there is no
Gradio page. Open `/v1/health` to see that it is awake.

Settings (Space → Settings → Variables and secrets): `FOLUME_CORS_ORIGINS` (the web app's address, a Variable) and
`FOLUME_API_KEY` (a Secret). The server stores nothing: PDFs are converted in memory and results are deleted once downloaded.
