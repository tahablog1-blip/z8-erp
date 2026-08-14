@echo off
title Z8 Type Generator
cd /d "%~dp0"
echo Checking backend on 127.0.0.1:4001 ...
curl.exe -s -m 4 http://127.0.0.1:4001/api/health >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Backend is not running. Start the system first (START-Z8.bat).
  pause & exit /b 1
)
cd frontend
echo Generating TypeScript types from backend OpenAPI ...
call npm run gen-types
if errorlevel 1 (echo [ERROR] Generation failed. & pause & exit /b 1)
echo.
echo DONE: frontend\src\types\api-generated.d.ts updated.
pause
