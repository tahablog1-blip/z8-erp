# Z8 Platform — منصة ERP بمعمارية الموديولات
> Python (FastAPI) + JavaScript (Next.js) + PostgreSQL — المرحلة 2 (الأصناف والمخزون)

## ⚡ التشغيل بضغطة واحدة (الطريقة المعتمدة)
- دبل كليك على **`START-Z8.bat`** في جذر المشروع → بيفتح الباك اند والفرونت اند والمتصفح تلقائياً
- لو أي مشكلة: دبل كليك على **`check-z8.bat`** → بيفحص البروكسي والباك اند وسلسلة تسجيل الدخول كاملة ويطبع النتيجة
- افتح النظام دايماً من `http://localhost:3000` — ولو حبيت تفتح من جهاز تاني على الشبكة استخدم `http://192.168.8.49:3000` (مسموح بيه في الإعدادات)

## البنية
```
z8-platform/
├── backend/          FastAPI — كل قسم موديول مستقل في app/modules/
│   └── app/
│       ├── core/     المحرك المشترك: auth، صلاحيات، قاعدة، تدقيق، محاسبة، محمّل الموديولات
│       └── modules/  auth/ ، branches/ (النموذج الذهبي) ، products/ ، inventory/
└── frontend/         Next.js + TypeScript — نفس هوية Z8 البصرية
```

## التشغيل بدون Docker (الأسرع للتجربة الأولى — على قاعدتك الحالية)
```bash
# 1) الباك اند
cd backend
python -m venv venv && venv\Scripts\activate     # ويندوز
pip install -r requirements.txt
copy .env.example .env                            # راجع القيم (متظبطة على قاعدتك)
uvicorn app.main:app --reload --port 4001

# 2) الفرونت اند (نافذة تانية)
cd frontend
npm install
npm run dev
```
- الواجهة: http://localhost:3000 — سجّل دخول بنفس حسابك الحالي (admin@z8.com)
- توثيق API تلقائي: http://localhost:4001/docs

## التشغيل بـ Docker
```bash
docker compose up --build
```

## ليه بيشتغل على بياناتك فوراً بدون أي ترحيل؟
- نفس قاعدة PostgreSQL (z8_car_manager) — مفيش نسخ بيانات
- نفس JWT secret ونفس بنية التوكن → توكنات النظام القديم شغالة هنا والعكس
- نفس bcrypt hashes → كل الموظفين بكلمات مرورهم الحالية
- asyncpg بيستخدم نفس صيغة $1,$2 → استعلامات Node تتنقل بالحرف

## إضافة موديول جديد (وصفة النسخ من branches)
1. انسخ مجلد `app/modules/branches` باسم الموديول الجديد
2. عدّل `module.py` (الاسم، المسار، عناصر القائمة الجانبية بصلاحياتها)
3. اكتب models/schemas/service/api — المحمّل بيكتشفه ويركّبه تلقائياً
4. أضف شاشته في `frontend/src/app/(app)/<module>/` وسجّله في `modules/registry.ts`

---

## المرحلة 2 — موديول الأصناف والمخزون

### إيه اللي اتضاف
| الموديول | المسار | الشاشة |
|---|---|---|
| `products` | `/api/products` | `/products` — كتالوج الأصناف |
| `inventory` | `/api/inventory` | `/inventory` — الأرصدة والسندات والحركات |

وموديول واحد جديد في النواة: `core/accounting.py` (منقول من `accounting.service.js`) —
أي موديول جاي محتاج قيد يومية تلقائي بيستخدمه.

### ليه موديولين مش واحد؟
الأصناف كتالوج (تعريف وسعر)، والمخزون دفتر كميات (رصيد كل صنف في كل موقع).
الفصل بيخلي كل واحد يحتفظ بمسار الـ API بتاعه زي النظام القديم بالحرف
(`/api/products` و `/api/inventory`) — فأي واجهة قديمة تفضل شغالة من غير أي تعديل.

