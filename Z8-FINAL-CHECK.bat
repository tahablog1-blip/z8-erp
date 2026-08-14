@echo off
chcp 65001 >nul
cd /d "%~dp0"
"backend\venv\Scripts\python.exe" Z8-FINAL-CHECK.py || python Z8-FINAL-CHECK.py
echo.
pause
