# modules/shortage_sync/firestore_relay.py — الخطة البديلة لما هذا السيرفر يقع.
#
# الفكرة: تطبيق ماسح النواقص (أندرويد) بيحاول يبعت الطلبية هنا عادي، ولو فشل
# (السيرفر واقع) بيبعتها بدل كده لمجموعة "pending_orders" في فايربيز - وفايربيز
# شبه مستحيل يقع لأنه على سيرفرات جوجل. كل مستند فيه توكن تسجيل دخول الموظف
# نفسه (المخزّن عنده أصلاً من أول تسجيل دخول) + الطلبية، فمفيش حاجة تتعمل غير
# تطبيق نفس التحقق اللي أي طلب HTTP عادي بيعديه (resolve_user_from_token) ثم
# استدعاء service.upsert_order بالظبط زي لو الطلبية جت من مسار /orders العادي.
#
# هذا الملف بيتفعّل بس لو FIREBASE_SERVICE_ACCOUNT_PATH متحدد ومفيش فيه
# firebase-admin مُنصّب (الاتنين موجودين يبقى الميزة شغالة) - غير كده بيسكت
# تمامًا من غير ما يكسر تشغيل السيرفر، عشان أي نسخة قديمة أو سيرفر تاني لسه
# ملهوش فايربيز يفضل شغال زي ما هو بالظبط.
import asyncio
import logging

from ...core.config import settings
from ...core.deps import resolve_user_from_token
from . import service

log = logging.getLogger("shortage_sync.firestore_relay")

_MAX_ATTEMPTS = 5          # مستند فشل أكتر من كده (مش مشكلة اتصال، مشكلة فيه نفسه) بيتشال
_POLL_SECONDS = 30
_db = None                 # عميل Firestore - بيتبني مرة واحدة بس (lazy)


def _get_firestore_client():
    """بيرجع عميل Firestore، أو None لو الميزة مش مفعّلة (مفيش مسار ملف) أو
    مكتبة firebase-admin مش منصّبة - في الحالتين الميزة بتتجاهل بهدوء."""
    global _db
    if _db is not None:
        return _db
    path = (settings.FIREBASE_SERVICE_ACCOUNT_PATH or "").strip()
    if not path:
        return None
    try:
        import firebase_admin
        from firebase_admin import credentials, firestore
    except ImportError:
        log.warning("firebase-admin غير منصّب - خطة فايربيز البديلة متوقفة (pip install firebase-admin)")
        return None
    try:
        if not firebase_admin._apps:
            cred = credentials.Certificate(path)
            firebase_admin.initialize_app(cred)
        _db = firestore.client()
        return _db
    except Exception as e:
        log.warning("تعذّر الاتصال بفايربيز (%s) - الميزة البديلة متوقفة مؤقتًا", e)
        return None


async def sync_pending_orders() -> int:
    """يسحب كل الطلبيات المعلّقة في فايربيز، يحطها في قاعدة البيانات الحقيقية،
    ويشيلها من فايربيز بعد النجاح. يرجّع عدد الطلبيات اللي اتزامنت بنجاح."""
    db = _get_firestore_client()
    if db is None:
        return 0

    # قراءة/حذف Firestore بالـ Admin SDK كلها sync - بنشغّلها في thread منفصل
    # عشان ما توقفش بقية السيرفر (نفس أسلوب _grab_frame في المشرف الآلي).
    docs = await asyncio.to_thread(lambda: list(db.collection("pending_orders").stream()))
    if not docs:
        return 0

    synced = 0
    for doc in docs:
        data = doc.to_dict() or {}
        token = data.get("token")
        order_id = data.get("orderId")
        items = data.get("items") or []
        attempts = int(data.get("attempts") or 0)

        if not token or not order_id:
            await asyncio.to_thread(doc.reference.delete)
            continue

        try:
            user = await resolve_user_from_token(token)
            await service.upsert_order(user.company_id, user.user_id, user.branch_id, order_id, items)
            await asyncio.to_thread(doc.reference.delete)
            synced += 1
        except Exception as e:
            attempts += 1
            if attempts >= _MAX_ATTEMPTS:
                log.warning("طلبية %s من فايربيز فشلت %d مرات (%s) - اتشالت نهائيًا", order_id, attempts, e)
                await asyncio.to_thread(doc.reference.delete)
            else:
                # مشكلة مؤقتة (قاعدة البيانات لسه بترجع تشتغل مثلاً) - نسيبها لدورة تانية
                await asyncio.to_thread(doc.reference.update, {"attempts": attempts})

    return synced


async def start_relay_loop():
    """حلقة خلفية دائمة - بتتشغّل من lifespan زي بقية المهام المجدولة في المشروع.
    بتسكت تمامًا (مفيش أي loop) لو الميزة مش مفعّلة، فمفيش أي تكلفة على سيرفر
    لسه ملوش فايربيز."""
    if not (settings.FIREBASE_SERVICE_ACCOUNT_PATH or "").strip():
        return
    await asyncio.sleep(15)  # مهلة إقلاع، زي بقية المهام الخلفية في المشروع
    while True:
        try:
            n = await sync_pending_orders()
            if n:
                log.info("اتزامن %d طلبية من فايربيز (الخطة البديلة)", n)
        except Exception as e:
            log.warning("دورة مزامنة فايربيز فشلت: %s", e)
        await asyncio.sleep(_POLL_SECONDS)
