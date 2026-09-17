@echo off
setlocal
title Support-Schedule Launcher
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not found.
  echo Please install it from https://nodejs.org ^(LTS recommended^), then try again.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [INFO] Installing dependencies for the first time ^(may take 1-3 minutes^)...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed. Check your network and try again.
    pause
    exit /b 1
  )
)

if not exist ".env.local" (
  if exist ".env.example" (
    echo [INFO] .env.local not found - copying from .env.example.
    copy ".env.example" ".env.local" >nul
  )
)

echo.
echo ============================================================
echo   Starting... open http://localhost:3001 in your browser.
echo   Tip: photo import needs GEMINI_API_KEY in .env.local.
echo   Press Ctrl+C in this window to stop the server.
echo ============================================================
echo.

timeout /t 2 /nobreak >nul
start "" "http://localhost:3001"

npm run dev -- --port 3001

pause
