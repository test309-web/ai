import os, time, secrets
from collections import defaultdict, deque
from typing import Literal
import httpx
from fastapi import FastAPI, Header, HTTPException, Request
from pydantic import BaseModel, Field

API_TOKEN = os.environ["ORACLE_API_TOKEN"]
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434")
ALLOWED_MODELS = {
    x.strip()
    for x in os.getenv("ALLOWED_MODELS", "gemma3:4b").split(",")
    if x.strip()
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

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/v1/chat")
async def chat(payload: ChatRequest, request: Request, x_api_key: str = Header(default="")):
    if not secrets.compare_digest(x_api_key, API_TOKEN):
        raise HTTPException(status_code=401, detail="Unauthorized")
    if payload.model not in ALLOWED_MODELS:
        raise HTTPException(status_code=403, detail="Model not allowed")

    # Simple per-process limit. For production/multiple workers, use Redis or a gateway-level limiter.
    now = time.time()
    key = "vercel-proxy"  # Do not trust arbitrary client-supplied IP headers.
    q = hits[key]
    while q and q[0] < now - 60:
        q.popleft()
    if len(q) >= RATE_LIMIT:
        raise HTTPException(status_code=429, detail="Rate limit reached. Try again in a minute.")
    q.append(now)

    async with httpx.AsyncClient(timeout=55) as client:
        try:
            r = await client.post(
                f"{OLLAMA_URL}/api/chat",
                json={
                    "model": payload.model,
                    "messages": [m.model_dump() for m in payload.messages],
                    "stream": False
                }
            )
            r.raise_for_status()
            data = r.json()
            return {"message": data.get("message", {}).get("content", "")}
        except httpx.HTTPError:
            raise HTTPException(status_code=502, detail="Ollama is unavailable")
