"""
Z8 - البوابة الذكية | خريطة الجداول والاستعلامات
================================================
مُعدّل ليطابق جداول Z8 الفعلية بالحرف (cars / customers / invoices / invoice_items / products)
"""

# ---------------------------------------------------------------------------
# 1) خريطة الأسماء
# ---------------------------------------------------------------------------
TABLES = {
    "cars":          "cars",
    "customers":     "customers",
    "invoices":      "invoices",
    "invoice_items": "invoice_items",
    "products":      "products",
}

COLUMNS = {
    # جدول السيارات — ملف السيارة الدائم + الزيارة الحالية في نفس الصف
    "car_id":            "id",
    "car_plate":         "plate",
    "car_plate_norm":    "plate_normalized",
    "car_plate_loose":   "plate_loose",
    "car_customer_id":   "customer_id",
    "car_brand":         "brand",
    "car_model":         "name",
    "car_year":          "model_year",
    "car_color":         "color",
    "car_vin":           "chassis_number",
    "car_odometer":      "odometer_current",
    "car_branch_id":     "branch_id",
    "car_company_id":    "company_id",
    "car_station":       "station",
    "car_entered_at":    "entered_at",
    "car_exited_at":     "exited_at",
    "car_work_status":   "work_status",
    "car_customer_name": "customer_name",
    "car_customer_phone":"customer_phone",
    "car_plate_type":    "plate_type",
    "car_category":      "car_category",
    "car_cylinders":     "cylinders",
    "car_created_by":    "created_by",

    # جدول العملاء
    "cust_id":           "id",
    "cust_name":         "name",
    "cust_phone":        "phone",
    "cust_vat":          "vat_number",
    "cust_notes":        "address",
    "cust_balance":      "id",   # لا يوجد عمود رصيد مباشر — غير مستخدم فعلياً

    # جدول الفواتير
    "inv_id":            "id",
    "inv_number":        "invoice_no",
    "inv_customer_id":   "customer_id",
    "inv_car_id":        "car_id",
    "inv_branch_id":     "branch_id",
    "inv_date":          "issued_at",
    "inv_total":         "total_inc",
    "inv_status":        "payment_status",
    "inv_odometer":      "next_service_km",

    # بنود الفاتورة
    "item_id":           "id",
    "item_invoice_id":   "invoice_id",
    "item_product_id":   "product_id",
    "item_name":         "label",
    "item_qty":          "qty",
    "item_price":        "unit_price_vat",
    "item_discount":     "discount_amount",
    "item_total":        "line_inc",

    # المنتجات
    "prod_id":           "id",
    "prod_name":         "name",
    "prod_sku":          "barcode",
    "prod_price":        "price_vat",
    "prod_is_service":   "is_service",
    "prod_is_active":    "is_active",
}

# حالات الفاتورة المكتملة (لسحب آخر خدمة) — عمود payment_status الفعلي
INVOICE_DONE_STATUSES = ("paid", "partial")

T = TABLES
C = COLUMNS


# ---------------------------------------------------------------------------
# 2) الاستعلامات
# ---------------------------------------------------------------------------

# البحث بالمفتاح الموحّد الأساسي (مطابقة 100%) — آخر زيارة لهذه اللوحة
Q_FIND_CAR_EXACT = f"""
SELECT  c.{C['car_id']}            AS car_id,
        c.{C['car_plate']}         AS plate_number,
        c.{C['car_plate_norm']}    AS plate_normalized,
        c.{C['car_brand']}         AS brand,
        c.{C['car_model']}         AS model,
        c.{C['car_year']}          AS year,
        c.{C['car_color']}         AS color,
        c.{C['car_vin']}           AS vin,
        c.{C['car_odometer']}      AS last_odometer,
        c.{C['car_customer_id']}   AS customer_id,
        cu.{C['cust_name']}        AS customer_name,
        cu.{C['cust_phone']}       AS customer_phone,
        cu.{C['cust_vat']}         AS customer_vat,
        NULL::numeric              AS customer_balance
FROM {T['cars']} c
LEFT JOIN {T['customers']} cu ON cu.{C['cust_id']} = c.{C['car_customer_id']}
WHERE c.{C['car_plate_norm']} = $1
ORDER BY c.{C['car_entered_at']} DESC NULLS LAST
LIMIT 1
"""

# البحث المتساهل (نفس الحروف بترتيب مختلف)
Q_FIND_CAR_LOOSE = Q_FIND_CAR_EXACT.replace(
    f"WHERE c.{C['car_plate_norm']} = $1",
    f"WHERE c.{C['car_plate_loose']} = $1",
)

