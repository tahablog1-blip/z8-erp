@echo off
title Z8 Installer
cd /d "%~dp0"
echo ============================================
echo    Z8 INSTALLER  -  one-time setup
echo ============================================
echo.
echo [1/3] Checking Python backend (already bundled)...
backend\venv\Scripts\python.exe --version
if errorlevel 1 (
  echo   Bundled venv not working - rebuilding...
  py -3.12 -m venv backend\venv 2>nul || python -m venv backend\venv
)
backend\venv\Scripts\python.exe -c "import fastapi,asyncpg,uvicorn,jwt,bcrypt,pydantic,cv2,anthropic" >nul 2>&1
if errorlevel 1 (
  echo   Installing backend packages...
  backend\venv\Scripts\python.exe -m pip install -r backend\requirements.txt
  if errorlevel 1 goto fail
)
echo   Backend OK.
echo.
echo [2/3] Installing frontend packages - needs internet, 2-3 minutes...
cd frontend
call npm install
if errorlevel 1 goto fail
cd ..
echo   Frontend OK.
echo.
echo [3/3] Setup complete. Starting the system now...
call "%~dp0START-Z8.bat"
exit /b
:fail
echo.
echo ============================================
echo [ERROR] Setup failed at the step above.
echo Take a screenshot of this window and send it.
echo ============================================
pause
