@echo off
chcp 65001 >nul
title Z8 Clean Rebuild
cd /d "%~dp0frontend"

echo ============================================
echo   تنظيف شامل وإعادة بناء الواجهة الأمامية
echo ============================================
echo.
echo [1/3] مسح كاش البناء القديم (.next)...
if exist .next (
    rmdir /s /q .next
    echo    تم المسح
) else (
    echo    مش موجود أصلاً — تمام
)

echo.
echo [2/3] مسح كاش node_modules المؤقت...
if exist node_modules\.cache (
    rmdir /s /q node_modules\.cache
    echo    تم المسح
)

echo.
echo [3/3] التأكد من وجود صفحة تسجيل الدخول...
if exist "src\app\login\page.tsx" (
    echo    ✅ الملف موجود — المشكلة كانت الكاش فعلاً
) else (
    echo    ❌ الملف غير موجود! — لازم نعيد رفع ملفات الواجهة
)

echo.
echo ============================================
echo   تم التنظيف. الآن شغّل START-Z8.bat عادي
echo   وانتظر حتى تظهر: "Ready in ..." كاملة
echo ============================================
echo.
pause