# مرشحون بنفس الأرقام فقط (للحالات الضعيفة — يعرضهم للموظف ليختار)
# البحث بالأرقام من العمودين: التطبيع (لو موجود) أو الأرقام من اللوحة الأصلية
# — السيارات المسجلة يدوياً (بلا تطبيع) تصبح مرئية للمطابقة
Q_FIND_CANDIDATES = Q_FIND_CAR_EXACT.replace(
    f"WHERE c.{C['car_plate_norm']} = $1\nORDER BY c.{C['car_entered_at']} DESC NULLS LAST\nLIMIT 1",
    "WHERE (split_part(COALESCE(c." + C['car_plate_norm'] + ",''), '-', 1) = $1\n"
    "       OR regexp_replace(COALESCE(c." + C['car_plate'] + ",''), '[^0-9]', '', 'g') = $1)\n"
    f"ORDER BY c.{C['car_entered_at']} DESC NULLS LAST\nLIMIT 8",
)

# مرشحون من طابور الفرع المفتوح فقط (لم تخرج بعد) — نطاق آمن وصغير
# للمطابقة التقريبية عند فشل المطابقة الدقيقة (مثال: القارئ أسقط رقماً)
Q_OPEN_QUEUE_PLATES = Q_FIND_CAR_EXACT.replace(
    f"WHERE c.{C['car_plate_norm']} = $1\nORDER BY c.{C['car_entered_at']} DESC NULLS LAST\nLIMIT 1",
    f"WHERE c.{C['car_branch_id']} = $1 AND c.{C['car_exited_at']} IS NULL\n"
    f"ORDER BY c.{C['car_entered_at']} DESC NULLS LAST\nLIMIT 60",
)

# هل السيارة داخلة بالفعل ولسه ما خرجتش؟ (صف مفتوح = exited_at فاضي)
Q_OPEN_QUEUE_FOR_CAR = f"""
SELECT {C['car_id']} AS id, {C['car_work_status']} AS status, {C['car_entered_at']} AS entry_time
FROM {T['cars']}
WHERE {C['car_plate_norm']} = $1
  AND {C['car_branch_id']} = $2
  AND {C['car_exited_at']} IS NULL
ORDER BY {C['car_entered_at']} DESC NULLS LAST
LIMIT 1
"""

# جلب company_id للفرع (مطلوب لإدراج صف السيارة الجديد)
Q_BRANCH_COMPANY = "SELECT company_id FROM branches WHERE id = $1"

# آخر فاتورة مكتملة لنفس السيارة
_done = ", ".join(f"'{s}'" for s in INVOICE_DONE_STATUSES)
Q_LAST_INVOICE_BY_CAR = f"""
SELECT {C['inv_id']}       AS id,
       {C['inv_number']}   AS invoice_number,
       {C['inv_date']}     AS invoice_date,
       {C['inv_total']}    AS total,
       NULL::int           AS odometer
FROM {T['invoices']}
WHERE {C['inv_car_id']} = $1
  AND {C['inv_status']} IN ({_done})
ORDER BY {C['inv_date']} DESC
LIMIT 1
"""

# احتياطي: آخر فاتورة للعميل لو السيارة جديدة عليه
Q_LAST_INVOICE_BY_CUSTOMER = Q_LAST_INVOICE_BY_CAR.replace(
    f"WHERE {C['inv_car_id']} = $1",
    f"WHERE {C['inv_customer_id']} = $1",
)

# بنود آخر فاتورة + السعر الحالي للصنف
Q_INVOICE_ITEMS = f"""
SELECT  i.{C['item_product_id']} AS product_id,
        COALESCE(p.{C['prod_name']}, i.{C['item_name']}) AS product_name,
        p.{C['prod_sku']}        AS sku,
        i.{C['item_qty']}        AS quantity,
        i.{C['item_price']}      AS old_price,
        p.{C['prod_price']}      AS current_price,
        i.{C['item_discount']}   AS discount,
        COALESCE(p.{C['prod_is_service']}, false) AS is_service,
        COALESCE(p.{C['prod_is_active']}, true)   AS is_active
FROM {T['invoice_items']} i
LEFT JOIN {T['products']} p ON p.{C['prod_id']} = i.{C['item_product_id']}
WHERE i.{C['item_invoice_id']} = $1
ORDER BY i.{C['item_id']}
"""

