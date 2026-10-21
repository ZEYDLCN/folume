# Developer shortcuts. Run `make help` for the list.
PY := backend/.venv/bin/python
.DEFAULT_GOAL := help

.PHONY: help setup-backend setup-mobile test-backend test-mobile lint check schema dev-api

help: ## List targets
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  %-16s %s\n",$$1,$$2}'

setup-backend: ## Create backend venv and install dependencies
	python3 -m venv backend/.venv
	backend/.venv/bin/pip install -q -e "backend[dev]"

setup-mobile: ## Install mobile dependencies
	cd mobile && npm install

schema: ## Regenerate the document JSON Schema
	cd backend && .venv/bin/python -m folume.tools.export_schema

test-backend: ## Run backend tests
	cd backend && .venv/bin/python -m pytest

test-mobile: ## Run mobile unit tests
	cd mobile && npm test --silent

lint: ## Lint backend (ruff) and typecheck mobile
	cd backend && .venv/bin/ruff check src tests synth evals
	cd mobile && npm run --silent typecheck

check: lint test-backend test-mobile ## Everything CI would run

dev-api: ## Start the API on :8000 with auto reload
	cd backend && .venv/bin/python -m uvicorn folume.main:app --reload --port 8000
