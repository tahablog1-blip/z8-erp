# نظام تصميم Z8 ERP الموحّد

مصدر الرموز الوحيد: متغيرات CSS في `frontend/src/app/globals.css` (نهاري/ليلي) + أسماء Tailwind في `frontend/tailwind.config.ts`.
المكوّنات المشتركة: `frontend/src/components/ui.tsx` (+ `DataTable`, `toast`, `dialog`, `dashboard/KpiCard`, `inventory/shared`).
الفحص الآلي: `bash tools/check-design.sh` (يعمل في CI ويفشل عند أي مخالفة).

## الألوان (دلالية — لا لون جديد لأي صفحة)
| الدور | الاسم في Tailwind | المتغيّر |
|---|---|---|
| الأساسي (Primary / Info) | `petrol` أو `primary` / `info` | `--petrol` |
| نجاح | `emerald` أو `success` | `--emerald` |
| تحذير | `brass` أو `warning` | `--brass` |
| خطر/خطأ | `ember` أو `danger` | `--ember` |
| الخلفية / السطح / سطح مرتفع | `ink` · `ink-2`(`surface`) · `ink-3`(`surface-hover`) | `--ink` … |
| الحدود | `line` | `--line` |
| النص / الثانوي | `text` · `text-dim` | `--text` |
| القائمة الجانبية النشطة | `nav-active` | `--nav-active` |

قواعد: لا `bg-black/text-white/slate-*/blue-*`… (الفاحص يمنعها). البطاقات كلها سطح موحّد؛ اللون يظهر فقط في الرقم المهم/الأيقونة/الحالة/المؤشر.
الحالات: `success` مكتمل/مدفوع/متوفر · `warning` منخفض/قيد المراجعة/تحتاج انتباه · `danger` ملغي/نافد/متأخر/خطأ · `info` معلومة/جارٍ · `neutral` ثانوي.

## الطباعة (سلم ثابت)
| الاستخدام | الفئة | الحجم |
|---|---|---|
| عنوان الصفحة | `.page-title` | 22px / 800 |
| وصف الصفحة | `.page-desc` | 12.5px |
| عنوان قسم | `.section-title` | 18px |
| عنوان بطاقة | `.card-title` | 15px |
| نص أساسي | `text-t-md` | 13.5px |
| صغير / جداول | `text-t-sm` | 12.5px |
| تسمية توضيحية | `text-t-xs` | 11.5px |
| أرقام KPI | `text-t-2xl` / `text-t-3xl` | 22 / 28px |
ممنوع `text-[Npx]` (إلا للأيقونات `!text-[16px]`). الأرقام المالية: `tnum` + محاذاة موحّدة.

## الأشكال
- انحناءات: `rounded-md` (شارات) · `rounded-lg` (أزرار/حقول) · `rounded-card` (بطاقات/نوافذ) · `rounded-full` (حبوب/أفاتار).
- ارتفاعات التحكم: xs 28 · sm 32 · md 36 (الافتراضي، الأزرار والحقول والقوائم) · lg 40.
- ظلال: `shadow-card` للبطاقات، `shadow-panel` للنوافذ فقط. بلا تدرجات ولا بلور.
- الأيقونات: Material Symbols عبر `MIcon` فقط، أحجام 16/18/20/24. ممنوع الرموز التعبيرية.

## المكوّنات
`PageHeader` (عنوان + وصف + إجراءات) · `Button` (primary/secondary/outline/ghost/danger/success/tool × xs/sm/md/lg) · `Input/Select/Textarea/Field` · `Badge`/`StatusBadge` (success/warning/danger/info/neutral، مع `dot`) · `Modal` · `EmptyState` · `ErrorNote` · `Tabs` · `Card` · `KpiCard` · `DataTable` · `toast.*` · `appConfirm/appAlert`.
بنية الصفحة: ترويسة ← أدوات البحث/التصفية ← مؤشرات ← المحتوى ← الترقيم.

## حالة التنفيذ
- منجز: الرموز، الطباعة، الانحناءات، الأزرار/الحقول، الشارات، الجداول، الأيقونات بلا رموز تعبيرية، ترويسة `PageHeader` في الإعدادات والمشتريات والموارد البشرية والتقارير والحسابات والخزينة والفروع، صفحات الحجز العامة وشاشة البوابة بالرموز بدل ألوان hex الخاصة، قوالب الطباعة (تقارير وفواتير وملصقات) بلون العلامة الموحد، الفاحص `tools/check-design.sh` يغطي كل الصفحات.
- متبقٍ (تحسينات لاحقة): تطبيق `PageHeader` على صفحات المبيعات ولوحة القيادة والتجهيز والملاحظات (ترويسات مركّبة)، وتحويل الشارات المحلية المتبقية إلى `Badge`، ومراجعة بصرية للشاشات القديمة الأكبر (المبيعات/السيارات).
