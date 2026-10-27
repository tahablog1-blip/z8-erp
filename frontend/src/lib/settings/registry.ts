// lib/settings/registry.ts — فهرس مركز الإعدادات: كل عنصر هنا صفحة فعلية موجودة (لا عناصر وهمية).
// الصلاحيات هنا لإخفاء ما لا يملكه المستخدم؛ الحماية الحقيقية في الـ endpoints (Backend).
export type SettingsItem = {
  id: string; group: string; title: string; desc: string; icon: string; path: string;
  perms: string[]; adminOnly?: boolean; keywords: string;
};
export const GROUPS: { id: string; title: string; icon: string }[] = [
  { id: "basic", title: "أساسية", icon: "tune" },
  { id: "access", title: "المستخدمون والوصول", icon: "manage_accounts" },
  { id: "finance", title: "المحاسبة والمالية", icon: "account_balance" },
  { id: "operations", title: "التشغيل والأجهزة", icon: "devices" },
  { id: "security", title: "الأمان والمراجعة", icon: "verified_user" },
  { id: "integrations", title: "التكاملات", icon: "hub" },
  { id: "appearance", title: "المظهر", icon: "palette" },
];

export const ITEMS: SettingsItem[] = [
  { id: "company", group: "basic", title: "بيانات المنشأة", desc: "الاسم والشعار والرقم الضريبي والسجل التجاري والعنوان المستخدم في الفواتير.", icon: "apartment", path: "/settings/company", perms: ["settings.company"],
    keywords: "منشأة شركة شعار لوجو رقم ضريبي سجل تجاري عنوان مدينة هاتف بريد فاتورة نقاط ولاء" },
  { id: "branches", group: "basic", title: "الفروع", desc: "إضافة الفروع وتعديلها وتعطيلها وخطوط الخدمة.", icon: "store", path: "/branches", perms: ["branches.manage"],
    keywords: "فرع فروع مدينة محطة مستودع نقطة بيع خزينة" },
  { id: "system", group: "basic", title: "إعدادات النظام", desc: "اللغة والعملة وتنسيق التاريخ والأرقام وبداية السنة المالية والنسخ الاحتياطي.", icon: "dns", path: "/settings/system", perms: [], adminOnly: true,
    keywords: "نظام لغة عملة ريال منطقة زمنية تاريخ هجري ميلادي أرقام سنة مالية نسخ احتياطي backup" },
  { id: "users", group: "access", title: "المستخدمون", desc: "حسابات الموظفين وأدوارهم وفروعهم وتعطيلهم وإعادة تعيين كلمة المرور.", icon: "group", path: "/settings/users", perms: ["settings.users"],
    keywords: "مستخدم موظف حساب تعطيل كلمة المرور آخر دخول فرع دور" },
  { id: "roles", group: "access", title: "الأدوار والصلاحيات", desc: "مجموعات الصلاحيات الجاهزة وتخصيصها حسب الوحدات.", icon: "shield_person", path: "/settings/roles", perms: ["settings.users"],
    keywords: "دور أدوار صلاحية صلاحيات إذن عرض إنشاء تعديل حذف اعتماد" },
  { id: "price-lists", group: "finance", title: "قوائم الأسعار", desc: "قوائم أسعار خاصة بالعملاء والأصناف.", icon: "sell", path: "/settings/price-lists", perms: ["products.price_lists"],
    keywords: "سعر أسعار قائمة خصم عميل جملة" },
  { id: "printing", group: "operations", title: "الطباعة", desc: "الطباعة التلقائية، المعاينة، عدد النسخ، تذييل الفاتورة، والإيصال الحراري 80مم وA4.", icon: "print", path: "/settings/printing", perms: [], adminOnly: true,
    keywords: "طباعة طابعة طابعات فاتورة 80mm 80مم a4 حراري نسخ معاينة تذييل qr شعار" },
  { id: "cameras", group: "operations", title: "كاميرات المحطات", desc: "ربط الكاميرات بالمحطات وفحص قراءة اللوحات.", icon: "videocam", path: "/settings/cameras", perms: ["settings.company"],
    keywords: "كاميرا كاميرات محطة بوابة لوحات اتصال rtsp" },
  { id: "security", group: "security", title: "الأمان وتسجيل الدخول", desc: "المصادقة الثنائية وكلمة المرور والجلسات والأجهزة المسجّلة.", icon: "verified_user", path: "/settings/security", perms: [],
    keywords: "أمان مصادقة ثنائية 2fa otp كلمة المرور جلسات أجهزة تسجيل الدخول" },
  { id: "audit-log", group: "security", title: "سجل المراجعة", desc: "من فعل ماذا ومتى في النظام.", icon: "history", path: "/settings/audit-log", perms: ["audit.view"],
    keywords: "سجل مراجعة تدقيق audit نشاط تغيير مستخدم عملية" },
  { id: "integrations", group: "integrations", title: "واتساب وسجل التكاملات", desc: "حالة واتساب والبريد وسجل عمليات التكامل الناجحة والفاشلة.", icon: "hub", path: "/settings/integrations", perms: ["settings.whatsapp"],
    keywords: "واتساب whatsapp بريد email تكامل تكاملات سجل رسائل ultramsg" },
  { id: "design", group: "appearance", title: "التصميم", desc: "الألوان الأساسية والخطوط على مستوى النظام كله (رموز تصميم موحّدة).", icon: "palette", path: "/settings/design", perms: ["settings.company"],
    keywords: "تصميم ألوان لون خط وضع ليلي داكن مظهر" },
  { id: "background", group: "appearance", title: "الخلفية", desc: "خلفية صفحات النظام وشفافيتها.", icon: "wallpaper", path: "/settings/background", perms: ["settings.company"],
    keywords: "خلفية صورة شفافية تعتيم" },
];

export const DEFAULT_QUICK = ["company", "branches", "users", "roles", "printing", "security", "integrations", "audit-log"];

export const itemFor = (pathname: string): SettingsItem | undefined =>
  ITEMS.filter((i) => pathname === i.path || pathname.startsWith(i.path + "/")).sort((a, b) => b.path.length - a.path.length)[0];

/** بحث بسيط بالأولوية: العنوان ثم الكلمات المفتاحية ثم الوصف ثم اسم المجموعة */
export function searchItems(items: SettingsItem[], q: string): SettingsItem[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  const words = needle.split(/\s+/);
  const scored = items.map((i) => {
    const grp = GROUPS.find((g) => g.id === i.group)?.title ?? "";
    let score = 0;
    for (const w of words) {
      if (i.title.toLowerCase().includes(w)) score += 5;
      else if (i.keywords.toLowerCase().includes(w)) score += 3;
      else if (i.desc.toLowerCase().includes(w)) score += 2;
      else if (grp.toLowerCase().includes(w)) score += 1;
      else return { i, score: 0 };   // كل الكلمات لازم تتطابق
    }
    return { i, score };
  });
  return scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score).map((x) => x.i);
}
