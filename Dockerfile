# syntax=docker/dockerfile:1

FROM node:22-alpine AS frontend-builder
WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

FROM python:3.11-slim AS runtime
WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    OPENTERMINALUI_CACHE_DB=/data/cache.db \
    HOME=/home/app

# Runtime dependencies only; test tooling lives in requirements-dev.txt.
COPY backend/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

RUN groupadd --system --gid 10001 app \
    && useradd --system --uid 10001 --gid app --create-home --home-dir /home/app app \
    && mkdir -p /data \
    && chown app:app /data

COPY --chown=app:app backend/ ./backend/
# Static reference data only: .dockerignore keeps local DBs, bars and caches out.
COPY --chown=app:app data/ ./data/
COPY --chown=app:app plugins/ ./plugins/
COPY --chown=app:app scripts/ ./scripts/
COPY --chown=app:app --from=frontend-builder /app/frontend/dist ./frontend/dist
RUN sed -i 's/\r$//' backend/entrypoint.sh && chmod +x backend/entrypoint.sh \
    && chown app:app /app

USER 10001:10001

EXPOSE 8000

# Readiness (DB, Redis, hub), not just liveness.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/ready', timeout=4).read()" || exit 1

CMD ["./backend/entrypoint.sh"]
