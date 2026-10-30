# app/main.py — نقطة الإقلاع: تجميع المحرك + تركيب الموديولات آلياً
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from .core.config import settings
from .core.db import init_pool, close_pool
from .core import module_loader
from . import modules as modules_pkg
from .modules.notifications.schema import NOTIFICATIONS_ENSURE_SQL
from .modules.terminal.schema import TERMINAL_ENSURE_SQL


# ══════════════════ المشرف الآلي: مراقبة دورية لسيارات الخدمة بالكاميرات ══════════════════
async def _auto_supervisor():
    """كل 4 دقايق: لقطة وتحليل لسيارات في الخدمة عندها كاميرا محطة — تعليم تلقائي + تنبيهات الأخطاء"""
    import asyncio as _aio
    import base64 as _b64

    from .core.config import settings as _cfg
    from .core.db import execute as _exec
    from .core.db import fetch as _fetch

    await _aio.sleep(20)   # مهلة إقلاع
    _last_scan: dict = {}   # آخر فحص لكل سيارة — منع التكرار المتقارب
    import time as _time
    while True:
        try:
            key = (_cfg.ANTHROPIC_API_KEY or "").strip()
            _off = {str(r["company_id"]) for r in await _fetch(
                "SELECT company_id FROM company_settings WHERE key='ai_supervisor' AND value='off'")}
            if key:
                from .modules.cameras.api import _error_hunt_call, _grab_frame
                # تنظيف مراجع السيارات الخارجة من يومين+
                await _exec("UPDATE cars SET ref_photo_b64=NULL WHERE ref_photo_b64 IS NOT NULL AND exited_at < now() - interval '2 days'")
                cars = await _fetch(
                    """SELECT c.id, c.company_id, c.plate, c.station, c.checklist, c.ref_photo_b64 IS NOT NULL AS has_ref,
                              cam.id AS cam_id, cam.rtsp_url
                       FROM cars c
                       JOIN companies co ON co.id = c.company_id
                        AND COALESCE(co.ai_supervisor_enabled, TRUE) = TRUE
                       JOIN station_cameras cam
                         ON cam.company_id = c.company_id
                        AND cam.branch_id = c.branch_id
                        AND cam.is_active = TRUE
                        AND cam.station::text = regexp_replace(COALESCE(c.station,''), '\\D', '', 'g')
                       WHERE c.is_deleted = FALSE
                         AND c.entered_at IS NOT NULL AND c.exited_at IS NULL
                         AND c.entered_at > now() - interval '20 minutes'
                       ORDER BY c.entered_at LIMIT 3""")
                _now = _time.time()
                # تنظيف الذاكرة من السيارات القديمة
                for k in [k for k, v in _last_scan.items() if _now - v > 1800]:
                    _last_scan.pop(k, None)
                for car in cars:
                    if str(car["company_id"]) in _off:
                        continue   # المراقبة الذكية موقوفة من الإعدادات
                    if _now - _last_scan.get(str(car["id"]), 0) < 120:
                        continue   # اتفحصت من أقل من دقيقتين — دورها الجاي
                    _last_scan[str(car["id"])] = _now
                    try:
                        jpeg = await _aio.to_thread(_grab_frame, car["rtsp_url"])
                        img = _b64.b64encode(jpeg).decode()
                        if not car["has_ref"]:
                            # أول لقطة بعد الدخول = المرجعية (حالة السيارة قبل الشغل)
                            await _exec("UPDATE cars SET ref_photo_b64=$1, ref_photo_at=now() WHERE id=$2",
                                        img, car["id"])
                        faults = await _aio.to_thread(_error_hunt_call, key, img)
                        for f in faults:
                            if float(f.get("confidence") or 0) >= 0.65:
                                await _exec(
                                    """INSERT INTO car_alerts (company_id, car_id, plate, station, message)
                                       SELECT $1,$2,$3,$4,$5
                                       WHERE NOT EXISTS (
                                         SELECT 1 FROM car_alerts
                                         WHERE car_id=$2 AND message=$5 AND seen=FALSE)""",
                                    car["company_id"], car["id"], car["plate"], car["station"],
                                    f"🎯 {f['label']}: {f['note'] or 'مرصود بالكاميرا'}")
                    except Exception:
                        continue   # كاميرا واقعة أو تحليل فشل — نكمل بهدوء
        except Exception:
            pass
        await _aio.sleep(90)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ⚠ سر التوقيع الافتراضي منشور في المستودع — لو بقي كما هو يستطيع أي شخص تزوير توكن دخول (حتى مدير). لا نوقف الإقلاع لتفادي تعطيل نظام يعمل، لكن نصرخ.
    if settings.JWT_SECRET == "z8SecretKey2026XyzAbc123456789QwErTy":
        print("🚨🚨 JWT_SECRET هو القيمة الافتراضية المنشورة في الكود — اضبط JWT_SECRET عشوائياً (32+ حرفاً) في backend/.env الآن ثم أعد تشغيل z8-api", flush=True)
    # ═══ البوابة الذكية: تشغيل المراقب الخلفي الدائم مع إقلاع الخادم ═══
    try:
        from app.modules.auto_checkin.watcher import start_watcher
        start_watcher()
    except Exception as _e:
        print(f"⚠ تعذر تشغيل مراقب البوابة: {_e}")
    await init_pool()
    print("🐘 PostgreSQL متصلة")
    # ── تحصين المخطط: أعمدة جديدة تُضاف آلياً بدون Migration يدوي ──
    from .core.db import execute
    for stmt in (
        # ════════ تحصين جذري لجدول cars: قواعد البيانات القديمة (عهد Node) ناقصة أعمدة ════════
        # القراءة (SELECT *) بتشتغل عادي فالمشكلة بتظهر بس عند التسجيل بـ500 غامضة.
        # الإنشاء الكامل للقواعد الجديدة + ALTER لكل عمود للقواعد القديمة — كله idempotent.
        """CREATE TABLE IF NOT EXISTS cars (
             id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
             company_id uuid NOT NULL,
             branch_id uuid,
             plate text, plate_type text DEFAULT 'saudi',
             brand text, name text, model_year text,
             car_category text, cylinders text, color text, chassis_number text,
             customer_name text, customer_phone text, customer_id uuid,
             station text,
             odometer_current int, odometer_previous int,
             notes text, registrar_name text, created_by uuid,
             entered_at timestamptz, exited_at timestamptz,
             is_deleted boolean NOT NULL DEFAULT FALSE, deleted_at timestamptz,
             created_at timestamptz NOT NULL DEFAULT now()
           )""",
        "ALTER TABLE cars ADD COLUMN IF NOT EXISTS plate_type text DEFAULT 'saudi'",
        "ALTER TABLE cars ADD COLUMN IF NOT EXISTS brand text",
        "ALTER TABLE cars ADD COLUMN IF NOT EXISTS name text",
        "ALTER TABLE cars ADD COLUMN IF NOT EXISTS model_year text",
        "ALTER TABLE cars ADD COLUMN IF NOT EXISTS car_category text",
        "ALTER TABLE cars ADD COLUMN IF NOT EXISTS cylinders text",
        "ALTER TABLE cars ADD COLUMN IF NOT EXISTS color text",
        "ALTER TABLE cars ADD COLUMN IF NOT EXISTS fuel_type text",
        "ALTER TABLE cars ADD COLUMN IF NOT EXISTS chassis_number text",
        "ALTER TABLE cars ADD COLUMN IF NOT EXISTS customer_name text",
        "ALTER TABLE cars ADD COLUMN IF NOT EXISTS customer_phone text",
        "ALTER TABLE cars ADD COLUMN IF NOT EXISTS customer_id uuid",
        "ALTER TABLE cars ADD COLUMN IF NOT EXISTS station text",
        "ALTER TABLE cars ADD COLUMN IF NOT EXISTS odometer_current int",
        "ALTER TABLE cars ADD COLUMN IF NOT EXISTS odometer_previous int",
        "ALTER TABLE cars ADD COLUMN IF NOT EXISTS notes text",
        "ALTER TABLE cars ADD COLUMN IF NOT EXISTS registrar_name text",
        "ALTER TABLE cars ADD COLUMN IF NOT EXISTS created_by uuid",
        "ALTER TABLE cars ADD COLUMN IF NOT EXISTS entered_at timestamptz",
        "ALTER TABLE cars ADD COLUMN IF NOT EXISTS exited_at timestamptz",
        "ALTER TABLE cars ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT FALSE",
        "ALTER TABLE cars ADD COLUMN IF NOT EXISTS deleted_at timestamptz",
        "ALTER TABLE cars ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now()",
        # ════════ جذر بق "بتتسجل وما تظهرش": العمود موجود من العهد القديم بس nullable ════════
        # ADD IF NOT EXISTS ما بيصلحش عمود موجود بشكل غلط — فالتسجيل بيسيب is_deleted=NULL،
        # وNULL = FALSE في SQL بترجع NULL (مش TRUE) فالسيارة بتتطرد من كل الاستعلامات.
        # التطبيع + الافتراضي + NOT NULL = القفل النهائي على فئة الأخطاء دي كلها.
        "UPDATE cars SET is_deleted = FALSE WHERE is_deleted IS NULL",
        "ALTER TABLE cars ALTER COLUMN is_deleted SET DEFAULT FALSE",
        "ALTER TABLE cars ALTER COLUMN is_deleted SET NOT NULL",
        "UPDATE cars SET created_at = now() WHERE created_at IS NULL",
        "ALTER TABLE cars ALTER COLUMN created_at SET DEFAULT now()",
        "ALTER TABLE cars ALTER COLUMN created_at SET NOT NULL",
        "UPDATE cars SET work_status = 'ready' WHERE work_status IS NULL",
        # ════════ جراج العميل الدائم — مستخدم في باركود الحجز ومش متضمن في أي ترقية ════════
        """CREATE TABLE IF NOT EXISTS customer_vehicles (
             id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
             company_id uuid NOT NULL,
             customer_id uuid NOT NULL,
             plate text NOT NULL, plate_norm text NOT NULL,
             brand text, name text, model_year text,
             car_category text, cylinders text, color text, chassis_number text,
             last_odometer int,
             service_type text NOT NULL DEFAULT 'basic',
             created_at timestamptz NOT NULL DEFAULT now(),
             UNIQUE (company_id, plate_norm)
           )""",
        # ════════ طابور البوابة الذكية — الموديول بيفحص وجوده بس ما بينشئهوش ════════
        """CREATE TABLE IF NOT EXISTS car_service_queue (
             id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
             car_id uuid NOT NULL,
             customer_id uuid,
             branch_id uuid,
             status text NOT NULL DEFAULT 'waiting',
             station text,
             entry_time timestamptz NOT NULL DEFAULT now(),
             exit_time timestamptz,
             odometer int,
             notes text
           )""",
        # ════════ إصلاح شكل customer_cars القديم — القيد الفريد الناقص كان بيسمم ترانزاكشن التسجيل ════════
        """DELETE FROM customer_cars a USING customer_cars b
           WHERE a.customer_id = b.customer_id AND a.plate = b.plate AND a.id < b.id""",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_cars_cust_plate ON customer_cars (customer_id, plate)",
        # ══ اتساق أوامر العمل: اللي دخلت فعلاً ما تفضلش queued (شفاء بيانات العهد القديم) ══
        """UPDATE cars SET work_status='preparing'
           WHERE work_status='queued' AND entered_at IS NOT NULL AND exited_at IS NULL""",
        # ══ إعداد واتساب (UltraMsg) على مستوى الشركة ══
        "ALTER TABLE companies ADD COLUMN IF NOT EXISTS wa_instance TEXT",
        "ALTER TABLE companies ADD COLUMN IF NOT EXISTS wa_token TEXT",
        # ══ صافي الربح: تكلفة البضاعة المباعة محفوظة على الفاتورة نفسها ══
        "ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cogs_total NUMERIC(12,2) NOT NULL DEFAULT 0",
        # ══ Idempotency: منع إنشاء فاتورتين من نفس الطلب (ضغط مزدوج/إعادة إرسال شبكية) ══
        "ALTER TABLE invoices ADD COLUMN IF NOT EXISTS idempotency_key TEXT",
        # ══ الفنيون: دور فني للموظف + فنيو كل سيارة (التعبئة متغيرة، الباقي شبه ثابت) ══
        "ALTER TABLE hr_employees ADD COLUMN IF NOT EXISTS tech_role TEXT",
        "ALTER TABLE cars ADD COLUMN IF NOT EXISTS filler_id UUID",
        "ALTER TABLE cars ADD COLUMN IF NOT EXISTS fitter1_id UUID",
        "ALTER TABLE cars ADD COLUMN IF NOT EXISTS fitter2_id UUID",
        "ALTER TABLE cars ADD COLUMN IF NOT EXISTS checker_id UUID",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_idem "
        "ON invoices (company_id, idempotency_key) WHERE idempotency_key IS NOT NULL",
        # ══ الخصومات: على مستوى البند وعلى مستوى الفاتورة ══
        "ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0",
        "ALTER TABLE invoices ADD COLUMN IF NOT EXISTS discount_total NUMERIC(12,2) NOT NULL DEFAULT 0",
        # ══ سجل تدقيق العمليات الحساسة (خصم/تعديل سعر/إلغاء/مرتجع...) ══
        """CREATE TABLE IF NOT EXISTS audit_log (
             id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
             company_id UUID NOT NULL,
             branch_id UUID,
             user_id UUID,
             user_email TEXT,
             action TEXT NOT NULL,
             entity TEXT NOT NULL,
             entity_id TEXT,
             old_value TEXT,
             new_value TEXT,
             reason TEXT,
             created_at TIMESTAMPTZ NOT NULL DEFAULT now()
           )""",
        "CREATE INDEX IF NOT EXISTS idx_audit_company_time ON audit_log (company_id, created_at DESC)",
        # الكود يكتب في audit_log بمجموعتي أعمدة (user_id/entity/old_value... و actor_id/scope/details...) — نضمن وجودهما معاً
        "ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS actor_id TEXT",
        "ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS actor_name TEXT",
        "ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS scope TEXT",
        "ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS car_id UUID",
        "ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS details TEXT",
        "ALTER TABLE audit_log ALTER COLUMN entity DROP NOT NULL",
        # ════════ أعمدة customers اللي بيكتب فيها التسجيل والحجز ════════
        "ALTER TABLE customers ADD COLUMN IF NOT EXISTS customer_type text NOT NULL DEFAULT 'individual'",
        "ALTER TABLE customers ADD COLUMN IF NOT EXISTS vat_number text",
        "ALTER TABLE customers ADD COLUMN IF NOT EXISTS cr_number text",
        "ALTER TABLE customers ADD COLUMN IF NOT EXISTS address text",
        # ════════ الترقيات الأصلية ════════
        "ALTER TABLE cars ADD COLUMN IF NOT EXISTS checklist jsonb NOT NULL DEFAULT '[]'::jsonb",
        "ALTER TABLE companies ADD COLUMN IF NOT EXISTS phone text",
        # عدّاد يتزايد مع كل تغيير للشعار — يُستخدم كـ cache-buster حقيقي في رابط الشعار
        # (قبل كده الرابط كان ثابت دايمًا، فالمتصفح يفضّل يعرض نسخة قديمة مخزّنة ساعة كاملة
        # من الكاش بعد أي تغيير — "شعار عشوائي قديم" اللي بلّغ عنه المالك)
        "ALTER TABLE companies ADD COLUMN IF NOT EXISTS logo_version integer NOT NULL DEFAULT 0",
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS is_service boolean NOT NULL DEFAULT FALSE",
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS is_oil boolean NOT NULL DEFAULT FALSE",
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS is_oil_filter boolean NOT NULL DEFAULT FALSE",
        "ALTER TABLE cars ADD COLUMN IF NOT EXISTS draft_items jsonb",
        "ALTER TABLE cars ADD COLUMN IF NOT EXISTS service_type text",
        """CREATE TABLE IF NOT EXISTS branch_requests (
             id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
             company_id uuid NOT NULL,
             requesting_branch_id uuid NOT NULL,
             source_branch_id text,
             source_loc_type text NOT NULL DEFAULT 'branch',
             status text NOT NULL DEFAULT 'pending',
             note text,
             requested_by uuid,
             requested_by_name text,
             decided_by_name text,
             decision_note text,
             created_at timestamptz NOT NULL DEFAULT now(),
             decided_at timestamptz
           )""",
        """CREATE TABLE IF NOT EXISTS branch_request_items (
             id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
             request_id uuid NOT NULL REFERENCES branch_requests(id) ON DELETE CASCADE,
             product_id uuid NOT NULL,
             product_label text NOT NULL,
             qty_requested int NOT NULL,
             qty_approved int
           )""",
        "ALTER TABLE companies ADD COLUMN IF NOT EXISTS ai_supervisor_enabled boolean NOT NULL DEFAULT TRUE",
        "ALTER TABLE cars ADD COLUMN IF NOT EXISTS ref_photo_b64 text",
        "ALTER TABLE cars ADD COLUMN IF NOT EXISTS ref_photo_at timestamptz",
        # ── ماكينة حالات أمر العمل: queued ← preparing ← ready ← invoiced ──
        #    السيارات القديمة تتعبّى 'ready' (تفضل ظاهرة للكاشير زي ما هي — صفر تعطيل)،
        #    وبعدها الافتراضي للسيارات الجديدة يبقى 'queued' (لازم تعدي على موظف الإعداد)
        "ALTER TABLE cars ADD COLUMN IF NOT EXISTS work_status text NOT NULL DEFAULT 'ready'",
        "ALTER TABLE cars ALTER COLUMN work_status SET DEFAULT 'queued'",
        "ALTER TABLE cars ADD COLUMN IF NOT EXISTS prepared_by_name text",
        "ALTER TABLE cars ADD COLUMN IF NOT EXISTS prepared_at timestamptz",
        "ALTER TABLE car_alerts ADD COLUMN IF NOT EXISTS is_false boolean NOT NULL DEFAULT FALSE",
        "ALTER TABLE branch_requests ALTER COLUMN source_branch_id TYPE text USING source_branch_id::text",
        "ALTER TABLE branch_requests ADD COLUMN IF NOT EXISTS source_loc_type text NOT NULL DEFAULT 'branch'",
        "ALTER TABLE customers ADD COLUMN IF NOT EXISTS building_no text",
        "ALTER TABLE customers ADD COLUMN IF NOT EXISTS street text",
        "ALTER TABLE customers ADD COLUMN IF NOT EXISTS district text",
        "ALTER TABLE customers ADD COLUMN IF NOT EXISTS city text",
        "ALTER TABLE customers ADD COLUMN IF NOT EXISTS postal_code text",
        "ALTER TABLE customers ADD COLUMN IF NOT EXISTS additional_no text",
        """CREATE TABLE IF NOT EXISTS customer_cars (
             id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
             company_id uuid NOT NULL,
             customer_id uuid NOT NULL,
             plate text NOT NULL,
             brand text, name text, model_year text,
             car_category text, cylinders text, color text, chassis_number text,
             service_type text NOT NULL DEFAULT 'basic',
             last_odometer int,
             created_at timestamptz NOT NULL DEFAULT now(),
             UNIQUE (customer_id, plate)
           )""",
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS oil_brand text",
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS oil_type text",
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS filter_kind text",
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS original_name text",
        """CREATE TABLE IF NOT EXISTS booking_otps (
             id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
             company_id uuid NOT NULL,
             channel text NOT NULL,
             target text NOT NULL,
             code_hash text NOT NULL,
             attempts int NOT NULL DEFAULT 0,
             used boolean NOT NULL DEFAULT FALSE,
             expires_at timestamptz NOT NULL,
             created_at timestamptz NOT NULL DEFAULT now()
           )""",
        "CREATE INDEX IF NOT EXISTS booking_otps_lookup ON booking_otps (company_id, channel, target, created_at DESC)",
        """CREATE TABLE IF NOT EXISTS company_settings (
             company_id uuid NOT NULL,
             key text NOT NULL,
             value text NOT NULL,
             PRIMARY KEY (company_id, key)
           )""",
        """CREATE TABLE IF NOT EXISTS car_alerts (
             id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
             company_id uuid NOT NULL,
             car_id uuid NOT NULL,
             plate text,
             station text,
             message text NOT NULL,
             seen boolean NOT NULL DEFAULT FALSE,
             created_at timestamptz NOT NULL DEFAULT now()
           )""",
        """CREATE TABLE IF NOT EXISTS car_work_log (
             id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
             company_id uuid NOT NULL,
             car_id uuid NOT NULL,
             employee_id uuid,
             employee_name text NOT NULL,
             station text,
             action text NOT NULL DEFAULT 'work',
             created_at timestamptz NOT NULL DEFAULT now()
           )""",
        """CREATE TABLE IF NOT EXISTS ai_briefs (
             company_id uuid NOT NULL,
             brief_date date NOT NULL,
             content text NOT NULL,
             created_at timestamptz NOT NULL DEFAULT now(),
             PRIMARY KEY (company_id, brief_date)
           )""",
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS image_base64 text",
        """CREATE TABLE IF NOT EXISTS service_price_rules (
             id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
             company_id uuid NOT NULL,
             service_product_id uuid NOT NULL,
             brand text,
             model text,
             year_from int,
             year_to int,
             price numeric(12,2) NOT NULL,
             created_at timestamptz NOT NULL DEFAULT now()
           )""",
        """CREATE TABLE IF NOT EXISTS oil_brands (
             id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
             company_id uuid NOT NULL,
             name text NOT NULL,
             logo_base64 text,
             sort int NOT NULL DEFAULT 0,
             UNIQUE (company_id, name)
           )""",
        # ── جداول الموارد البشرية (تشغيل كامل حتى لو الترحيل القديم ما اتنفذش) ──
        """CREATE TABLE IF NOT EXISTS hr_employees (
             id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
             company_id uuid NOT NULL,
             branch_id uuid,
             linked_user_id uuid,
             full_name text NOT NULL,
             national_id text, nationality text,
             is_saudi boolean NOT NULL DEFAULT FALSE,
             birth_date date, phone text, job_title text,
             contract_type text NOT NULL DEFAULT 'full_time',
             hire_date date NOT NULL DEFAULT CURRENT_DATE,
             termination_date date,
             basic_salary numeric(12,2) NOT NULL DEFAULT 0,
             iban text, iqama_number text, iqama_expiry_date date,
             is_active boolean NOT NULL DEFAULT TRUE,
             created_at timestamptz NOT NULL DEFAULT now(),
             updated_at timestamptz NOT NULL DEFAULT now()
           )""",
        """CREATE TABLE IF NOT EXISTS hr_attendance (
             id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
             company_id uuid NOT NULL,
             employee_id uuid NOT NULL,
             work_date date NOT NULL DEFAULT CURRENT_DATE,
             check_in timestamptz, check_out timestamptz,
             created_by uuid,
             created_at timestamptz NOT NULL DEFAULT now(),
             UNIQUE (employee_id, work_date)
           )""",
        """CREATE TABLE IF NOT EXISTS hr_leave_requests (
             id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
             company_id uuid NOT NULL,
             employee_id uuid NOT NULL,
             leave_type text NOT NULL,
             start_date date NOT NULL, end_date date NOT NULL,
             days_count int NOT NULL,
             reason text,
             status text NOT NULL DEFAULT 'pending',
             approved_by uuid,
             created_at timestamptz NOT NULL DEFAULT now()
           )""",
        """CREATE TABLE IF NOT EXISTS hr_violations (
             id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
             company_id uuid NOT NULL,
             employee_id uuid NOT NULL,
             violation_type text, description text,
             deduction_amount numeric(12,2) NOT NULL DEFAULT 0,
             violation_date date NOT NULL DEFAULT CURRENT_DATE,
             issued_by uuid,
             created_at timestamptz NOT NULL DEFAULT now()
           )""",
        """CREATE TABLE IF NOT EXISTS hr_payroll_runs (
             id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
             company_id uuid NOT NULL,
             period_month int NOT NULL, period_year int NOT NULL,
             created_by uuid,
             created_at timestamptz NOT NULL DEFAULT now(),
             UNIQUE (company_id, period_month, period_year)
           )""",
        """CREATE TABLE IF NOT EXISTS hr_payslips (
             id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
             payroll_run_id uuid NOT NULL,
             employee_id uuid NOT NULL,
             basic_salary numeric(12,2) NOT NULL DEFAULT 0,
             violations_deduction numeric(12,2) NOT NULL DEFAULT 0,
             gosi_employee numeric(12,2) NOT NULL DEFAULT 0,
             gosi_employer numeric(12,2) NOT NULL DEFAULT 0,
             net_pay numeric(12,2) NOT NULL DEFAULT 0
           )""",
        "ALTER TABLE companies ADD COLUMN IF NOT EXISTS gosi_saudi_employee_pct numeric(5,2) NOT NULL DEFAULT 9.75",
        "ALTER TABLE companies ADD COLUMN IF NOT EXISTS gosi_saudi_employer_pct numeric(5,2) NOT NULL DEFAULT 11.75",
        "ALTER TABLE companies ADD COLUMN IF NOT EXISTS gosi_nonsaudi_employer_pct numeric(5,2) NOT NULL DEFAULT 2.00",
        # ── خطوط السير المتعددة لكل فرع (الحفرة والرافعات ثابتة كسعات) ──
        "ALTER TABLE branches ADD COLUMN IF NOT EXISTS lines jsonb NOT NULL DEFAULT '[]'::jsonb",
        """CREATE TABLE IF NOT EXISTS treasury_vouchers (
             id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
             company_id uuid NOT NULL,
             branch_id uuid,
             voucher_no text NOT NULL,
             type text NOT NULL CHECK (type IN ('receipt','payment')),
             amount numeric(12,2) NOT NULL CHECK (amount > 0),
             method text NOT NULL CHECK (method IN ('cash','card','transfer')),
             party_type text NOT NULL,
             customer_id uuid,
             party_name text,
             category text,
             description text,
             created_by uuid,
             created_at timestamptz NOT NULL DEFAULT now(),
             UNIQUE (company_id, voucher_no)
           )""",
        # ── جداول الموارد البشرية (تشغيل كامل حتى لو الترحيل القديم ما اتنفذش) ──
        """CREATE TABLE IF NOT EXISTS hr_employees (
             id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
             company_id uuid NOT NULL,
             branch_id uuid,
             linked_user_id uuid,
             full_name text NOT NULL,
             national_id text, nationality text,
             is_saudi boolean NOT NULL DEFAULT FALSE,
             birth_date date, phone text, job_title text,
             contract_type text NOT NULL DEFAULT 'full_time',
             hire_date date NOT NULL DEFAULT CURRENT_DATE,
             termination_date date,
             basic_salary numeric(12,2) NOT NULL DEFAULT 0,
             iban text, iqama_number text, iqama_expiry_date date,
             is_active boolean NOT NULL DEFAULT TRUE,
             created_at timestamptz NOT NULL DEFAULT now(),
             updated_at timestamptz NOT NULL DEFAULT now()
           )""",
        """CREATE TABLE IF NOT EXISTS hr_attendance (
             id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
             company_id uuid NOT NULL,
             employee_id uuid NOT NULL,
             work_date date NOT NULL DEFAULT CURRENT_DATE,
             check_in timestamptz, check_out timestamptz,
             created_by uuid,
             created_at timestamptz NOT NULL DEFAULT now(),
             UNIQUE (employee_id, work_date)
           )""",
        """CREATE TABLE IF NOT EXISTS hr_leave_requests (
             id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
             company_id uuid NOT NULL,
             employee_id uuid NOT NULL,
             leave_type text NOT NULL,
             start_date date NOT NULL, end_date date NOT NULL,
             days_count int NOT NULL,
             reason text,
             status text NOT NULL DEFAULT 'pending',
             approved_by uuid,
             created_at timestamptz NOT NULL DEFAULT now()
           )""",
        """CREATE TABLE IF NOT EXISTS hr_violations (
             id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
             company_id uuid NOT NULL,
             employee_id uuid NOT NULL,
             violation_type text, description text,
             deduction_amount numeric(12,2) NOT NULL DEFAULT 0,
             violation_date date NOT NULL DEFAULT CURRENT_DATE,
             issued_by uuid,
             created_at timestamptz NOT NULL DEFAULT now()
           )""",
        """CREATE TABLE IF NOT EXISTS hr_payroll_runs (
             id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
             company_id uuid NOT NULL,
             period_month int NOT NULL, period_year int NOT NULL,
             created_by uuid,
             created_at timestamptz NOT NULL DEFAULT now(),
             UNIQUE (company_id, period_month, period_year)
           )""",
        """CREATE TABLE IF NOT EXISTS hr_payslips (
             id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
             payroll_run_id uuid NOT NULL,
             employee_id uuid NOT NULL,
             basic_salary numeric(12,2) NOT NULL DEFAULT 0,
             violations_deduction numeric(12,2) NOT NULL DEFAULT 0,
             gosi_employee numeric(12,2) NOT NULL DEFAULT 0,
             gosi_employer numeric(12,2) NOT NULL DEFAULT 0,
             net_pay numeric(12,2) NOT NULL DEFAULT 0
           )""",
        "ALTER TABLE companies ADD COLUMN IF NOT EXISTS gosi_saudi_employee_pct numeric(5,2) NOT NULL DEFAULT 9.75",
        "ALTER TABLE companies ADD COLUMN IF NOT EXISTS gosi_saudi_employer_pct numeric(5,2) NOT NULL DEFAULT 11.75",
        "ALTER TABLE companies ADD COLUMN IF NOT EXISTS gosi_nonsaudi_employer_pct numeric(5,2) NOT NULL DEFAULT 2.00",
        # ── ربط الرواتب بالمحاسبة: حالة الدفع الفعلي لمسير الرواتب (بعد الاعتماد) ──
        "ALTER TABLE hr_payroll_runs ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft'",
        "ALTER TABLE hr_payroll_runs ADD COLUMN IF NOT EXISTS finalized_at timestamptz",
        "ALTER TABLE hr_payroll_runs ADD COLUMN IF NOT EXISTS paid_at timestamptz",
        "ALTER TABLE hr_payroll_runs ADD COLUMN IF NOT EXISTS paid_by uuid",
        "ALTER TABLE hr_payroll_runs ADD COLUMN IF NOT EXISTS payment_method text",
        "ALTER TABLE hr_payslips ADD COLUMN IF NOT EXISTS advance_deduction numeric(12,2) NOT NULL DEFAULT 0",

        # ── عمولات المبيعات: نسبة لكل موظف (مبيعات أو ربح) تُحسَب تلقائياً عند تشغيل الرواتب ──
        "ALTER TABLE hr_employees ADD COLUMN IF NOT EXISTS commission_type text NOT NULL DEFAULT 'none'",
        "ALTER TABLE hr_employees ADD COLUMN IF NOT EXISTS commission_pct numeric(5,2) NOT NULL DEFAULT 0",
        "ALTER TABLE hr_payslips ADD COLUMN IF NOT EXISTS commission_amount numeric(12,2) NOT NULL DEFAULT 0",

        # ── دورة الشراء الرسمية: عروض أسعار ← أمر شراء معتمد ← استلام مخزني ← مطابقة فاتورة المورد ──
        """CREATE TABLE IF NOT EXISTS purchase_quotations (
             id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
             company_id uuid NOT NULL,
             quotation_no text NOT NULL,
             supplier_id uuid NOT NULL,
             valid_until date,
             note text,
             status text NOT NULL DEFAULT 'received',
             created_by uuid,
             created_at timestamptz NOT NULL DEFAULT now(),
             UNIQUE (company_id, quotation_no)
           )""",
        """CREATE TABLE IF NOT EXISTS purchase_quotation_items (
             id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
             quotation_id uuid NOT NULL,
             product_id uuid,
             product_label text NOT NULL,
             qty int NOT NULL CHECK (qty > 0),
             unit_cost numeric(12,2) NOT NULL DEFAULT 0
           )""",
        """CREATE TABLE IF NOT EXISTS purchase_orders (
             id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
             company_id uuid NOT NULL,
             po_no text NOT NULL,
             supplier_id uuid NOT NULL,
             quotation_id uuid,
             status text NOT NULL DEFAULT 'pending_approval',
             expected_date date,
             note text,
             subtotal numeric(12,2) NOT NULL DEFAULT 0,
             vat_total numeric(12,2) NOT NULL DEFAULT 0,
             total numeric(12,2) NOT NULL DEFAULT 0,
             approved_by uuid,
             approved_by_name text,
             approved_at timestamptz,
             rejected_reason text,
             created_by uuid,
             created_at timestamptz NOT NULL DEFAULT now(),
             UNIQUE (company_id, po_no)
           )""",
        """CREATE TABLE IF NOT EXISTS purchase_order_items (
             id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
             po_id uuid NOT NULL,
             product_id uuid,
             product_label text NOT NULL,
             qty int NOT NULL CHECK (qty > 0),
             unit_cost numeric(12,2) NOT NULL DEFAULT 0,
             line_total numeric(12,2) NOT NULL DEFAULT 0,
             qty_received int NOT NULL DEFAULT 0,
             qty_invoiced int NOT NULL DEFAULT 0
           )""",
        """CREATE TABLE IF NOT EXISTS purchase_order_receipts (
             id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
             company_id uuid NOT NULL,
             po_id uuid NOT NULL,
             receipt_no text NOT NULL,
             note text,
             received_by uuid,
             received_by_name text,
             created_at timestamptz NOT NULL DEFAULT now(),
             UNIQUE (company_id, receipt_no)
           )""",
        """CREATE TABLE IF NOT EXISTS purchase_order_receipt_items (
             id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
             receipt_id uuid NOT NULL,
             po_item_id uuid NOT NULL,
             qty_received int NOT NULL CHECK (qty_received > 0)
           )""",
        "ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS po_id uuid",
        "ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS price_variance_confirmed boolean NOT NULL DEFAULT FALSE",

        # ── تقييم وتصنيف الموردين (راجع modules/suppliers get_scorecard) ──
        "ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS category text",
        "ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS rating numeric(2,1)",
        "ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS rating_note text",

        # ── SKU مستقل عن الباركود + مواقع تخزين داخلية (أرفف) + أصناف بديلة/مرتبطة ──
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS sku text",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_products_sku_company ON products(company_id, sku) WHERE sku IS NOT NULL",
        "ALTER TABLE inventory ADD COLUMN IF NOT EXISTS shelf_location text",
        """CREATE TABLE IF NOT EXISTS product_links (
             id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
             company_id uuid NOT NULL,
             product_id uuid NOT NULL,
             linked_product_id uuid NOT NULL,
             link_type text NOT NULL DEFAULT 'related',
             created_at timestamptz NOT NULL DEFAULT now(),
             UNIQUE(company_id, product_id, linked_product_id, link_type)
           )""",
        "CREATE INDEX IF NOT EXISTS idx_product_links_product ON product_links(product_id)",
        "CREATE INDEX IF NOT EXISTS idx_product_links_linked ON product_links(linked_product_id)",

        # ── المدفوعات الإلكترونية: بنية هيكلية جاهزة لتفعيل مزوّد حقيقي (راجع modules/payments) ──
        """CREATE TABLE IF NOT EXISTS payment_transactions (
             id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
             company_id uuid NOT NULL,
             invoice_id uuid,
             customer_id uuid,
             amount numeric(12,2) NOT NULL,
             currency text NOT NULL DEFAULT 'SAR',
             provider text,
             status text NOT NULL DEFAULT 'pending',
             reference text NOT NULL UNIQUE,
             provider_ref text,
             checkout_url text,
             note text,
             created_by uuid,
             created_at timestamptz NOT NULL DEFAULT now(),
             paid_at timestamptz
           )""",
        "CREATE INDEX IF NOT EXISTS idx_payment_tx_company ON payment_transactions(company_id)",
        "CREATE INDEX IF NOT EXISTS idx_payment_tx_invoice ON payment_transactions(invoice_id)",
        # تحصيل إلكتروني تلقائي (ويبهوك خارجي بلا مستخدم مسجَّل) يحتاج created_by قابلاً للفراغ
        "ALTER TABLE customer_ledger ALTER COLUMN created_by DROP NOT NULL",
        "ALTER TABLE journal_entries ALTER COLUMN created_by DROP NOT NULL",

        # ── خطوط السير المتعددة لكل فرع (الحفرة والرافعات ثابتة كسعات) ──
        "ALTER TABLE branches ADD COLUMN IF NOT EXISTS lines jsonb NOT NULL DEFAULT '[]'::jsonb",
        """CREATE TABLE IF NOT EXISTS treasury_vouchers (
             id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
             company_id uuid NOT NULL,
             branch_id uuid,
             voucher_no text NOT NULL,
             vtype text NOT NULL CHECK (vtype IN ('receipt','payment')),
             party_type text NOT NULL CHECK (party_type IN ('customer','supplier','expense','other')),
             method text NOT NULL CHECK (method IN ('cash','card','transfer')),
             amount numeric(12,2) NOT NULL CHECK (amount > 0),
             customer_id uuid,
             supplier_id uuid,
             party_name text,
             category text,
             description text,
             voucher_date date NOT NULL DEFAULT CURRENT_DATE,
             created_by uuid,
             created_at timestamptz NOT NULL DEFAULT now(),
             is_cancelled boolean NOT NULL DEFAULT FALSE,
             UNIQUE (company_id, vtype, voucher_no)
           )""",
        """CREATE TABLE IF NOT EXISTS station_cameras (
             id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
             company_id uuid NOT NULL,
             branch_id uuid NOT NULL,
             station int NOT NULL CHECK (station BETWEEN 1 AND 3),
             name text NOT NULL,
             rtsp_url text NOT NULL,
             is_active boolean NOT NULL DEFAULT TRUE,
             created_at timestamptz NOT NULL DEFAULT now()
           )""",

        # ═══ الجرد الفعلي: جلسات الجرد ═══
        """CREATE TABLE IF NOT EXISTS stocktake_sessions (
             id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
             company_id UUID NOT NULL,
             loc_type VARCHAR NOT NULL CHECK (loc_type IN ('warehouse','branch')),
             loc_id VARCHAR NOT NULL,
             status VARCHAR NOT NULL DEFAULT 'draft'
               CHECK (status IN ('draft','in_progress','review','approved','cancelled')),
             note TEXT,
             created_by UUID,
             created_by_name TEXT,
             approved_by UUID,
             approved_by_name TEXT,
             created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
             approved_at TIMESTAMPTZ
           )""",
        """CREATE INDEX IF NOT EXISTS idx_stocktake_sessions_company
             ON stocktake_sessions (company_id, created_at DESC)""",

        # ═══ تفاصيل الأصناف والكميات ═══
        """CREATE TABLE IF NOT EXISTS stocktake_items (
             id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
             session_id UUID NOT NULL REFERENCES stocktake_sessions(id) ON DELETE CASCADE,
             product_id UUID NOT NULL REFERENCES products(id),
             snapshot_qty INTEGER NOT NULL DEFAULT 0,
             counted_qty INTEGER,
             note TEXT,
             created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
             updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
             UNIQUE (session_id, product_id)
           )""",
        """CREATE INDEX IF NOT EXISTS idx_stocktake_items_session
             ON stocktake_items (session_id)""",
        # تكلفة الوحدة وقت اللقطة — الكود (create_stocktake/get_stocktake) يقرؤها ويكتبها؛ ADD IF NOT EXISTS لا يغيّر شيئاً إن كان العمود موجوداً
        "ALTER TABLE stocktake_items ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(12,2) NOT NULL DEFAULT 0",
        # ── الجرد: حقول سير العمل والتدقيق (إضافات فقط — لا يُعدَّل أو يُحذف شيء قائم) ──
        "ALTER TABLE stocktake_sessions ADD COLUMN IF NOT EXISTS name TEXT",
        "ALTER TABLE stocktake_sessions ADD COLUMN IF NOT EXISTS count_type VARCHAR NOT NULL DEFAULT 'full'",
        "ALTER TABLE stocktake_sessions ADD COLUMN IF NOT EXISTS category_filter TEXT",
        "ALTER TABLE stocktake_sessions ADD COLUMN IF NOT EXISTS submitted_by UUID",
        "ALTER TABLE stocktake_sessions ADD COLUMN IF NOT EXISTS submitted_by_name TEXT",
        "ALTER TABLE stocktake_sessions ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ",
        "ALTER TABLE stocktake_sessions ADD COLUMN IF NOT EXISTS cancelled_by_name TEXT",
        "ALTER TABLE stocktake_sessions ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ",
        "ALTER TABLE stocktake_sessions ADD COLUMN IF NOT EXISTS cancel_reason TEXT",
        "ALTER TABLE stocktake_sessions ADD COLUMN IF NOT EXISTS reopen_count INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE stocktake_sessions ADD COLUMN IF NOT EXISTS last_reopen_reason TEXT",
        "ALTER TABLE stocktake_sessions ADD COLUMN IF NOT EXISTS adjust_in_no TEXT",
        "ALTER TABLE stocktake_sessions ADD COLUMN IF NOT EXISTS adjust_out_no TEXT",
        "ALTER TABLE stocktake_sessions ADD COLUMN IF NOT EXISTS adjust_note TEXT",
        "ALTER TABLE stocktake_items ADD COLUMN IF NOT EXISTS item_condition VARCHAR",
        # سجل العدّ: كل إدخال كمية يُضاف كسطر جديد ولا يُعدَّل ولا يُحذف (العدّ الأول والثاني…)
        """CREATE TABLE IF NOT EXISTS stocktake_count_log (
             id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
             session_id UUID NOT NULL REFERENCES stocktake_sessions(id) ON DELETE CASCADE,
             product_id UUID NOT NULL,
             counted_qty INTEGER NOT NULL,
             item_condition VARCHAR,
             note TEXT,
             counted_by UUID,
             counted_by_name TEXT,
             counted_at TIMESTAMPTZ NOT NULL DEFAULT now()
           )""",
        "CREATE INDEX IF NOT EXISTS idx_stocktake_count_log_item ON stocktake_count_log (session_id, product_id, counted_at)",
        # ══ مركز الإعدادات — المرحلة 1: بيانات منشأة كاملة + شعار + أدوار حقيقية ══
        # (idempotent زي كل اللي فوق — بتتطبق تلقائياً مع كل إقلاع للباك-إند،
        #  بدون أي خطوة psql يدوية. عمود permissions الفعلي اللي core/deps.py
        #  بيقرأه للتحقق من الصلاحيات ما بيتلمسش هنا خالص.)
        "ALTER TABLE companies ADD COLUMN IF NOT EXISTS name_en TEXT",
        "ALTER TABLE companies ADD COLUMN IF NOT EXISTS trade_name TEXT",
        "ALTER TABLE companies ADD COLUMN IF NOT EXISTS unified_number TEXT",
        "ALTER TABLE companies ADD COLUMN IF NOT EXISTS establishment_number TEXT",
        "ALTER TABLE companies ADD COLUMN IF NOT EXISTS mobile TEXT",
        "ALTER TABLE companies ADD COLUMN IF NOT EXISTS email TEXT",
        "ALTER TABLE companies ADD COLUMN IF NOT EXISTS website TEXT",
        "ALTER TABLE companies ADD COLUMN IF NOT EXISTS building_no TEXT",
        "ALTER TABLE companies ADD COLUMN IF NOT EXISTS street TEXT",
        "ALTER TABLE companies ADD COLUMN IF NOT EXISTS district TEXT",
        "ALTER TABLE companies ADD COLUMN IF NOT EXISTS city TEXT",
        "ALTER TABLE companies ADD COLUMN IF NOT EXISTS postal_code TEXT",
        "ALTER TABLE companies ADD COLUMN IF NOT EXISTS additional_no TEXT",
        "ALTER TABLE companies ADD COLUMN IF NOT EXISTS country TEXT NOT NULL DEFAULT 'SA'",
        "ALTER TABLE companies ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'SAR'",
        "ALTER TABLE companies ADD COLUMN IF NOT EXISTS default_lang TEXT NOT NULL DEFAULT 'ar'",
        "ALTER TABLE companies ADD COLUMN IF NOT EXISTS logo_base64 TEXT",
        """CREATE TABLE IF NOT EXISTS roles (
             id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
             company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
             name        TEXT NOT NULL,
             icon        TEXT NOT NULL DEFAULT '🧩',
             description TEXT,
             permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
             is_system   BOOLEAN NOT NULL DEFAULT FALSE,
             created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
             updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
             UNIQUE (company_id, name)
           )""",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS role_id UUID REFERENCES roles(id) ON DELETE SET NULL",
        # Seed: نفس الخمس قوالب صلاحيات المُثبّتة سابقاً في صفحة تعديل الموظف — بالحرف
        """INSERT INTO roles (company_id, name, icon, description, permissions, is_system)
           SELECT c.id, v.name, v.icon, v.description, v.permissions::jsonb, TRUE
           FROM companies c
           CROSS JOIN (VALUES
             ('المدير', '👔', 'الفروع والتقارير والموظفين والتشغيل الكامل',
              '["cars.create","cars.confirm_entry","cars.confirm_exit","cars.edit","cars.delete","cars.notify",
                "invoices.prepare","invoices.create_service","invoices.view_pending","invoices.view_today","invoices.view_all",
                "invoices.edit_items","invoices.return",
                "customers.create","customers.edit","customers.view_statement","customers.record_payment",
                "products.view_stock",
                "reports.sales","reports.cashiers",
                "treasury.create_receipt","treasury.create_payment","treasury.view",
                "shifts.manage_own","shifts.view_branch",
                "hr.view","hr.manage","hr.attendance","hr.leave_approve","hr.violations",
                "branches.manage",
                "service_notes.view","service_notes.create","service_notes.manage"]'),
             ('المحاسب', '🧮', 'الحسابات والفواتير والتحصيل والإقرارات',
              '["accounting.view_reports","accounting.view_vat",
                "treasury.create_receipt","treasury.create_payment","treasury.view","treasury.cancel",
                "reports.sales","reports.cashiers",
                "invoices.view_all","invoices.view_today","invoices.return",
                "customers.view_statement","customers.record_payment",
                "purchasing.invoices","purchasing.suppliers",
                "shifts.view_branch"]'),
             ('الكاشير', '💳', 'نقطة البيع والفواتير والتحصيل فقط',
              '["shifts.manage_own",
                "invoices.create_service","invoices.view_today","invoices.view_pending",
                "customers.create",
                "cars.confirm_exit",
                "service_notes.view"]'),
             ('أمين المستودع', '📦', 'المخزون والاستلام والصرف والجرد والموردون',
              '["products.create","products.edit","products.view_stock","products.import",
                "purchasing.suppliers","purchasing.quotations","purchasing.orders","purchasing.invoices"]'),
             ('موظف خط الخدمة', '🔧', 'تسجيل السيارات والمحطات والتشييكات وملاحظات الخدمة',
              '["cars.create","cars.confirm_entry","cars.confirm_exit","cars.edit",
                "invoices.prepare",
                "service_notes.view","service_notes.create"]')
           ) AS v(name, icon, description, permissions)
           ON CONFLICT (company_id, name) DO NOTHING""",
        # ══ مركز الإعدادات — 14 إعداد جديد: الطباعة + النظام ══
        # company_settings (key-value) موجود بالفعل من قبل — بيُستخدم كمخزن عام
        # لكل مفاتيح print.* و sys.* الجديدة، فمفيش داعي لجدول جديد.
        # العمودين دول فقط جديدين — لقفل الحساب المؤقت بعد محاولات دخول فاشلة (إعداد 11):
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_count INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ",
        # ══ خلفية موحدة للنظام — معرض خلفيات متعدد + إعدادات شفافية/تمويه/تعتيم/عرض ══
        # إعدادات الشفافية والتمويه والتعتيم وطريقة العرض بتُخزَّن كـ bg.* في
        # company_settings (نفس مخزن print.*/sys.* الموجود) — الجدول ده فقط
        # للصور نفسها (معرض متعدد + حذف فردي، ما ينفعش يكون key-value بسيط).
        """CREATE TABLE IF NOT EXISTS backgrounds (
             id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
             company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
             name         TEXT NOT NULL,
             image_base64 TEXT NOT NULL,
             created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
           )""",
        "CREATE INDEX IF NOT EXISTS idx_backgrounds_company ON backgrounds (company_id)",
        # ══ إصلاح عطل حجز العميل: عمود engine_size كان موجوداً في الكود (تسجيل سيارة
        # العميل، شاشة الحجز العامة، ربط فلاتر السيارات) لكن migration-026-engine-size.sql
        # الخاص بيه اتكتب ولسه ما اتشغّلش على قاعدة الإنتاج — نفس نمط العطل اللي سبّب
        # حادثة اليوم الأولى بالظبط. هنا بقى self-healing زي كل حاجة تانية، صفر psql يدوي. ══
        "ALTER TABLE cars ADD COLUMN IF NOT EXISTS engine_size TEXT",
        "ALTER TABLE customer_cars ADD COLUMN IF NOT EXISTS engine_size TEXT",
        "ALTER TABLE customer_vehicles ADD COLUMN IF NOT EXISTS engine_size TEXT",
        # car_oil_filters نفسه مش موجود في أي DDL متتبّع بالكود (لا هنا ولا في أي migration) —
        # غالباً اتعمل يدوياً على الإنتاج قبل كده. شبكة أمان: لو موجود فعلاً IF NOT EXISTS
        # هيتجاهله تماماً، ولو مش موجود (بيئة تانية/نسخة احتياطية جديدة) هيتكوّن صح من الأول.
        """CREATE TABLE IF NOT EXISTS car_oil_filters (
             id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
             company_id        uuid NOT NULL,
             brand             text NOT NULL,
             model             text NOT NULL,
             year_from         int NOT NULL,
             year_to           int NOT NULL,
             filter_product_id uuid NOT NULL,
             created_by        uuid,
             filter_kind       text NOT NULL DEFAULT 'oil',
             cylinders         int,
             engine_size       text,
             created_at        timestamptz NOT NULL DEFAULT now()
           )""",
        "ALTER TABLE car_oil_filters ADD COLUMN IF NOT EXISTS engine_size TEXT",
        "CREATE INDEX IF NOT EXISTS idx_car_oil_filters_company ON car_oil_filters (company_id, brand, model)",
        # ══ المصادقة الثنائية (2FA — تطبيق مصادقة TOTP) + إدارة الجلسات/الأجهزة ══
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_pending_secret TEXT",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT FALSE",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_backup_codes JSONB NOT NULL DEFAULT '[]'::jsonb",
        """CREATE TABLE IF NOT EXISTS user_sessions (
             id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
             user_id      UUID NOT NULL,
             company_id   UUID NOT NULL,
             device_label TEXT,
             ip           TEXT,
             created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
             last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
             revoked_at   TIMESTAMPTZ
           )""",
        "CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions (user_id, revoked_at)",
        # ══ حد ائتمان العميل (إعداد المبيعات) — NULL = بلا حد (سلوك كل العملاء الحاليين بلا تغيير) ══
        "ALTER TABLE customers ADD COLUMN IF NOT EXISTS credit_limit NUMERIC(12,2)",
        # ══ قوائم أسعار متعددة — عميل بلا قائمة معيّنة (NULL) يفضل على السعر العادي بلا أي تغيير ══
        """CREATE TABLE IF NOT EXISTS price_lists (
             id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
             company_id UUID NOT NULL,
             name       TEXT NOT NULL,
             created_at TIMESTAMPTZ NOT NULL DEFAULT now()
           )""",
        "CREATE INDEX IF NOT EXISTS idx_price_lists_company ON price_lists (company_id)",
        """CREATE TABLE IF NOT EXISTS price_list_items (
             id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
             price_list_id UUID NOT NULL,
             product_id    UUID NOT NULL,
             price         NUMERIC(12,2) NOT NULL,
             price_vat     NUMERIC(12,2) NOT NULL,
             created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
             UNIQUE (price_list_id, product_id)
           )""",
        "CREATE INDEX IF NOT EXISTS idx_price_list_items_list ON price_list_items (price_list_id)",
        "ALTER TABLE customers ADD COLUMN IF NOT EXISTS price_list_id UUID",
        # ══ خصومات حسب الكمية — لكل صنف حدود كمية بنسب خصم، تُطبّق تلقائياً في شاشة البيع ══
        """CREATE TABLE IF NOT EXISTS quantity_discount_rules (
             id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
             company_id       UUID NOT NULL,
             product_id       UUID NOT NULL,
             min_qty          NUMERIC(12,3) NOT NULL,
             discount_percent NUMERIC(5,2) NOT NULL,
             created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
           )""",
        "CREATE INDEX IF NOT EXISTS idx_qty_discount_rules_product ON quantity_discount_rules (product_id)",
        # ══ عقود/اتفاقيات تسعير للعملاء الكبار — فاضية = عميل عادي بلا اتفاقية (بلا أي تغيير) ══
        "ALTER TABLE customers ADD COLUMN IF NOT EXISTS contract_discount_pct NUMERIC(5,2)",
        "ALTER TABLE customers ADD COLUMN IF NOT EXISTS contract_valid_from DATE",
        "ALTER TABLE customers ADD COLUMN IF NOT EXISTS contract_valid_until DATE",
        "ALTER TABLE customers ADD COLUMN IF NOT EXISTS contract_notes TEXT",
        # ══ برنامج نقاط/ولاء العملاء — معدّلات الاكتساب/الاستبدال في company_settings
        # (loyalty.earnPerSar / loyalty.redeemValue)، صفر = البرنامج معطّل بلا أي تغيير سلوك ══
        "ALTER TABLE customers ADD COLUMN IF NOT EXISTS loyalty_points INTEGER NOT NULL DEFAULT 0",
        """CREATE TABLE IF NOT EXISTS loyalty_ledger (
             id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
             company_id  UUID NOT NULL,
             customer_id UUID NOT NULL,
             points      INTEGER NOT NULL,
             kind        TEXT NOT NULL,
             note        TEXT,
             invoice_id  UUID,
             created_by  UUID,
             created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
           )""",
        "CREATE INDEX IF NOT EXISTS idx_loyalty_ledger_customer ON loyalty_ledger (customer_id)",

        # ── المرحلة 6: مدير الفرع + العنوان + ترقيم فواتير مستقل اختياري لكل فرع ──
        "ALTER TABLE branches ADD COLUMN IF NOT EXISTS manager_user_id uuid",
        "ALTER TABLE branches ADD COLUMN IF NOT EXISTS address text",
        "ALTER TABLE branches ADD COLUMN IF NOT EXISTS invoice_prefix text",
        "ALTER TABLE branches ADD COLUMN IF NOT EXISTS independent_invoice_numbering boolean NOT NULL DEFAULT FALSE",
        """CREATE TABLE IF NOT EXISTS branch_invoice_counters (
             company_id   uuid NOT NULL,
             branch_id    uuid NOT NULL,
             last_number  bigint NOT NULL DEFAULT 0,
             PRIMARY KEY (company_id, branch_id)
           )""",

        # ── المرحلة 7: حسابات بنكية حقيقية + إيداع/سحب بين الصندوق والبنك + تسوية بنكية ──
        """CREATE TABLE IF NOT EXISTS bank_accounts (
             id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
             company_id uuid NOT NULL,
             name text NOT NULL,
             bank_name text,
             account_number text,
             iban text,
             account_code text NOT NULL,
             opening_balance numeric(14,2) NOT NULL DEFAULT 0,
             is_active boolean NOT NULL DEFAULT TRUE,
             created_at timestamptz NOT NULL DEFAULT now()
           )""",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_accounts_code ON bank_accounts(company_id, account_code)",
        """CREATE TABLE IF NOT EXISTS bank_transactions (
             id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
             company_id uuid NOT NULL,
             bank_account_id uuid NOT NULL REFERENCES bank_accounts(id),
             txn_type text NOT NULL,
             amount numeric(14,2) NOT NULL,
             description text,
             reconciled boolean NOT NULL DEFAULT FALSE,
             reconciled_at timestamptz,
             created_by uuid,
             created_at timestamptz NOT NULL DEFAULT now()
           )""",
        "CREATE INDEX IF NOT EXISTS idx_bank_txn_account ON bank_transactions(bank_account_id)",
        """CREATE TABLE IF NOT EXISTS bank_statement_lines (
             id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
             company_id uuid NOT NULL,
             bank_account_id uuid NOT NULL REFERENCES bank_accounts(id),
             stmt_date date NOT NULL,
             amount numeric(14,2) NOT NULL,
             description text,
             matched_txn_id uuid REFERENCES bank_transactions(id),
             created_at timestamptz NOT NULL DEFAULT now()
           )""",
        "CREATE INDEX IF NOT EXISTS idx_bank_stmt_account ON bank_statement_lines(bank_account_id)",

        # ── المرحلة 8: محرك الإشعارات — مركز داخلي (راجع core/notify.py + modules/notifications) ──
        *NOTIFICATIONS_ENSURE_SQL,
        *TERMINAL_ENSURE_SQL,   # تصميم الإشعارات الحالي + ترقية الجدول القديم (recipient_user_id) إن وُجد

        # ── المرحلة 9: عهد الموظفين (مالية/عينية) ──
        """CREATE TABLE IF NOT EXISTS hr_custody_items (
             id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
             company_id uuid NOT NULL,
             employee_id uuid NOT NULL,
             item_name text NOT NULL,
             description text,
             estimated_value numeric(12,2) NOT NULL DEFAULT 0,
             assigned_date date NOT NULL DEFAULT CURRENT_DATE,
             returned_date date,
             status text NOT NULL DEFAULT 'held',
             notes text,
             created_by uuid,
             created_at timestamptz NOT NULL DEFAULT now()
           )""",
        "CREATE INDEX IF NOT EXISTS idx_hr_custody_employee ON hr_custody_items(company_id, employee_id)",

        # ── المرحلة 9: تعميم نظام الطلبات الإلكترونية (نقل فرع / مستلزمات / بلاغ عطل) ──
        """CREATE TABLE IF NOT EXISTS hr_employee_requests (
             id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
             company_id uuid NOT NULL,
             employee_id uuid NOT NULL,
             request_type text NOT NULL,
             title text,
             details jsonb NOT NULL DEFAULT '{}'::jsonb,
             status text NOT NULL DEFAULT 'pending',
             decided_by uuid,
             decided_at timestamptz,
             decision_note text,
             created_by uuid,
             created_at timestamptz NOT NULL DEFAULT now()
           )""",
        "CREATE INDEX IF NOT EXISTS idx_hr_requests_employee ON hr_employee_requests(company_id, employee_id)",
        "CREATE INDEX IF NOT EXISTS idx_hr_requests_status ON hr_employee_requests(company_id, status)",

        # ── المرحلة 10: سجل التكاملات الخارجية (واتساب، بوابة الدفع...) ──
        """CREATE TABLE IF NOT EXISTS integration_log (
             id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
             company_id uuid NOT NULL,
             provider text NOT NULL,
             event text NOT NULL,
             status text NOT NULL,
             detail text,
             created_at timestamptz NOT NULL DEFAULT now()
           )""",
        "CREATE INDEX IF NOT EXISTS idx_integration_log ON integration_log(company_id, created_at DESC)",

        # ── فهارس تسريع: الفواتير/نقاط البيع/الخدمة — جداول قديمة (عهد Node) من غير فهارس
        # على أعمدة البحث/الفرز الأساسية، وبيتصفحها الداشبورد ونقطة البيع كل ١٥-٣٠ ثانية ──
        "CREATE INDEX IF NOT EXISTS idx_invoices_company_issued ON invoices (company_id, issued_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_invoices_company_returned_issued ON invoices (company_id, is_returned, issued_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items (invoice_id)",
        "CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice ON invoice_payments (invoice_id)",
        "ALTER TABLE cars ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz",
        "CREATE INDEX IF NOT EXISTS idx_cars_company_active ON cars (company_id, is_deleted, exited_at)",
        "CREATE INDEX IF NOT EXISTS idx_cars_company_plate ON cars (company_id, plate)",
        "CREATE INDEX IF NOT EXISTS idx_customers_company ON customers (company_id)",
        # ── مركز قيادة العملاء: رقم عميل تسلسلي للعرض (CUS-000123) + ملاحظات العميل ──
        "ALTER TABLE customers ADD COLUMN IF NOT EXISTS customer_no BIGSERIAL",
        """CREATE TABLE IF NOT EXISTS customer_notes (
             id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
             company_id uuid NOT NULL,
             customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
             note text NOT NULL,
             created_by uuid,
             created_at timestamptz NOT NULL DEFAULT now())""",
        "CREATE INDEX IF NOT EXISTS idx_customer_notes_customer ON customer_notes (customer_id, created_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices (customer_id, issued_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_customer_ledger_customer ON customer_ledger (customer_id)",
        # أعمدة يقرؤها كود الموارد البشرية لكن لم تكن مُعرَّفة في تحصين المخطط (موجودة في الإنتاج) — حتى تعمل القواعد الجديدة
        "ALTER TABLE hr_employees ADD COLUMN IF NOT EXISTS allowances numeric(12,2) NOT NULL DEFAULT 0",
        "ALTER TABLE hr_employees ADD COLUMN IF NOT EXISTS approval_pin text",
        "ALTER TABLE hr_payslips ADD COLUMN IF NOT EXISTS allowances numeric(12,2) NOT NULL DEFAULT 0",
        "ALTER TABLE hr_leave_requests ADD COLUMN IF NOT EXISTS approved_at timestamptz",
        "ALTER TABLE hr_payslips ADD COLUMN IF NOT EXISTS other_deductions numeric(12,2) NOT NULL DEFAULT 0",
        # ══ الموارد البشرية السعودية: الأقسام والوظائف والعقود والمستندات والدوام (إضافات فقط — لا حذف ولا إعادة تسمية) ══
        """CREATE TABLE IF NOT EXISTS hr_departments (
             id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
             company_id uuid NOT NULL,
             name text NOT NULL,
             is_active boolean NOT NULL DEFAULT TRUE,
             created_at timestamptz NOT NULL DEFAULT now(),
             UNIQUE (company_id, name))""",
        """CREATE TABLE IF NOT EXISTS hr_positions (
             id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
             company_id uuid NOT NULL,
             name text NOT NULL,
             department_id uuid,
             is_active boolean NOT NULL DEFAULT TRUE,
             created_at timestamptz NOT NULL DEFAULT now(),
             UNIQUE (company_id, name))""",
        """CREATE TABLE IF NOT EXISTS hr_work_schedules (
             id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
             company_id uuid NOT NULL,
             name text NOT NULL,
             start_time time NOT NULL,
             end_time time NOT NULL,
             grace_minutes int NOT NULL DEFAULT 0,
             weekly_off int[] NOT NULL DEFAULT '{5}',
             is_active boolean NOT NULL DEFAULT TRUE,
             created_at timestamptz NOT NULL DEFAULT now(),
             UNIQUE (company_id, name))""",
        "ALTER TABLE hr_employees ADD COLUMN IF NOT EXISTS department_id uuid",
        "ALTER TABLE hr_employees ADD COLUMN IF NOT EXISTS position_id uuid",
        "ALTER TABLE hr_employees ADD COLUMN IF NOT EXISTS manager_id uuid",
        "ALTER TABLE hr_employees ADD COLUMN IF NOT EXISTS schedule_id uuid",
        "ALTER TABLE hr_employees ADD COLUMN IF NOT EXISTS gender text",
        "ALTER TABLE hr_employees ADD COLUMN IF NOT EXISTS email text",
        "ALTER TABLE hr_employees ADD COLUMN IF NOT EXISTS address text",
        "ALTER TABLE hr_employees ADD COLUMN IF NOT EXISTS gosi_number text",
        "ALTER TABLE hr_employees ADD COLUMN IF NOT EXISTS gosi_status text",
        "ALTER TABLE hr_employees ADD COLUMN IF NOT EXISTS housing_allowance numeric(12,2) NOT NULL DEFAULT 0",
        "ALTER TABLE hr_employees ADD COLUMN IF NOT EXISTS transport_allowance numeric(12,2) NOT NULL DEFAULT 0",
        "ALTER TABLE hr_employees ADD COLUMN IF NOT EXISTS other_allowance numeric(12,2) NOT NULL DEFAULT 0",
        """CREATE TABLE IF NOT EXISTS hr_contracts (
             id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
             company_id uuid NOT NULL,
             employee_id uuid NOT NULL,
             contract_type text NOT NULL DEFAULT 'full_time',
             start_date date NOT NULL,
             end_date date,
             basic_salary numeric(12,2) NOT NULL DEFAULT 0,
             status text NOT NULL DEFAULT 'active',
             notes text,
             created_by uuid,
             created_at timestamptz NOT NULL DEFAULT now())""",
        "CREATE INDEX IF NOT EXISTS idx_hr_contracts_emp ON hr_contracts (company_id, employee_id)",
        """CREATE TABLE IF NOT EXISTS hr_documents (
             id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
             company_id uuid NOT NULL,
             employee_id uuid NOT NULL,
             doc_type text NOT NULL,
             doc_number text,
             issue_date date,
             expiry_date date,
             notes text,
             created_by uuid,
             created_at timestamptz NOT NULL DEFAULT now())""",
        "CREATE INDEX IF NOT EXISTS idx_hr_documents_emp ON hr_documents (company_id, employee_id)",
        """CREATE TABLE IF NOT EXISTS hr_leave_types (
             id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
             company_id uuid NOT NULL,
             code text NOT NULL,
             name text NOT NULL,
             annual_days int,
             is_paid boolean NOT NULL DEFAULT TRUE,
             is_active boolean NOT NULL DEFAULT TRUE,
             UNIQUE (company_id, code))""",
        """CREATE TABLE IF NOT EXISTS hr_employee_history (
             id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
             company_id uuid NOT NULL,
             employee_id uuid NOT NULL,
             event_type text NOT NULL,
             detail jsonb NOT NULL DEFAULT '{}'::jsonb,
             reason text,
             actor_id text,
             actor_name text,
             created_at timestamptz NOT NULL DEFAULT now())""",
        "CREATE INDEX IF NOT EXISTS idx_hr_history_emp ON hr_employee_history (company_id, employee_id, created_at DESC)",
        # إعدادات قابلة للضبط — القيم الافتراضية = السلوك الحالي بالضبط (لا تغيير على من لم يضبط شيئاً)
        "ALTER TABLE companies ADD COLUMN IF NOT EXISTS eos_first_years_months numeric(5,2) NOT NULL DEFAULT 0.5",
        "ALTER TABLE companies ADD COLUMN IF NOT EXISTS eos_after_months numeric(5,2) NOT NULL DEFAULT 1",
        "ALTER TABLE companies ADD COLUMN IF NOT EXISTS eos_threshold_years numeric(5,2) NOT NULL DEFAULT 5",
        "ALTER TABLE companies ADD COLUMN IF NOT EXISTS leave_days_before int NOT NULL DEFAULT 21",
        "ALTER TABLE companies ADD COLUMN IF NOT EXISTS leave_days_after int NOT NULL DEFAULT 30",
        "ALTER TABLE companies ADD COLUMN IF NOT EXISTS leave_threshold_years numeric(5,2) NOT NULL DEFAULT 5",
        "ALTER TABLE companies ADD COLUMN IF NOT EXISTS gosi_basis text NOT NULL DEFAULT 'basic'",
        # صلاحيات الخصوصية الجديدة: منحة لمرة واحدة فقط (علامة في company_settings) لمن يملك hr.manage أو hr.payroll
        # حتى لا يتغيّر شيء على من يعمل اليوم — وبعدها لا يُعاد منحها لو سحبها المدير عمداً.
        """WITH m AS (
             INSERT INTO company_settings (company_id, key, value)
             SELECT id, 'hr_privacy_v1_users', '1' FROM companies
             ON CONFLICT DO NOTHING RETURNING company_id)
           UPDATE users SET permissions = permissions || '["hr.salary.view","hr.identity.view"]'::jsonb
           WHERE company_id IN (SELECT company_id FROM m)
             AND jsonb_typeof(permissions)='array'
             AND (permissions ? 'hr.manage' OR permissions ? 'hr.payroll')""",
        """WITH m AS (
             INSERT INTO company_settings (company_id, key, value)
             SELECT id, 'hr_privacy_v1_roles', '1' FROM companies
             ON CONFLICT DO NOTHING RETURNING company_id)
           UPDATE roles SET permissions = permissions || '["hr.salary.view","hr.identity.view"]'::jsonb
           WHERE company_id IN (SELECT company_id FROM m)
             AND jsonb_typeof(permissions)='array'
             AND (permissions ? 'hr.manage' OR permissions ? 'hr.payroll')""",
    ):
        try:
            await execute(stmt)
        except Exception as e:
            print(f"⚠ ensure-schema: {e}")
    import asyncio as _aio0
    _sup_task = _aio0.create_task(_auto_supervisor())
    from .modules.shortage_sync.firestore_relay import start_relay_loop as _start_relay_loop
    _relay_task = _aio0.create_task(_start_relay_loop())
    from .modules.cars.booking_notify import reminder_loop as _reminder_loop
    _remind_task = _aio0.create_task(_reminder_loop())
    yield
    _sup_task.cancel()
    _relay_task.cancel()
    _remind_task.cancel()
    await close_pool()

