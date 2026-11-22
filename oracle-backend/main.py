import os
import time
import secrets
from collections import defaultdict, deque
from typing import Literal

import httpx
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

API_TOKEN = os.environ["ORACLE_API_TOKEN"]
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/")
ALLOWED_MODELS = {
    item.strip()
    for item in os.getenv("ALLOWED_MODELS", "gemma3:4b").split(",")
    if item.strip()
}
RATE_LIMIT = int(os.getenv("RATE_LIMIT_PER_MINUTE", "12"))

app = FastAPI(title="SoftAtlas private AI gateway")
hits = defaultdict(deque)


class Message(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=6000)


class ChatRequest(BaseModel):
    model: str
    messages: list[Message] = Field(min_length=1, max_length=30)
    stream: bool = True


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/v1/chat")
async def chat(
    payload: ChatRequest,
    request: Request,
    x_api_key: str = Header(default=""),
):
    if not secrets.compare_digest(x_api_key, API_TOKEN):
        raise HTTPException(status_code=401, detail="Unauthorized")

    if payload.model not in ALLOWED_MODELS:
        raise HTTPException(status_code=403, detail="Model not allowed")

    # Simple per-process limit. For production/multiple workers, use Redis
    # or a gateway-level limiter. Do not trust arbitrary client IP headers.
    now = time.time()
    key = "vercel-proxy"
    queue = hits[key]

    while queue and queue[0] < now - 60:
        queue.popleft()

    if len(queue) >= RATE_LIMIT:
        raise HTTPException(
            status_code=429,
            detail="Rate limit reached. Try again in a minute.",
        )

    queue.append(now)

    # No short read timeout: Ollama may need a long time to generate.
    # Streaming means chunks are forwarded as soon as Ollama produces them.
    timeout = httpx.Timeout(
        connect=15.0,
        read=None,
        write=60.0,
        pool=15.0,
    )

    client = httpx.AsyncClient(timeout=timeout)

    try:
        ollama_request = client.build_request(
            "POST",
            f"{OLLAMA_URL}/api/chat",
            json={
                "model": payload.model,
                "messages": [message.model_dump() for message in payload.messages],
                "stream": True,
                "keep_alive": "30m",
            },
            headers={"Accept": "application/x-ndjson"},
        )

        ollama_response = await client.send(ollama_request, stream=True)

        if ollama_response.status_code >= 400:
            error_body = await ollama_response.aread()
            status_code = ollama_response.status_code
            await ollama_response.aclose()
            await client.aclose()

            detail = error_body.decode("utf-8", errors="replace")[:1000]
            raise HTTPException(
                status_code=502,
                detail=f"Ollama returned HTTP {status_code}: {detail}",
            )

    except HTTPException:
        raise
    except httpx.HTTPError as exc:
        await client.aclose()
        raise HTTPException(
            status_code=502,
            detail=f"Ollama connection failed: {str(exc)}",
        ) from exc

    async def stream_ollama():
        try:
            async for chunk in ollama_response.aiter_raw():
                if await request.is_disconnected():
                    break
                if chunk:
                    yield chunk
        finally:
            await ollama_response.aclose()
            await client.aclose()

    return StreamingResponse(
        stream_ollama(),
        media_type="application/x-ndjson",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
        },
    )
