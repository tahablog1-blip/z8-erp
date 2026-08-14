// lib/service-line.ts — تعريف موحّد لخط الخدمة (المحطات الثلاثة ونقاطها)
// بيستخدمه: شاشة خط الخدمة + طباعة الفواتير + (لاحقاً) موديول الكاميرات الذكية
export const STAGES = [
  { id: 1, title: "المحطة الأولى — الدخول" },
  { id: 2, title: "المحطة الثانية — الزيت" },
  { id: 3, title: "المحطة الثالثة — التشييك النهائي" },
] as const;

export const CHECKPOINTS: { key: string; label: string; stage: 1 | 2 | 3 }[] = [
  // المحطة 1: الدخول
  { key: "air_filter",     label: "فك فلتر الهواء وتنظيفه أو تبديله", stage: 1 },
  { key: "coolant_top",    label: "تزويد ماء الرديتر حسب الحاجة",     stage: 1 },
  { key: "wiper_fluid",    label: "تزويد ماء المساحات حسب الحاجة",    stage: 1 },
  { key: "drain_plug_off", label: "فك صرة الزيت (من أسفل)",           stage: 1 },
  { key: "oil_filter_off", label: "فك فلتر الزيت",                     stage: 1 },
  { key: "oil_filter_on",  label: "تركيب فلتر الزيت الجديد",           stage: 1 },
  // المحطة 2: الزيت
  { key: "oil_suction",    label: "شفط الزيت المتبقي بجهاز الشفط",     stage: 2 },
  { key: "drain_plug_on",  label: "تركيب صرة الزيت",                   stage: 2 },
  { key: "oil_fill",       label: "تعبئة الزيت الجديد",                stage: 2 },
  { key: "oil_cap_close",  label: "إغلاق غطاء الزيت",                  stage: 2 },
  // المحطة 3: التشييك النهائي
  { key: "dipstick_check", label: "التشييك من العيار (مستوى الزيت)",   stage: 3 },
  { key: "leak_check",     label: "فحص أسفل السيارة (تهريب أو سليم)",  stage: 3 },
  { key: "air_clean",      label: "تنظيف الماكينة بالهواء من الغبار",  stage: 3 },
];

export type CkStatus = "pending" | "in_progress" | "ok" | "needs" | "done";
export type CkItem = { key: string; label: string; status: CkStatus; note: string | null };

export const CK_LABEL: Record<CkStatus, string> = {
  pending: "لم يُفحص", in_progress: "جاري التنفيذ", ok: "سليم", done: "تم التغيير", needs: "يحتاج متابعة",
};
export const FINISHED: CkStatus[] = ["ok", "done", "needs"];

export const stageOf = (key: string): 1 | 2 | 3 =>
  CHECKPOINTS.find((c) => c.key === key)?.stage ?? 3;
