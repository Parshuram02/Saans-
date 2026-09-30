.PHONY: test history index backtest local serve deploy help

PYTHON ?= python

help:
	@echo "Saans - Module 1: Stubble Fire Early Warning"
	@echo "Targets:"
	@echo "  test      Run unit tests"
	@echo "  history   Download past-season FIRMS data"
	@echo "  index     Aggregate historical fires into cell index"
	@echo "  backtest  Run back-test evaluation and generate chart"
	@echo "  local     Run local end-to-end pipeline (generates web/data/latest.json)"
	@echo "  serve     Start local HTTP server for web frontend"
	@echo "  deploy    Build and deploy AWS SAM stack"

test:
	$(PYTHON) -m pytest tests/ -v || $(PYTHON) -m unittest discover -s tests -v

history:
	$(PYTHON) scripts/fetch_history.py

index:
	$(PYTHON) scripts/build_history_index.py

backtest:
	$(PYTHON) scripts/backtest.py

local:
	$(PYTHON) scripts/run_pipeline_local.py

serve:
	cd web && $(PYTHON) -m http.server 8000

deploy:
	cd backend && sam build && sam deploy --guided
