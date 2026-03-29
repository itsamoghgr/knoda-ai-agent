FROM python:3.12-slim

WORKDIR /app

# System dependencies for DuckDB, psycopg2, and other native packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install uv (fast Python package manager)
RUN pip install uv

# Copy dependency files first for better layer caching
COPY LICENSE ./LICENSE
COPY README.md ./README.md
COPY backend/pyproject.toml backend/uv.lock* ./backend/

# Install Python dependencies
WORKDIR /app/backend
RUN uv pip install --system -e .

# Copy application source
COPY backend/src ./src
COPY backend/alembic ./alembic
COPY backend/alembic.ini ./alembic.ini

WORKDIR /app/backend/src

ENV PYTHONPATH=/app/backend/src
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

EXPOSE 8000

# Run Alembic migrations then start the API server
CMD ["sh", "-c", "cd /app/backend && uv run alembic upgrade head && cd /app/backend/src && uv run uvicorn api.main:create_app --factory --host 0.0.0.0 --port 8000 --workers 1"]
