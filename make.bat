@echo off
set PYTHON=python

if "%1"=="test" goto test
if "%1"=="history" goto history
if "%1"=="index" goto index
if "%1"=="backtest" goto backtest
if "%1"=="local" goto local
if "%1"=="serve" goto serve
if "%1"=="deploy" goto deploy

echo Available targets: test, history, index, backtest, local, serve, deploy
goto end

:test
%PYTHON% -m pytest tests/ -v
if %ERRORLEVEL% neq 0 (
    %PYTHON% -m unittest discover -s tests -v
)
goto end

:history
%PYTHON% scripts\fetch_history.py
goto end

:index
%PYTHON% scripts\build_history_index.py
goto end

:backtest
%PYTHON% scripts\backtest.py
goto end

:local
%PYTHON% scripts\run_pipeline_local.py %2 %3
goto end

:serve
cd web && %PYTHON% -m http.server 8000
goto end

:deploy
cd backend && sam build && sam deploy --guided
goto end

:end
