# -*- coding: utf-8 -*-
"""تشخيص إقلاع Z8 — يطبع الخطأ الحقيقي بالحرف"""
import sys, os, traceback

print("=" * 60)
print("Z8 BOOT DIAGNOSIS")
print("=" * 60)
print(f"Python: {sys.version}")
print(f"Folder: {os.getcwd()}")
print(f".env موجود: {os.path.exists('.env')}")
print("-" * 60)
sys.path.insert(0, ".")
try:
    from app.main import app
    print("")
    print("✅✅✅ IMPORT OK — كود الباك اند سليم بالكامل ✅✅✅")
    print("لو الخادم لسه مش شغال، المشكلة في: المنفذ 4001 مشغول،")
    print("أو PostgreSQL واقفة، أو مكتبة ناقصة وقت التشغيل الفعلي.")
except Exception:
    print("")
    print("❌❌❌ لقينا الخطأ — صوّر الشاشة دي وابعتها ❌❌❌")
    print("")
    traceback.print_exc()
print("=" * 60)
