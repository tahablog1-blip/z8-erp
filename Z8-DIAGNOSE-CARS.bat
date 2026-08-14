@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ═══ تشخيص Z8 — بيستخدم بايثون الباك اند نفسه ═══
if exist "backend\venv\Scripts\python.exe" (
    "backend\venv\Scripts\python.exe" Z8-DIAGNOSE-CARS.py
) else (
    echo لم أجد backend\venv — تأكد أن الملفين في مجلد المشروع الرئيسي بجوار مجلد backend
    python Z8-DIAGNOSE-CARS.py
)
echo.
pause