app = FastAPI(
    title="Z8 Platform API",
    description="منصة مصدر الزيوت — معمارية موديولات (FastAPI + PostgreSQL)",
    version="1.0.0-phase5",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.CORS_ORIGINS.split(",")],
    allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
)

# رسائل الأخطاء للواجهة بصيغة {error: "..."} — نفس عقد النظام القديم
from fastapi.exceptions import HTTPException as FastAPIHTTPException
@app.exception_handler(FastAPIHTTPException)
async def http_error_handler(request: Request, exc: FastAPIHTTPException):
    return JSONResponse(status_code=exc.status_code, content={"error": exc.detail})

# أي خطأ غير متوقع (مش HTTPException) — بيفضح سببه الحقيقي في الرد بدل "500" غامضة،
# ويطبعه كمان في نافذة الباك اند عشان يبان في اللوج
@app.exception_handler(Exception)
async def unexpected_error_handler(request: Request, exc: Exception):
    import traceback
    traceback.print_exc()
    return JSONResponse(status_code=500, content={"error": f"{type(exc).__name__}: {exc}"})

@app.get("/api/health")
async def health():
    return {"status": "ok", "platform": "Z8", "phase": 5, "build": "gate-v3"}

# 🧩 تركيب كل الموديولات الموجودة في app/modules تلقائياً
LOADED_MODULES = module_loader.load_modules(app, modules_pkg)

