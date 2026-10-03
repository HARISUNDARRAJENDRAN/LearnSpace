# syntax=docker/dockerfile:1
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_HTTP_TIMEOUT=180 \
    UV_CONCURRENT_DOWNLOADS=4 \
    PATH=/service/.venv/bin:$PATH

WORKDIR /service

COPY pyproject.toml uv.lock ./

RUN --mount=type=cache,target=/root/.cache/uv,sharing=locked \
    --mount=type=cache,target=/root/.cache/pip,sharing=locked \
    pip install --timeout 120 uv==0.11.28 \
    && uv sync --frozen --no-dev \
    && groupadd --system --gid 10001 learnspace \
    && useradd --system --uid 10001 --gid learnspace --home-dir /service --shell /usr/sbin/nologin learnspace \
    && chown learnspace:learnspace /service

COPY --chown=learnspace:learnspace app ./app

USER learnspace

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=5s --retries=12 --start-period=15s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/readyz')"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
