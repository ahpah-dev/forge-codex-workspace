@echo off
setlocal
cd /d "%~dp0"
if not exist "node_modules\@openai\codex\bin\codex.js" (
  echo Installing Forge's Codex client...
  npm install --omit=dev --no-save --no-package-lock @openai/codex@0.159.0 --no-audit --no-fund
  if errorlevel 1 (
    echo Could not install Forge's Codex client. Check your internet connection and try again.
    pause
    exit /b 1
  )
)
node server.mjs
if errorlevel 1 pause
