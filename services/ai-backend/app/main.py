import asyncio
import hmac

from fastapi import FastAPI, Header, HTTPException

from app.config import Settings
from app.contracts.discovery import DiscoveryCandidateBatch, DiscoveryRefreshRequest
from app.observability.tracing import new_trace_id
from app.runtime.agent_runtime import AgentRuntime

settings = Settings.from_env()
runtime = AgentRuntime(settings)
semaphore = asyncio.Semaphore(settings.max_concurrency)
app = FastAPI(title="LearnSpace discovery agents", version="1.0.0")


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/readyz")
async def readyz() -> dict[str, str]:
    errors = settings.readiness_errors()
    if errors:
        raise HTTPException(
            status_code=503, detail=f"discovery service missing: {', '.join(errors)}"
        )
    return {"status": "ready"}


@app.post("/internal/v1/discovery/refresh", response_model=DiscoveryCandidateBatch)
async def refresh(
    request: DiscoveryRefreshRequest, x_internal_service_token: str | None = Header(default=None)
) -> DiscoveryCandidateBatch:
    if not x_internal_service_token or not hmac.compare_digest(
        x_internal_service_token, settings.internal_service_token
    ):
        raise HTTPException(status_code=401, detail="unauthorized")
    async with semaphore:
        trace_id = request.trace_id or new_trace_id()
        return await runtime.run_discovery(request.model_copy(update={"trace_id": trace_id}))
