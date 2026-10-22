---
title: Folume API
emoji: 📖
colorFrom: red
colorTo: yellow
sdk: docker
app_port: 7860
pinned: false
---

# Folume API

The conversion server of [Folume](https://github.com/ZEYDLCN/folume): it turns PDFs into structured documents, can fetch a
paper from a link, follow arXiv, and (optionally) answer questions through a model you configure. It stores nothing: the
PDF is converted in memory and the result is deleted when the app has downloaded it.

Open `/v1/health` to see that it is awake. Settings (Space → Settings → Variables and secrets):

| Name | Kind | What for |
|---|---|---|
| `FOLUME_CORS_ORIGINS` | Variable | The address of the web app, e.g. `https://folume.pages.dev` |
| `FOLUME_API_KEY` | Secret | Optional. Every request must then send it (enter it once in the app's Settings) |
| `FOLUME_LLM_BASE_URL`, `FOLUME_LLM_MODEL`, `FOLUME_LLM_API_KEY` | Variable / Secret | Optional. Any OpenAI-compatible model for AI answers |

Free Spaces sleep after 48 hours without a visit and have no persistent disk.
