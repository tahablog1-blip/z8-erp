@echo off
cd /d "%~dp0"
rem Restarts the agent automatically if it stops for any reason
:loop
python z8_agent.py
echo [%date% %time%] agent stopped - restarting in 5s >> agent-restarts.log
timeout /t 5 /nobreak >nul
goto loop