# تاريخ الزيارات (لحساب معدل الاستهلاك وموعد التغيير القادم)
Q_VISIT_HISTORY = f"""
SELECT {C['inv_date']}     AS invoice_date,
       NULL::int           AS odometer,
       {C['inv_total']}    AS total
FROM {T['invoices']}
WHERE {C['inv_car_id']} = $1
  AND {C['inv_status']} IN ({_done})
ORDER BY {C['inv_date']} DESC
LIMIT 6
"""

# ═══════════════════════════════════════════════════════════════════════
# تسجيل الدخول التلقائي — صف سيارة جديد في cars (نفس منطق خط الخدمة بالحرف)
# البيانات (ماركة/موديل/لون/هيكل) تُنسخ من آخر زيارة لنفس اللوحة إن وُجدت
# ═══════════════════════════════════════════════════════════════════════
Q_INSERT_QUEUE = f"""
INSERT INTO {T['cars']} (
    {C['car_company_id']}, {C['car_branch_id']}, {C['car_plate']},
    {C['car_plate_type']}, {C['car_plate_norm']}, {C['car_plate_loose']},
    {C['car_customer_id']}, {C['car_customer_name']}, {C['car_customer_phone']},
    {C['car_brand']}, {C['car_model']}, {C['car_year']}, {C['car_color']},
    {C['car_vin']}, {C['car_odometer']},
    {C['car_station']}, {C['car_entered_at']}, {C['car_work_status']}
) VALUES (
    $1, $2, $3, 'saudi', $4, $5,
    $6, $7, $8,
    $9, $10, $11, $12,
    $13, $14,
    $15, NOW(), 'queued'
)
RETURNING {C['car_id']} AS id, {C['car_entered_at']} AS entry_time
"""

# تحديث عداد السيارة (لو الموديول احتاجها لاحقاً على صف موجود)
Q_UPDATE_CAR_ODOMETER = f"""
UPDATE {T['cars']} SET {C['car_odometer']} = $2 WHERE {C['car_id']} = $1
"""


# ---------------------------------------------------------------------------
# 3) جداول البوابة الذكية (خاصة بالموديول — لا تحتاج تعديل)
# ---------------------------------------------------------------------------

Q_INSERT_SCAN = """
INSERT INTO plate_scans (
    branch_id, camera_id, plate_raw, plate_normalized, plate_loose,
    plate_display_ar, confidence, match_mode, status,
    matched_car_id, matched_customer_id, queue_id, image_path, vision_model, raw_response
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
RETURNING id, created_at
"""

Q_RECENT_DUPLICATE = """
SELECT id, created_at, status, matched_car_id
FROM plate_scans
WHERE plate_normalized = $1
  AND branch_id = $2
  AND created_at > NOW() - ($3 || ' minutes')::interval
  AND status IN ('matched','checked_in')
ORDER BY created_at DESC
LIMIT 1
"""

Q_RECENT_SCANS = """
SELECT id, plate_display_ar, plate_normalized, confidence, status,
       match_mode, matched_car_id, matched_customer_id, queue_id, created_at
FROM plate_scans
WHERE branch_id = $1
ORDER BY created_at DESC
LIMIT $2
"""

Q_UPDATE_SCAN_STATUS = """
UPDATE plate_scans
SET status = $2, matched_car_id = $3, matched_customer_id = $4, queue_id = $5
WHERE id = $1
RETURNING id
"""

Q_GET_SCAN = "SELECT * FROM plate_scans WHERE id = $1"

Q_GET_CAMERAS = """
SELECT id, branch_id, name, rtsp_url, station AS direction, is_active,
       5 AS capture_interval_sec
FROM station_cameras WHERE is_active = true
"""


# ---------------------------------------------------------------------------
# 4) فحص المخطط
# ---------------------------------------------------------------------------
Q_SCHEMA_CHECK = """
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = ANY($1::text[])
"""

# الأعمدة المطلوبة لكل جدول (للفحص)
REQUIRED = {
    T["cars"]: [C["car_id"], C["car_plate"], C["car_plate_norm"], C["car_plate_loose"],
                C["car_customer_id"], C["car_odometer"], C["car_station"],
                C["car_entered_at"], C["car_work_status"]],
    T["customers"]: [C["cust_id"], C["cust_name"], C["cust_phone"]],
    T["invoices"]: [C["inv_id"], C["inv_car_id"], C["inv_customer_id"],
                    C["inv_date"], C["inv_status"], C["inv_total"]],
    T["invoice_items"]: [C["item_invoice_id"], C["item_product_id"],
                         C["item_qty"], C["item_price"]],
    T["products"]: [C["prod_id"], C["prod_name"], C["prod_price"]],
    "plate_scans": ["id", "plate_normalized", "status"],
}
