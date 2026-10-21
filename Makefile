# Developer shortcuts. Run `make help` for the list.
PY := backend/.venv/bin/python
.DEFAULT_GOAL := help

.PHONY: help setup-backend setup-mobile test-backend test-mobile lint check schema dev-api e2e corpus

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

corpus: ## Generate the synthetic PDFs the end-to-end scripts read
	cd backend && .venv/bin/python -m synth.corpus tests/.generated

e2e: corpus ## Build the web app and run the browser end-to-end scenarios (needs Chromium)
	cd backend && for n in ieee_ml acm_graph; do .venv/bin/python -m folume.tools.export_bundle tests/.generated/$$n.pdf ../e2e/out/$$n || exit 1; done
	cd mobile && npm run build:reader && EXPO_PUBLIC_API_URL=http://localhost:8765 CI=1 npx expo export --platform web
	cd e2e && for f in reader-runtime formats app-flow learn-flow knowledge-flow link-flow; do node $$f.mjs || exit 1; done
