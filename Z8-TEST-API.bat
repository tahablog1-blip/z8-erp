@echo off
chcp 65001 >nul
cd /d "%~dp0"
python Z8-TEST-API.py
echo.
pause
