# app/main.py — نقطة الإقلاع: تجميع المحرك + تركيب الموديولات آلياً
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from .core.config import settings
from .core.db import init_pool, close_pool
from .core import module_loader
from . import modules as modules_pkg


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
        # ════════ أعمدة customers اللي بيكتب فيها التسجيل والحجز ════════
        "ALTER TABLE customers ADD COLUMN IF NOT EXISTS customer_type text NOT NULL DEFAULT 'individual'",
        "ALTER TABLE customers ADD COLUMN IF NOT EXISTS vat_number text",
        "ALTER TABLE customers ADD COLUMN IF NOT EXISTS cr_number text",
        "ALTER TABLE customers ADD COLUMN IF NOT EXISTS address text",
        # ════════ الترقيات الأصلية ════════
        "ALTER TABLE cars ADD COLUMN IF NOT EXISTS checklist jsonb NOT NULL DEFAULT '[]'::jsonb",
        "ALTER TABLE companies ADD COLUMN IF NOT EXISTS phone text",
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
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS original_name text",
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
    ):
        try:
            await execute(stmt)
        except Exception as e:
            print(f"⚠ ensure-schema: {e}")
    import asyncio as _aio0
    _sup_task = _aio0.create_task(_auto_supervisor())
    yield
    _sup_task.cancel()
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

