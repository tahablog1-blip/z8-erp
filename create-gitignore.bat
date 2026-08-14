@echo off
cd /d "%~dp0"
(
echo # الأسرار - لا تُرفع أبداً
echo .env
echo *.env
echo !.env.example
echo serviceAccountKey.json
echo *secret*
echo *Secret*
echo(
echo # سكريبتات فيها باسورد الداتابيز
echo backup-z8.bat
echo restore-z8.bat
echo restore-z8 ^(1^).bat
echo setup-auto-backup.bat
echo check-z8.bat
echo(
echo # Python / FastAPI
echo __pycache__/
echo *.pyc
echo *.pyo
echo venv/
echo .venv/
echo env/
echo *.egg-info/
echo .pytest_cache/
echo .mypy_cache/
echo(
echo # Node / Next.js
echo node_modules/
echo .next/
echo out/
echo npm-debug.log*
echo yarn-error.log*
echo yarn-debug.log*
echo(
echo # نسخ الداتابيز والباك أب
echo backups/
echo *.backup
echo *.sql.gz
echo *.dump
echo(
echo # Android
echo *.apk
echo *.aab
echo .gradle/
echo local.properties
echo **/build/
echo(
echo # IDE / نظام التشغيل
echo .vscode/
echo .idea/
echo .DS_Store
echo Thumbs.db
echo desktop.ini
echo(
echo # لوجات وتشخيص وأرشيفات
echo *.log
echo Z8-*-REPORT.txt
echo Z8-DIAGNOSIS.txt
echo z8-hr.zip
) > .gitignore
echo.
echo [OK] تم إنشاء .gitignore بنجاح في هذا المجلد.
echo.
type .gitignore
echo.
pause
