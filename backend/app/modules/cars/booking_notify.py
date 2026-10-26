# modules/cars/booking_notify.py — رسائل واتساب لعميل الحجز الأونلاين:
#   1) تأكيد الحجز فور إنشائه
#   2) تذكير لما دوره يقرّب (قدامه سيارة واحدة أو أقل) — مرة واحدة لكل حجز
# فشل الواتساب ما بيعطّلش الحجز أبداً (كل شيء fire-and-forget).
import asyncio
import os

from ...core import wa
from ...core.config import settings
from ...core.db import execute, fetch, fetchrow

REMIND_WHEN_AHEAD_AT_MOST = 1
LOOP_SECONDS = 60
ONLINE_REGISTRAR = "حجز أونلاين QR"


def _link(branch_id: str) -> str:
    base = (settings.PUBLIC_BASE_URL or os.environ.get("PUBLIC_BASE_URL", "")).rstrip("/")
    return f"{base}/booking/{branch_id}" if base else ""


def confirmation_text(brand: str | None, name: str | None, plate: str, link: str) -> str:
    car = " ".join(x for x in [brand, name] if x and str(x).strip())
    lines = [
        f"✅ تم تأكيد حجز سيارتك{(' ' + car) if car else ''} برقم لوحة {plate}",
        "شكراً لثقتك بشركة مصدر الزيوت 🙏",
        "برجاء الانتظار حتى يأتي دورك للدخول، وسنذكّرك قبل موعد دخولك.",
    ]
    if link:
        lines.append(f"تابع دورك: {link}")
    return "\n".join(lines)


def reminder_text(plate: str, branch: str | None) -> str:
    where = f" في {branch}" if branch else ""
    return (f"🔔 اقترب دور سيارتك (لوحة {plate}){where}.\n"
            "برجاء التوجّه الآن لبوابة الدخول. شكراً لثقتك بشركة مصدر الزيوت 🙏")


async def notify_booking_confirmed(car_id: str) -> None:
    try:
        row = await fetchrow(
            """SELECT company_id, branch_id, brand, name, plate, customer_phone
               FROM cars WHERE id=$1::uuid AND is_deleted=FALSE""", car_id)
        if not row or not row["customer_phone"]:
            return
        await wa.send_text(str(row["company_id"]), row["customer_phone"],
                           confirmation_text(row["brand"], row["name"], row["plate"] or "", _link(str(row["branch_id"]))))
    except Exception as e:
        print(f"⚠ رسالة تأكيد الحجز: {type(e).__name__}: {e}")


async def send_due_reminders() -> int:
    """يبعت تذكير لكل حجز أونلاين منتظر دوره قرب — بيرجع عدد اللي اتبعتلهم"""
    rows = await fetch(
        """SELECT c.id, c.company_id, c.plate, c.customer_phone, b.name AS branch_name
           FROM cars c JOIN branches b ON b.id = c.branch_id
           WHERE c.is_deleted=FALSE AND c.exited_at IS NULL AND c.entered_at IS NULL
             AND c.registrar_name=$1 AND c.reminder_sent_at IS NULL
             AND c.customer_phone IS NOT NULL
             AND c.created_at > now() - interval '12 hours'
             AND (SELECT COUNT(*) FROM cars x
                   WHERE x.branch_id=c.branch_id AND x.is_deleted=FALSE
                     AND x.exited_at IS NULL AND x.entered_at IS NULL
                     AND x.created_at < c.created_at AND x.id <> c.id) <= $2""",
        ONLINE_REGISTRAR, REMIND_WHEN_AHEAD_AT_MOST)
    sent = 0
    for r in rows:
        # نعلّم الأول عشان ما يتكررش لو الإرسال اتأخر أو فشل
        await execute("UPDATE cars SET reminder_sent_at = now() WHERE id=$1", r["id"])
        if await wa.send_text(str(r["company_id"]), r["customer_phone"], reminder_text(r["plate"] or "", r["branch_name"])):
            sent += 1
    return sent


async def reminder_loop() -> None:
    while True:
        try:
            await send_due_reminders()
        except asyncio.CancelledError:
            raise
        except Exception as e:
            print(f"⚠ تذكير الدور: {type(e).__name__}: {e}")
        await asyncio.sleep(LOOP_SECONDS)