### الـ Endpoints
```
GET    /api/products?search=            قائمة الأصناف (مفتوح للمسجّلين — نقطة البيع محتاجاه)
GET    /api/products/barcode/{code}     بحث بالباركود
GET    /api/products/cascade/categories الفئات
GET    /api/products/cascade/names      الأسماء داخل فئة
GET    /api/products/cascade/specs      اللزوجات بأسعارها
POST   /api/products                    إنشاء صنف            [products.create]
PUT    /api/products/{id}               تعديل صنف            [products.edit]
DELETE /api/products/{id}               حذف ناعم             [products.delete]

GET    /api/inventory/levels            أرصدة كل المواقع      [products.view_stock]
GET    /api/inventory/qty               رصيد صنف في موقع (مفتوح — نقطة البيع)
GET    /api/inventory/suppliers         أسماء الموردين السابقة
GET    /api/inventory/moves?limit=      سجل الحركات           [products.view_stock]
GET    /api/inventory/vouchers          السندات مجمّعة        [products.view_stock]
GET    /api/inventory/vouchers/{no}     تفاصيل سند            [products.view_stock]
POST   /api/inventory/receive           استلام من مورد        [purchasing.invoices | products.view_stock]
POST   /api/inventory/transfer          تحويل داخلي           [products.view_stock]
PUT    /api/inventory/vouchers/{no}     تعديل سند             [products.view_stock]
```

### حاجات مهمة تعرفها
- **مفيش أي migration جديد** — الموديولين شغالين على جداول `products` و`inventory`
  و`stock_moves` الموجودة أصلاً. لو القاعدة عندك متحدّثة لحد `migration-012` فأنت جاهز.
- **`price_vat` مش بيتحسب في الكود** — في القاعدة تريجر (`trg_products_price_vat`)
  بيحسبه من `price` ونسبة ضريبة الشركة. الحقل للقراءة فقط في الواجهة.
- **الاستلام بيسجّل قيد يومية تلقائي**: مدين المخزون (1030) / دائن الموردين (2020).
  لو شجرة الحسابات مش متسطّبة (`migration-005-accounting.sql`) الاستلام بيرجّع
  رسالة 400 واضحة بدل ما يفشل صامت.
- **التحويل بيقفل سطر الرصيد بـ `FOR UPDATE`** — سندين على نفس الصنف في نفس اللحظة
  ما يقدروش يوصّلوا الرصيد لسالب.
- **التعامل مع الأرقام**: asyncpg بيطلب `Decimal` لأعمدة NUMERIC (مش float) —
  كل التحويلات ماشية على `core/accounting.dec()` أو `Decimal(str(v))`.

### اختبار سريع بعد التشغيل
```bash
# 1) لازم تشوف الموديولين في اللوج عند الإقلاع
#    🧩 موديول مُركّب: الأصناف (/api/products)
#    🧩 موديول مُركّب: المخزون (/api/inventory)

# 2) من الواجهة: /products → أضف صنف → /inventory → استلام من مورد → شوف الرصيد
# 3) تأكد من القيد: SELECT * FROM journal_entries WHERE source_type='stock_receive';
```

---

## المرحلة 3 — العملاء والسيارات والمبيعات (الدورة التشغيلية كاملة)

### إيه اللي اتضاف
| الموديول | المسار | الشاشة |
|---|---|---|
| `shifts` | `/api/shifts` | مدموجة في `/sales` (شريط الوردية) |
| `customers` | `/api/customers` | `/customers` — العملاء + الأسطول + كشف الحساب |
| `cars` | `/api/cars` | `/cars` — طابور تسجيل/دخول/خروج السيارات |
| `invoices` | `/api/invoices` | `/sales` — نقطة البيع (POS) |

وموديول واحد جديد في النواة: `core/zatca.py` (منقول من `zatca.service.js`) —
توليد QR بصيغة TLV/Base64 لتضمينه في الفاتورة (Tags 1-5، ZATCA Phase 1).

