FROM python:3.12-slim

WORKDIR /app

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# Install system dependencies for Playwright Chromium (screensharing)
# psycopg2-binary also needs libpq-dev at build time (included in slim via pg client libs)
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Playwright Chromium dependencies
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
    libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
    libxrandr2 libgbm1 libasound2 \
    # psycopg2 runtime dependency
    libpq5 \
    && rm -rf /var/lib/apt/lists/*

# Copy project files
COPY pyproject.toml .
COPY src/ src/
COPY alembic.ini .
COPY alembic/ alembic/

# Install Python dependencies
RUN uv sync --no-dev

# Install Playwright Chromium browser (headless only — no display server needed)
RUN uv run playwright install chromium

# Run migrations then start server (--workers 1 required for APScheduler meeting bot)
CMD ["sh", "-c", "PYTHONPATH=src uv run alembic upgrade head && PYTHONPATH=src uv run uvicorn api.main:app --host 0.0.0.0 --port 8000 --workers 1"]

