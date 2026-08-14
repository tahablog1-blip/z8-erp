"""
Z8 - البوابة الذكية | خريطة الجداول والاستعلامات
================================================
>>> كل أسماء الجداول والأعمدة في هذا الملف فقط <<<
لو أسماء عندك مختلفة، عدّل هنا وبس. باقي الموديول مش هيتأثر.

بعد التعديل شغّل:  GET /api/auto-checkin/schema-check
هيقولك بالظبط أي اسم غلط.
"""

# ---------------------------------------------------------------------------
# 1) خريطة الأسماء  — عدّل هنا لو محتاج
# ---------------------------------------------------------------------------
TABLES = {
    "cars":          "cars",
    "customers":     "customers",
    "invoices":      "invoices",
    "invoice_items": "invoice_items",
    "products":      "products",
    "queue":         "car_service_queue",   # طابور الخدمة
    "branches":      "branches",
}

COLUMNS = {
    # جدول السيارات
    "car_id":            "id",
    "car_plate":         "plate_number",
    "car_plate_norm":    "plate_normalized",   # عمود جديد (من ملف الـ SQL)
    "car_plate_loose":   "plate_loose",        # عمود جديد
    "car_customer_id":   "customer_id",
    "car_brand":         "brand",
    "car_model":         "model",
    "car_year":          "year",
    "car_color":         "color",
    "car_vin":           "vin",
    "car_odometer":      "last_odometer",
    "car_branch_id":     "branch_id",
    "car_is_active":     "is_active",

    # جدول العملاء
    "cust_id":           "id",
    "cust_name":         "name",
    "cust_phone":        "phone",
    "cust_vat":          "vat_number",
    "cust_notes":        "notes",
    "cust_balance":      "balance",

    # جدول الفواتير
    "inv_id":            "id",
    "inv_number":        "invoice_number",
    "inv_customer_id":   "customer_id",
    "inv_car_id":        "car_id",
    "inv_branch_id":     "branch_id",
    "inv_date":          "created_at",
    "inv_total":         "total",
    "inv_status":        "status",
    "inv_odometer":      "odometer",

    # بنود الفاتورة
    "item_id":           "id",
    "item_invoice_id":   "invoice_id",
    "item_product_id":   "product_id",
    "item_name":         "product_name",
    "item_qty":          "quantity",
    "item_price":        "unit_price",
    "item_discount":     "discount",
    "item_total":        "total",

    # المنتجات
    "prod_id":           "id",
    "prod_name":         "name",
    "prod_sku":          "sku",
    "prod_price":        "sale_price",
    "prod_is_service":   "is_service",
    "prod_is_active":    "is_active",

    # طابور الخدمة
    "q_id":              "id",
    "q_car_id":          "car_id",
    "q_customer_id":     "customer_id",
    "q_branch_id":       "branch_id",
    "q_status":          "status",
    "q_station":         "station",
    "q_entry_time":      "entry_time",
    "q_odometer":        "odometer",
    "q_notes":           "notes",
}

# الحالات التي تعتبر "السيارة لسه جوه المركز"
QUEUE_OPEN_STATUSES = ("waiting", "in_service", "pending", "active")

# حالات الفاتورة المكتملة (لسحب آخر خدمة)
INVOICE_DONE_STATUSES = ("completed", "paid", "posted", "issued")

T = TABLES
C = COLUMNS


# ---------------------------------------------------------------------------
# 2) الاستعلامات
# ---------------------------------------------------------------------------

# البحث بالمفتاح الموحّد الأساسي (مطابقة 100%)
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
        cu.{C['cust_balance']}     AS customer_balance
FROM {T['cars']} c
LEFT JOIN {T['customers']} cu ON cu.{C['cust_id']} = c.{C['car_customer_id']}
WHERE c.{C['car_plate_norm']} = $1
LIMIT 1
"""

# البحث المتساهل (نفس الأرقام + نفس الحروف بترتيب مختلف)
Q_FIND_CAR_LOOSE = Q_FIND_CAR_EXACT.replace(
    f"WHERE c.{C['car_plate_norm']} = $1",
    f"WHERE c.{C['car_plate_loose']} = $1",
)

# مرشحون بنفس الأرقام فقط (للحالات الضعيفة — يعرضهم للموظف ليختار)
Q_FIND_CANDIDATES = Q_FIND_CAR_EXACT.replace(
    f"WHERE c.{C['car_plate_norm']} = $1\nLIMIT 1",
    f"WHERE c.{C['car_plate_norm']} LIKE $1 || '-%'\nLIMIT 5",
)

# هل السيارة داخلة بالفعل ولسه ما خرجتش؟
_open = ", ".join(f"'{s}'" for s in QUEUE_OPEN_STATUSES)
Q_OPEN_QUEUE_FOR_CAR = f"""
SELECT {C['q_id']} AS id, {C['q_status']} AS status, {C['q_entry_time']} AS entry_time
FROM {T['queue']}
WHERE {C['q_car_id']} = $1
  AND {C['q_status']} IN ({_open})
ORDER BY {C['q_entry_time']} DESC
LIMIT 1
"""

# آخر فاتورة مكتملة لنفس السيارة
_done = ", ".join(f"'{s}'" for s in INVOICE_DONE_STATUSES)
Q_LAST_INVOICE_BY_CAR = f"""
SELECT {C['inv_id']}       AS id,
       {C['inv_number']}   AS invoice_number,
       {C['inv_date']}     AS invoice_date,
       {C['inv_total']}    AS total,
       {C['inv_odometer']} AS odometer
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
       {C['inv_odometer']} AS odometer,
       {C['inv_total']}    AS total
FROM {T['invoices']}
WHERE {C['inv_car_id']} = $1
  AND {C['inv_status']} IN ({_done})
ORDER BY {C['inv_date']} DESC
LIMIT 6
"""

# تسجيل الدخول التلقائي في الطابور
Q_INSERT_QUEUE = f"""
INSERT INTO {T['queue']} (
    {C['q_car_id']}, {C['q_customer_id']}, {C['q_branch_id']},
    {C['q_status']}, {C['q_station']}, {C['q_entry_time']},
    {C['q_odometer']}, {C['q_notes']}
) VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7)
RETURNING {C['q_id']} AS id, {C['q_entry_time']} AS entry_time
"""

# تحديث عداد السيارة
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
SELECT id, branch_id, name, rtsp_url, direction, is_active, capture_interval_sec
FROM gate_cameras WHERE is_active = true
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
                C["car_customer_id"], C["car_odometer"]],
    T["customers"]: [C["cust_id"], C["cust_name"], C["cust_phone"]],
    T["invoices"]: [C["inv_id"], C["inv_car_id"], C["inv_customer_id"],
                    C["inv_date"], C["inv_status"], C["inv_total"]],
    T["invoice_items"]: [C["item_invoice_id"], C["item_product_id"],
                         C["item_qty"], C["item_price"]],
    T["products"]: [C["prod_id"], C["prod_name"], C["prod_price"]],
    T["queue"]: [C["q_id"], C["q_car_id"], C["q_status"], C["q_entry_time"]],
    "plate_scans": ["id", "plate_normalized", "status"],
}