### الدورة الكاملة اللي بقت شغالة
1. عميل بيوصل بسيارته → `/cars` تسجيل سيارة (بيتربط بعميل تلقائياً: عميل موجود بنفس الجوال، أو عميل جديد يتعمل لوحده)
2. تأكيد الدخول → السيارة في الخدمة
3. الكاشير يفتح وردية من `/sales`
4. السيارة بتظهر في طابور الفوترة → يضغط عليها → تتملي بيانات العميل تلقائياً
5. يضيف الأصناف للسلة → يقسّم الدفع (نقد/شبكة/تحويل/آجل) → إصدار الفاتورة
6. الفاتورة بتعمل: خصم مخزون الفرع + قيد بيع + قيد تكلفة بضاعة مباعة + توليد QR + تسجيل آجل في ذمة العميل لو فيه
7. آخر الفواتير في نفس الشاشة، مع إمكانية عرض التفاصيل وعمل مرتجع كامل

### الـ Endpoints (أبرزها)
```
POST   /api/shifts/open              فتح وردية                    [shifts.manage_own]
GET    /api/shifts/current           الوردية المفتوحة + تقريرها    [shifts.manage_own]
POST   /api/shifts/{id}/close        إغلاق مع تسوية نقدية          [shifts.manage_own]

GET    /api/customers                قائمة العملاء + الرصيد
POST   /api/customers/{id}/pay       تسجيل سداد (يخفّض الذمة)      [customers.record_payment]
GET    /api/customers/{id}/statement كشف حساب برصيد جارٍ            [customers.view_statement]
POST   /api/customers/{id}/vehicles  إضافة سيارة لأسطول العميل

GET    /api/cars/lookup              بحث ذكي بلوحة/جوال للتعبئة التلقائية  [cars.create]
GET    /api/cars/billing-queue       طابور السيارات المحتاجة فاتورة        [invoices.view_pending|create]
POST   /api/cars/{id}/confirm-entry  تأكيد دخول                    [cars.confirm_entry]
POST   /api/cars/{id}/exit           تسجيل خروج                    [cars.confirm_exit]

POST   /api/invoices                 إصدار فاتورة (POS أو سيارة)   [invoices.create]
POST   /api/invoices/{id}/return     مرتجع كامل                    [invoices.return]
```

### نطاق مقصود لهذه الدفعة (مش نسيان — قرار حجم)
سبت الآتي برّه عمداً، وممكن يتضاف في دفعة لاحقة لو احتجته:
- **تعديل بنود فاتورة صادرة** و**المرتجع الجزئي** — منطق "عكس كامل ثم إعادة ترحيل" الأصلي معقّد ويستاهل دفعة مستقلة. المرتجع **الكامل** شغّال ومطبّق بالكامل.
- **الفواتير المعلقة (held invoices)** — سلة محفوظة مؤقتاً بدون قيود.
- **إشعارات واتساب** (تسجيل/دخول/تنبيه) — تكامل خارجي منفصل (UltraMsg)، هيُبنى كموديول مستقل.
- **تقرير أوقات الانتظار (timing-report)** — نقله لمرحلة التقارير.
- **حالة `inv_stock_state` القديمة على جدول `cars`** — كانت لنظام فوترة سابق اتلغى تماماً (نفس قرار Node الأصلي)، مفيش تعامل معاها هنا.

### حاجات مهمة تعرفها
- **كل فاتورة لازم وردية مفتوحة** — لو حاولت تبيع من غير ما تفتح وردية هترجع 409 برسالة واضحة.
- **مفيش migration جديد** — شغال على الجداول الموجودة (`customers`, `customer_vehicles`, `customer_ledger`, `cars`, `shifts`, `invoices`, `invoice_items`, `invoice_payments`, `invoice_counters`). لو قاعدتك لحد `migration-014-shifts-held-returns.sql` فأنت جاهز.
- **الـ QR بصيغة TLV/Base64** بيتولّد وقت إصدار الفاتورة ويتخزّن في `invoices.qr_tlv` — الواجهة الحالية بتعرض الأرقام بس، رسم QR كصورة فعلية لسه مطلوب لو احتجت طباعة فاتورة.
- **رقم الفاتورة ذرّي** عبر `invoice_counters` (نفس صيغة `INV-000123`) — منقول بالحرف من `nextInvoiceNo`.
- **ربط العميل بالسيارة تلقائي**: `customerId` صريح ← عميل بنفس رقم الجوال ← عميل جديد. فشل إنشاء العميل التلقائي ما يمنعش تسجيل السيارة (مطابق للأصل).