@app.get("/api/modules")
async def list_modules():
    """قائمة الموديولات المركّبة — القائمة الجانبية بالواجهة ممكن تتبني منها"""
    return [{"name": m.name, "title": m.title, "prefix": m.prefix,
             "icon": m.icon, "navPermissions": m.nav_permissions}
            for m in LOADED_MODULES]



# ── منع تكرار اللوحة: خرق القيد الفريد يتحول لرسالة واضحة بدل 500 ──
import asyncpg as _asyncpg
from fastapi import HTTPException as _HTTPException
from fastapi.exception_handlers import http_exception_handler as _http_exc_handler

_UNIQUE_MSGS = {
    "uq_cars_active_plate": "السيارة دي مسجلة بالفعل في الدور ولسه ماخرجتش",
    "uq_customer_cars_cust_platekey": "اللوحة دي مسجلة عندك بالفعل",
    "uq_customer_cars_cust_plate": "اللوحة دي مسجلة عندك بالفعل",
    "customer_cars_customer_id_plate_key": "اللوحة دي مسجلة عندك بالفعل",
}


@app.exception_handler(_asyncpg.UniqueViolationError)
async def z8_unique_violation_handler(request, exc):
    msg = _UNIQUE_MSGS.get(getattr(exc, "constraint_name", None))
    if not msg:
        raise exc
    return await _http_exc_handler(request, _HTTPException(409, msg))

