# syntax=docker/dockerfile:1.7

FROM python:3.12-slim-bookworm AS dependencies

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN groupadd --gid 10001 toolbox \
    && useradd --uid 10001 --gid toolbox --create-home --shell /usr/sbin/nologin toolbox

WORKDIR /app

COPY backend/requirements.txt backend/requirements-dev.txt backend/constraints-py312.txt /tmp/requirements/
RUN --mount=type=cache,target=/root/.cache/pip \
    python -m pip install --upgrade pip \
    && python -m pip install -c /tmp/requirements/constraints-py312.txt -r /tmp/requirements/requirements.txt \
    && python -m pip check

FROM dependencies AS source

COPY --chown=toolbox:toolbox package.json /app/package.json
COPY --chown=toolbox:toolbox backend /app/backend

RUN mkdir -p \
      /var/lib/amazon-toolbox/AmazonToolbox/logs \
      /var/lib/amazon-toolbox/expense-attachments \
      /app/backend/updates \
      /app/backend/.updates-staging \
      /app/backend/chroma_db \
    && chown -R toolbox:toolbox /var/lib/amazon-toolbox /app/backend

WORKDIR /app/backend

FROM source AS test

USER root
RUN --mount=type=cache,target=/root/.cache/pip \
    python -m pip install -r /tmp/requirements/requirements-dev.txt \
    && python -m pip check
USER toolbox

FROM source AS runtime

USER root
RUN rm -rf /app/backend/tests /app/backend/.pytest_cache
USER toolbox

ENV APP_ENV=internal \
    DEBUG=false \
    TOOL_EXECUTION_MODE=demo \
    AI_SUPPORT_MODE=rules \
    BUNDLED_BACKEND_ENABLED=false \
    HOST=0.0.0.0 \
    PORT=8000 \
    LOG_LEVEL=INFO \
    LOG_FORMAT=json \
    TOOLBOX_RUNTIME_DIR=/var/lib/amazon-toolbox \
    EXPENSE_ATTACHMENT_DIR=/var/lib/amazon-toolbox/expense-attachments \
    UPDATE_RELEASE_DIR=/app/backend/updates \
    CHROMA_PERSIST_DIR=/app/backend/chroma_db

EXPOSE 8000
STOPSIGNAL SIGTERM

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=4 \
  CMD ["python", "-m", "core.healthcheck"]

CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--no-access-log"]