---

## المرحلة 4 — المشتريات، الحسابات، والتقارير

### إيه اللي اتضاف
| الموديول | المسار | الشاشة |
|---|---|---|
| `suppliers` | `/api/suppliers` | `/suppliers` — الموردون + كشف حساب + سندات صرف |
| `purchases` | `/api/purchases` | `/purchases` — فواتير مشتريات مباشرة |
| `accounting` | `/api/accounting` | `/accounting` — شجرة حسابات + قيود + 3 تقارير مالية |
| `reports` | `/api/reports` | `/reports` — الإقرار الضريبي + ملخّص المبيعات |

### الدورة اللي بقت شغالة
1. سجّل مورد في `/suppliers`
2. `/purchases` → فاتورة مشتريات (نقدي أو آجل) → بتزوّد مخزون المستودع فوراً + تحدّث تكلفة الأصناف + تسجّل قيد محاسبي (مدين مخزون + مدين ضريبة مدخلات / دائن نقد أو ذمم دائنة)
3. لو آجل: `/suppliers` → كشف حساب المورد → سند صرف يخفّض الذمة ويقفل الفاتورة تدريجياً (`partially_paid` → `paid`)
4. `/accounting` → شوف القيد فوراً في سجل القيود، وميزان المراجعة بيتحدّث لايف
5. `/reports` → الإقرار الضريبي بيجمع ضريبة المخرجات (من الفواتير) وضريبة المدخلات (من فواتير المشتريات) ويطلع صافي المستحق أو المسترد

### الـ Endpoints (أبرزها)
```
GET    /api/suppliers                      قائمة الموردين + الرصيد        [purchasing.suppliers]
GET    /api/suppliers/{id}/statement       كشف حساب + فواتير مستحقة       [purchasing.suppliers]
POST   /api/suppliers/{id}/pay             سند صرف (سداد)                [purchasing.suppliers]

POST   /api/purchases/purchase-invoices    فاتورة مشتريات مباشرة         [purchasing.invoices]
GET    /api/purchases/purchase-invoices    قائمة الفواتير + فلترة        [purchasing.invoices]

GET    /api/accounting/accounts            شجرة الحسابات                 [accounting.view_reports]
POST   /api/accounting/accounts            حساب فرعي جديد                [admin فقط]
GET    /api/accounting/journal             سجل القيود بفلترة             [accounting.view_reports]
GET    /api/accounting/trial-balance       ميزان المراجعة حتى تاريخ       [accounting.view_reports]
GET    /api/accounting/income-statement    قائمة الدخل لفترة              [accounting.view_reports]
GET    /api/accounting/balance-sheet       الميزانية العمومية             [accounting.view_reports]

GET    /api/reports/vat-return             الإقرار الضريبي لفترة          [accounting.view_vat]
GET    /api/reports/sales-summary          ملخّص مبيعات (خدمة/بيع بالقطعة) [reports.sales]
```

### نطاق مقصود لهذه الدفعة (مش نسيان — قرار حجم)
- **مفيش دورة أوامر شراء رسمية**: النظام الأصلي فيه طلب تسعير (RFQ) ⬅️ أمر شراء معتمد ⬅️
  استلام مخزني منفصل ⬅️ فاتورة بمطابقة ثلاثية (3-way match). هنا بنيت **المسار المباشر بس**:
  فاتورة شراء واحدة بتعمل كل حاجة فوراً (نفس مسار "الشراء المباشر بدون PO" في النظام الأصلي).
  لو محتاج دورة الاعتماد الرسمية (لشركات فيها فصل صلاحيات شراء/اعتماد/استلام)، محتاجة دفعة مستقلة.
