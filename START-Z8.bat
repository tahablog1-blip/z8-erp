@echo off
title Z8 Launcher
cd /d "%~dp0"
echo ============================================
echo    Z8 Platform - Masdar Al-Zuyout
echo ============================================
if not exist frontend\node_modules\next (
  echo Frontend packages missing - running repair installer...
  call "%~dp0INSTALL-Z8.bat"
  exit /b
)
if not exist backend\venv\Scripts\python.exe (
  echo Backend venv missing - running repair installer...
  call "%~dp0INSTALL-Z8.bat"
  exit /b
)
echo Stopping ALL old python workers (no zombies allowed)...
taskkill /f /im python.exe >nul 2>&1
echo Stopping any old Z8 instances (ports 4001 / 3000)...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":4001" ^| findstr "LISTENING"') do taskkill /f /pid %%p >nul 2>&1
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do taskkill /f /pid %%p >nul 2>&1
timeout /t 2 /nobreak >nul
echo Starting Backend + Frontend (two black windows will open - keep them open)...
start "Z8-Backend"  cmd /k "cd /d %~dp0backend && venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 4001"
start "Z8-Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"
echo.
echo Waiting for the system to become ready (30-90 seconds first time)...
set /a n=0
:wait
timeout /t 3 /nobreak >nul
curl.exe -s -m 2 http://localhost:3000/api/health >nul 2>&1 && goto ready
set /a n+=1
if %n% lss 30 goto wait
echo.
echo [WARN] Not ready after 90s. Look at the two black windows,
echo screenshot any red error and send it.
pause
exit /b
:ready
echo.
echo READY. Opening the browser...
start http://localhost:3000/login
timeout /t 3 >nul
