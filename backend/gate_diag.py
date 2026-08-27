# -*- coding: utf-8 -*-
"""
Z8 — تشخيص دورة البوابة الذكية من أول الكاميرا لآخر الدخول
============================================================
يشغّل الدورة الحقيقية خطوة بخطوة ويطبع أين تنجح وأين تقف بالضبط.
التشغيل من مجلد backend:
    venv\\Scripts\\python.exe gate_diag.py
"""
import asyncio
import sys
import io

# طباعة عربية سليمة على ويندوز
try:
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
except Exception:
    pass


def line(t=""):
    print(t, flush=True)


async def main():
    line("═" * 60)
    line("  تشخيص دورة البوابة الذكية")
    line("═" * 60)

    # ── 0) تحميل الوحدات ──
    try:
        from app.core.db import transaction
        from app.modules.auto_checkin import watcher, service, vision
        from app.core.plate_utils import normalize_plate
        line("✓ [0] تحميل الوحدات نجح")
    except Exception as e:
        line(f"✗ [0] فشل تحميل الوحدات: {e}")
        import traceback; traceback.print_exc()
        return

    # ── 1) قارئ اللوحة الحالي ──
    try:
        model = vision.get_model()
        line(f"✓ [1] قارئ اللوحة الحالي: {model}")
        if model == "plate-recognizer":
            tok = getattr(vision, "PLATE_RECOGNIZER_TOKEN", "")
            line(f"      مفتاح Plate Recognizer: {'موجود ('+str(len(tok))+' حرف)' if tok else '✗ غير موجود!'}")
    except Exception as e:
        line(f"✗ [1] فشل قراءة النموذج: {e}")

    # ── 2) الكاميرات النشطة ──
    cameras = []
    try:
        async with transaction() as conn:
            rows = await conn.fetch(
                """SELECT id, company_id, branch_id, name, rtsp_url, station, is_active
                   FROM station_cameras WHERE is_active = TRUE AND station = 1""")
        cameras = [dict(r) for r in rows]
        if not cameras:
            line("✗ [2] لا توجد كاميرات نشطة على المحطة 1! (is_active=TRUE AND station=1)")
            line("      → السبب المرجّح: الكاميرا معطّلة أو مسجّلة على محطة غير 1")
            async with transaction() as conn:
                allc = await conn.fetch(
                    "SELECT name, station, is_active FROM station_cameras")
            line(f"      كل الكاميرات المسجّلة ({len(allc)}):")
            for c in allc:
                line(f"        - {c['name']}: station={c['station']} active={c['is_active']}")
            return
        line(f"✓ [2] كاميرات نشطة على المحطة 1: {len(cameras)}")
        for c in cameras:
            url = c["rtsp_url"] or ""
            safe = url
            if "@" in url:  # إخفاء الباسورد
                safe = url.split("://")[0] + "://***@" + url.split("@", 1)[1]
            line(f"      - {c['name']}: {safe}")
    except Exception as e:
        line(f"✗ [2] فشل قراءة الكاميرات: {e}")
        import traceback; traceback.print_exc()
        return

    # ── 3) التقاط لقطة فعلية من كل كاميرا ──
    for cam in cameras:
        line("")
        line(f"── الكاميرا: {cam['name']} ──")
        try:
            jpeg, gray = await asyncio.wait_for(
                asyncio.to_thread(watcher._grab_jpeg, cam["rtsp_url"]), timeout=15)
        except Exception as e:
            line(f"✗ [3] الالتقاط رمى استثناء: {e}")
            continue
        if jpeg is None:
            line(f"✗ [3] الالتقاط فشل — السبب: {watcher._grab_reason or 'غير معروف'}")
            line("      → الدورة تقف هنا: الكاميرا لا تُرجع صورة. راجع الرابط/الشبكة/الباسورد.")
            continue
        line(f"✓ [3] الالتقاط نجح — حجم الصورة {len(jpeg)//1024} كيلو")

        # ── 4) قراءة اللوحة على اللقطة الحقيقية ──
        try:
            v = await vision.read_plate(jpeg, f"diag-{cam['name']}.jpg")
        except Exception as e:
            line(f"✗ [4] قراءة اللوحة رمت استثناء: {e}")
            continue
        found = v.get("plate_found")
        conf = v.get("confidence")
        line(f"  [4] نتيجة القراءة: plate_ar='{v.get('plate_ar','')}' "
             f"digits='{v.get('digits','')}' ثقة={conf} موجودة={found} "
             f"[{v.get('_model','')}]")
        if not found:
            line("      → طبيعي لو مافيش سيارة بلوحة واضحة أمام الكاميرا الآن.")
            line("        جرّب تشغيل السكربت وسيارة واقفة أمام الكاميرا بلوحة ظاهرة.")
            continue

        # ── 5) التطبيع والمطابقة ──
        raw = v.get("plate_ar") or v.get("plate_en") or ""
        key = normalize_plate(raw)
        line(f"  [5] بعد التطبيع: canonical='{key.canonical}' digits='{key.digits}' "
             f"صالحة={key.is_valid}")
        if not key.is_valid:
            line("      ✗ اللوحة لم تُقبل بعد التطبيع — الدورة تقف: تُعتبر 'no_plate'.")
            continue
        try:
            async with transaction() as conn:
                row, mode, cands = await service.match_plate(conn, key)
        except Exception as e:
            line(f"      ✗ المطابقة رمت استثناء: {e}")
            continue
        if row is None and not cands:
            line(f"  [5] المطابقة: غير مسجّلة (mode={mode}) — تظهر 'unknown'، لا تدخل الخدمة.")
            line("      → لو السيارة يُفترض أنها مسجّلة: الأرقام/الحروف في القاعدة مختلفة.")
        elif row is None and cands:
            line(f"  [5] المطابقة: {len(cands)} مرشّح بنفس الأرقام — يُختار الأقرب تلقائياً.")
        else:
            line(f"  ✓ [5] المطابقة نجحت (mode={mode}) — السيارة موجودة في القاعدة.")

    line("")
    line("═" * 60)
    line("  انتهى التشخيص")
    line("═" * 60)


if __name__ == "__main__":
    asyncio.run(main())
