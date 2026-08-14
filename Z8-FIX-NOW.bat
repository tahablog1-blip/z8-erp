@echo off
chcp 65001 >nul
cd /d "%~dp0"
if exist "backend\venv\Scripts\python.exe" (
  "backend\venv\Scripts\python.exe" Z8-FIX-NOW.py
) else (
  echo backend\venv not found - put both files next to the backend folder
)
echo.
pause