- **تقرير الإقرار الضريبي مبسّط في حساب المرتجعات**: بيعتمد على `invoices.is_returned`
  منسوباً لتاريخ إصدار الفاتورة الأصلي، مش تاريخ المرتجع نفسه (النظام الأصلي بيستخدم جدول
  `invoice_returns` منفصل بتاريخ إنشاء المرتجع، لكن موديول الفواتير عندنا بيدعم مرتجع كامل
  بس بدون هذا الجدول). الفرق العملي ضئيل لو المرتجع قريب من تاريخ البيع؛ لو احتجت الدقة
  الكاملة محتاج عمود `returned_at` على `invoices` في migration لاحقة. تفاصيل أكتر في
  كومنتات `modules/reports/__init__.py`.
- **تقارير مؤجّلة**: مبيعات كل كاشير، مقارنة الفروع، حركة المخزون، تقرير 360° للعميل،
  تحليلات لوحة القيادة — خمس تقارير من أصل سبعة في النظام الأصلي.

### حاجات مهمة تعرفها
- **مفيش migration جديد** — شغال على `suppliers`, `document_counters`, `purchase_invoices`,
  `purchase_invoice_items`, `supplier_ledger`, `supplier_payments`, `accounts`, `journal_entries`,
  `journal_lines`. لو قاعدتك فيها `migration-009-purchases.sql` فأنت جاهز.
- **رقم فاتورة المشتريات ذرّي** عبر `document_counters` (نفس صيغة `PINV-000123`) — منقول
  بالحرف من `nextDocNo`.
- **إنشاء/حذف حساب في شجرة الحسابات مقصور على `admin`** بالدور نفسه (`require_role`)، مش
  مجرد صلاحية عادية — نفس فلسفة `requireRole('admin')` في النظام الأصلي.
- **كل الأرقام المالية Live** — مفيش جدول أرصدة منفصل يحتاج تسوية دورية؛ ميزان المراجعة
  والميزانية بيتحسبوا وقت الطلب من `journal_lines` مباشرة.

---

## المرحلة 5 — الموارد البشرية (HR) — اكتملت خطة البناء الأساسية

### إيه اللي اتضاف
| الموديول | المسار | الشاشة |
|---|---|---|
| `hr` | `/api/hr` | `/hr` — خمس تبويبات: الموظفون، الحضور والانصراف، الإجازات، المخالفات، الرواتب |

### ليه موديول واحد بس مش خمسة؟
الخمس أقسام (موظفين، حضور، إجازات، مخالفات، رواتب) مترابطة بإحكام — الرواتب
بتحتاج بيانات الموظف والمخالفات مع بعض في نفس العملية، فمفيش فايدة من الفصل
زي ما عملنا مع الأصناف/المخزون (اللي كل واحد فيهم مسار API مستقل في النظام
القديم). هنا الأصل نفسه كان `hr.routes.js` واحد، فاحتفظنا بنفس البنية.

### الدورة اللي بقت شغالة
1. `/hr` → سجّل موظف (منفصل تماماً عن حسابات الدخول — عامل النظافة مثلاً
   ممكن يكون له سجل HR كامل من غير أي حساب دخول للنظام)
2. تسجيل حضور/انصراف يومي، وتقديم طلبات إجازة (برصيد تقديري يظهر وقت الطلب)
3. اعتماد أو رفض الإجازات، تسجيل مخالفات بخصومات
4. تشغيل رواتب الشهر: بيحسب لكل موظف نشط راتبه − خصومات مخالفات الشهر −
   حصة الموظف من التأمينات (GOSI، للسعوديين فقط) = الصافي
5. اعتماد دورة الرواتب نهائياً (بعدها مينفعش تتعدّل)
6. عند إنهاء خدمة موظف: تقدير فوري لمكافأة نهاية الخدمة

