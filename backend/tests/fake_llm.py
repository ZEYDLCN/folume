"""A fake OpenAI-compatible chat-completions server for tests (served in-process over ASGI)."""

from __future__ import annotations

import json
import re

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from folume.ai.providers import OpenAICompatibleProvider


class FakeLLM:
    def __init__(self) -> None:
        self.behavior = "ok"
        self.requests: list[dict] = []
        self.app = FastAPI()
        self.app.post("/chat/completions")(self.completions)

    def client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app), base_url="http://llm")

    def provider(self, vision: bool = False) -> OpenAICompatibleProvider:
        return OpenAICompatibleProvider(base_url="http://llm", model="fake-model", api_key="k", vision=vision,
                                        client=self.client())

    async def completions(self, request: Request):
        body = await request.json()
        self.requests.append({"body": body, "auth": request.headers.get("authorization")})
        # the first user message carries the passages (later ones may be retry nudges)
        user = next(m for m in body["messages"] if m["role"] == "user")["content"]
        text = user if isinstance(user, str) else next(p["text"] for p in user if p["type"] == "text")
        n = len(self.requests)
        if self.behavior == "error500":
            return JSONResponse({"error": "boom"}, status_code=500)
        if self.behavior == "reject_json_mode" and "response_format" in body:
            return JSONResponse({"error": "unsupported"}, status_code=400)
        if self.behavior == "always_bad":
            return self._reply("this is not json at all")
        if self.behavior == "bad_once" and n == 1:
            return self._reply("sorry, here you go: not json")
        if "write" in text.lower() and "questions" in text.lower() or '"questions"' in body["messages"][0]["content"]:
            return self._reply(json.dumps(self._quiz(text)))
        if "<paper_a" in text:
            ids = re.findall(r'<passage id="(p\d+)"', text)
            return self._reply(json.dumps({"relation": "contradictory" if self.behavior == "contradiction" else "common",
                                           "segments": [{"text": "Both define it.", "cites": ids[:2], "quote": None},
                                                        {"text": "Background.", "cites": [], "quote": None}]}))
        ids = re.findall(r'<passage id="(p\d+)"', text)
        sel = re.search(r'<passage id="(p\d+)"[^>]*selected="true">(.*?)</passage>', text, re.S)
        sel_id, sel_text = (sel.group(1), sel.group(2)) if sel else (ids[0], "")
        quote = sel_text.strip()[:30]
        if self.behavior == "unknown_cites":
            segs = [{"text": "Made up claim.", "cites": ["p99"], "quote": None}]
        elif self.behavior == "empty":
            segs = []
        elif self.behavior == "bad_quote":
            segs = [{"text": "Claim.", "cites": [sel_id], "quote": "words that never appear in the passage"}]
        else:
            segs = [
                {"text": f"Explained: {quote}", "cites": [sel_id], "quote": quote},
                {"text": "Textbook background.", "cites": [], "quote": None},
                {"text": "Invented source.", "cites": ["p99"], "quote": None},
            ]
        return self._reply(json.dumps({"segments": segs, "needs_more_context": False}))

    def _quiz(self, text: str) -> dict:
        ids = re.findall(r'<passage id="(p\d+)"', text)
        good = {"type": "mcq", "prompt": "Why does the method reduce memory?", "choices": ["A", "B", "C", "D"],
                "answer": "b", "explanation": "See the passage.", "cites": ids[:1], "concept": "memory"}
        if self.behavior == "quiz_invalid":
            return {"questions": [
                {**good, "answer": "Z"},                      # answer not among the choices
                {**good, "cites": ["p99"]},                   # cites nothing real
                {"type": "essay", "prompt": "x", "answer": "y", "cites": ids[:1]},  # unsupported type
            ]}
        return {"questions": [good, {"type": "truefalse", "prompt": "The method needs labels.", "choices": [],
                                      "answer": "false", "explanation": "No.", "cites": ids[:1]},
                              {"type": "short", "prompt": "Explain the trade-off.", "answer": "Speed vs accuracy.",
                               "explanation": "Discussed.", "cites": ids[:1]}]}

    @staticmethod
    def _reply(content: str) -> JSONResponse:
        return JSONResponse({"choices": [{"message": {"role": "assistant", "content": content}}]})
