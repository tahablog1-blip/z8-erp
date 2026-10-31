@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem يعيد التشغيل تلقائياً لو توقف البرنامج لأي سبب
:loop
python z8_agent.py
echo [%date% %time%] توقف الوكيل — إعادة التشغيل بعد 5 ثوان >> agent-restarts.log
timeout /t 5 /nobreak >nul
goto loop
