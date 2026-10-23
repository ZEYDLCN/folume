"""LLM providers. The gateway is provider-agnostic: any OpenAI-compatible chat-completions endpoint works
(hosted or local). Without a configured model the gateway answers from the supplied passages only."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Protocol

import httpx

from ..config import Settings
from .schemas import ImageRef

log = logging.getLogger(__name__)


class ProviderError(Exception):
    """The provider failed or returned something unusable. Never carries request content."""


class LLMProvider(Protocol):
    name: str
    model: str | None
    vision: bool

    async def complete(self, messages: list[dict], images: list[ImageRef] | None = None, *,
                       max_tokens: int = 1200, temperature: float = 0.2) -> str: ...


@dataclass
class OpenAICompatibleProvider:
    base_url: str
    model: str
    api_key: str | None = None
    vision: bool = False
    timeout: float = 60.0
    client: httpx.AsyncClient | None = None  # injectable for tests
    name: str = "openai-compatible"
    # models that think before they answer spend part of the token limit on it: this raises the limit (never lowers it)
    max_tokens_floor: int = 0
    # "low" makes such models think less; only sent when the operator sets it
    reasoning_effort: str | None = None
    # free tiers shed load: when a model is overloaded, gone or too slow the next one answers instead
    fallback_models: tuple[str, ...] = ()

    def _payload(self, model: str, messages: list[dict], images: list[ImageRef] | None, max_tokens: int,
                 temperature: float, extras: bool) -> dict:
        msgs = [dict(m) for m in messages]
        if images and self.vision:
            last = msgs[-1]
            parts: list[dict] = [{"type": "text", "text": last["content"]}]
            for im in images:
                parts.append({"type": "text", "text": f"Image attached for passage {im.passage_id} ({im.role}):"})
                parts.append({"type": "image_url", "image_url": {"url": f"data:{im.mime};base64,{im.data_b64}"}})
            msgs[-1] = {"role": last["role"], "content": parts}
        payload: dict = {"model": model, "messages": msgs, "max_tokens": max(max_tokens, self.max_tokens_floor),
                         "temperature": temperature}
        if extras:
            payload["response_format"] = {"type": "json_object"}
            if self.reasoning_effort:
                payload["reasoning_effort"] = self.reasoning_effort
        return payload

    async def complete(self, messages: list[dict], images: list[ImageRef] | None = None, *,
                       max_tokens: int = 1200, temperature: float = 0.2) -> str:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        url = f"{self.base_url.rstrip('/')}/chat/completions"
        client = self.client or httpx.AsyncClient(timeout=self.timeout)
        try:
            failure = ProviderError("no model configured")
            for model in (self.model, *self.fallback_models):
                try:
                    return await self._ask(client, url, headers, model, messages, images, max_tokens, temperature)
                except ProviderError as exc:
                    failure = exc
                    log.warning("model %s failed (%s)", model, exc)
            raise failure
        finally:
            if self.client is None:
                await client.aclose()

    async def _ask(self, client: httpx.AsyncClient, url: str, headers: dict, model: str, messages: list[dict],
                   images: list[ImageRef] | None, max_tokens: int, temperature: float) -> str:
        for extras in (True, False):
            try:
                res = await client.post(url, headers=headers, timeout=self.timeout,
                                        json=self._payload(model, messages, images, max_tokens, temperature, extras))
            except httpx.HTTPError as exc:
                raise ProviderError(f"transport: {type(exc).__name__}") from None
            if res.status_code == 400 and extras:
                continue  # some servers reject response_format or reasoning_effort; retry once without them
            if res.status_code >= 400:
                raise ProviderError(f"upstream status {res.status_code}")
            try:
                return res.json()["choices"][0]["message"]["content"]
            except (KeyError, IndexError, ValueError):
                raise ProviderError("malformed upstream response") from None
        raise ProviderError("upstream rejected the request")


def build_provider(settings: Settings, client: httpx.AsyncClient | None = None) -> LLMProvider | None:
    if settings.llm_base_url and settings.llm_model:
        return OpenAICompatibleProvider(
            base_url=settings.llm_base_url, model=settings.llm_model, api_key=settings.llm_api_key,
            vision=settings.llm_vision, timeout=settings.llm_timeout_seconds, client=client,
            max_tokens_floor=settings.llm_max_tokens, reasoning_effort=settings.llm_reasoning_effort,
            fallback_models=tuple(dict.fromkeys(m for m in settings.llm_fallback_models if m != settings.llm_model)))
    return None