### الـ Endpoints (أبرزها)
```
GET    /api/hr/employees                  قائمة الموظفين                [hr.view|hr.manage]
POST   /api/hr/employees/{id}/terminate   إنهاء خدمة + تقدير المكافأة    [hr.manage]
GET    /api/hr/iqama-alerts               تنبيهات انتهاء الإقامة         [hr.view|hr.manage]

POST   /api/hr/attendance/check-in        تسجيل حضور                    [hr.attendance]
POST   /api/hr/attendance/check-out       تسجيل انصراف                  [hr.attendance]

POST   /api/hr/leave-requests             طلب إجازة جديد                [hr.manage|hr.leave_approve]
POST   /api/hr/leave-requests/{id}/decision  اعتماد/رفض                  [hr.leave_approve]
GET    /api/hr/leave-balance/{employeeId}    رصيد الإجازة السنوي التقريبي

POST   /api/hr/violations                 تسجيل مخالفة بخصم              [hr.violations]

POST   /api/hr/payroll-runs               تشغيل رواتب الشهر              [hr.payroll]
POST   /api/hr/payroll-runs/{id}/finalize اعتماد نهائي                   [hr.payroll]
```

### ⚠ تحذيرات مهمة منقولة بالحرف من النظام الأصلي — اقرأها قبل الاستخدام الفعلي
- **مكافأة نهاية الخدمة تقديرية**: نص شهر عن كل سنة من أول 5 سنين، شهر كامل
  بعدها — تقدير لحالة "إنهاء الخدمة العادي" بس. **ما بياخدش في الاعتبار**
  الاستقالة (نسب مخفّضة) أو الفصل التأديبي (مادة 80) أو انقطاعات العقد.
- **نسب التأمينات (GOSI)** (`gosi_saudi_employee_pct` 9.75%، `gosi_saudi_employer_pct`
  11.75%، `gosi_nonsaudi_employer_pct` 2%) قيم افتراضية عامة وقت كتابة الكود،
  قابلة للتعديل من جدول `companies` مباشرة — **تأكد منها مع محاسبك أو بوابة
  التأمينات قبل أي صرف فعلي**.
- **رصيد الإجازة السنوي** (21 يوم لأول 5 سنين، 30 بعدها) تقديري حسب نظام
  العمل السعودي العام — **طابقه مع سجلاتك الرسمية**.
- الكود بيعرض كل التحذيرات دي في الواجهة وقت العرض، مش بس في التوثيق.

### حاجات مهمة تعرفها
- **مفيش migration جديد** — شغال على `hr_employees`, `hr_attendance`,
  `hr_leave_requests`, `hr_violations`, `hr_payroll_runs`, `hr_payslips`، وأعمدة
  `gosi_*_pct` على `companies`. لو قاعدتك فيها `migration-017-hr-module.sql` فأنت جاهز.
- **`linked_user_id` اختياري** — موظف HR من غير حساب دخول للنظام أصلاً وارد تماماً.
- **دورة رواتب واحدة لكل شهر/سنة لكل شركة** (قيد فريد) — محاولة تكرار بترجع 409.
- **HR مالوش أي قيود محاسبية تلقائية** في هذه الدفعة (بعكس المبيعات والمشتريات) —
  الرواتب بتتحسب وتتسجّل في `hr_payslips` بس، من غير ربط بـ `journal_entries`.
  لو احتجت قيد رواتب تلقائي (مصروف رواتب / تأمينات مستحقة / صافي مستحق للموظفين)
  ده تحسين واضح لدفعة لاحقة.

---

## ملخص خطة البناء الكاملة (المراحل 1-5)

| # | المحتوى | الحالة |
|---|---|---|
| 1 | الأساس + موديول الفروع (النموذج الذهبي) | ✅ |
| 2 | الأصناف والمخزون | ✅ |
| 3 | العملاء، السيارات، الورديات، المبيعات (POS + ZATCA) | ✅ |
| 4 | الموردون، المشتريات، الحسابات، التقارير | ✅ |
| 5 | الموارد البشرية | ✅ |

كل الدفعات شغّالة على نفس قاعدة PostgreSQL الأصلية بالحرف (`z8_car_manager`)
بدون أي migration جديد — فقط كود جديد فوق الجداول الموجودة أصلاً. أي دفعة
قادمة (مثلاً: دورة أوامر شراء رسمية، تعديل/مرتجع جزئي للفواتير، تقارير إضافية،
تكامل واتساب، قيد رواتب محاسبي) تُبنى بنفس النمط: مجلد موديول جديد في
`backend/app/modules/`، وشاشة جديدة في `frontend/src/app/(app)/`.
