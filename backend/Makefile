.PHONY: install lint format typecheck test migrate run

install:
	uv sync --all-extras

lint:
	uv run ruff check src/ tests/

format:
	uv run ruff format src/ tests/

typecheck:
	uv run mypy src/

test:
	uv run pytest tests/ -v --cov=db_discovery_agent

migrate:
	uv run alembic upgrade head

migrate-create:
	uv run alembic revision --autogenerate -m "$(name)"

run:
	PYTHONPATH=src uv run uvicorn api.main:app --reload --host 0.0.0.0 --port 8000

run-prod:
	PYTHONPATH=src uv run uvicorn api.main:app --host 0.0.0.0 --port 8000

check: lint typecheck test
