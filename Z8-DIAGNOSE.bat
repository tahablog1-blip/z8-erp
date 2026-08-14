@echo off
chcp 65001 >nul
title Z8 Diagnosis
cd /d "%~dp0backend"
echo.
if exist venv\Scripts\python.exe (
    set "PY=venv\Scripts\python.exe"
) else (
    set "PY=python"
)
%PY% -X utf8 diagnose.py
echo.
echo ---- المنفذ 4001 ----
netstat -ano | findstr :4001
echo.
echo صوّر الشاشة دي كاملة وابعتها لو فيه خطأ أحمر فوق
echo.
pause
