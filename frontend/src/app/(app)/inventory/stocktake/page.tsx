"use client";

import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

type Branch = { id: string; name: string };

type Session = {
  id: string;
  locType: string;
  locId: string;
  status: string;
  note: string | null;
  createdByName: string | null;
  createdAt: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  totalItems: number;
  countedItems: number;
};

type StocktakeItem = {
  id: string;
  productId: string;
  name: string;
  barcode: string | null;
  category: string | null;
  spec: string | null;
  unit: string | null;
  expectedQty: number;
  countedQty: number | null;
  difference: number | null;
  currentQty: number;
  unitCost: number;
  diffValue: number | null;
  note: string | null;
};

type StocktakeDetail = Session & {
  items: StocktakeItem[];
  shortageValue: number;
  surplusValue: number;
  zeroCostDiffItems: number;
};

type ImportPreview = {
  committed: boolean;
  totalPieces: number;
  distinctBarcodes: number;
  matched: {
    productId: string;
    name: string;
    barcode: string;
    scanned: number;
    expectedQty: number;
    previousCounted: number | null;
    difference: number;
  }[];
  unmatched: { barcode: string; count: number }[];
  uncountedRemaining: number;
};

const STATUS: Record<string, string> = {
  in_progress: "جاري الجرد",
  review: "بانتظار المراجعة",
  approved: "معتمد",
  cancelled: "ملغي",
};

const fmtMoney = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const buttonClass =
  "rounded-xl px-4 py-2.5 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50";

export default function StocktakePage() {
  const { user, hasPerm } = useAuth();

  const canCreate = hasPerm("inventory.stocktake");
  const canApprove = hasPerm("inventory.stocktake_approve");
  const isAdmin = user?.role === "admin";

  const [sessions, setSessions] = useState<Session[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [detail, setDetail] = useState<StocktakeDetail | null>(null);

  const [locType, setLocType] = useState<"warehouse" | "branch">("branch");
  const [locId, setLocId] = useState("");
  const [newNote, setNewNote] = useState("");
  const [search, setSearch] = useState("");
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [savingProduct, setSavingProduct] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  const loadSessions = useCallback(async () => {
    const rows = await api<Session[]>("/inventory/stocktakes");
    setSessions(rows);
  }, []);

  const loadBranches = useCallback(async () => {
    const rows = await api<Branch[]>("/branches");
    setBranches(rows);

    if (!isAdmin && user?.branchId) {
      setLocType("branch");
      setLocId(user.branchId);
    } else if (isAdmin && rows.length) {
      setLocId((previous) => previous || rows[0].id);
    }
  }, [isAdmin, user?.branchId]);

  useEffect(() => {
    let active = true;

    async function init() {
      setLoading(true);
      setError("");

      try {
        const [rows, branchRows] = await Promise.all([
          api<Session[]>("/inventory/stocktakes"),
          api<Branch[]>("/branches"),
        ]);

        if (!active) return;

        setSessions(rows);
        setBranches(branchRows);

        if (!isAdmin && user?.branchId) {
          setLocType("branch");
          setLocId(user.branchId);
        } else if (isAdmin && branchRows.length) {
          setLocId((previous) => previous || branchRows[0].id);
        }
      } catch (e: unknown) {
        if (active) {
          setError(e instanceof Error ? e.message : "تعذر تحميل بيانات الجرد");
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    init();
    return () => { active = false; };
  }, [isAdmin, user?.branchId]);

  const locationName = useCallback((type: string, id: string) => {
    if (type === "warehouse") return "المستودع الرئيسي";
    return branches.find((b) => String(b.id) === String(id))?.name
      || `الفرع ${id}`;
  }, [branches]);

  async function openSession(id: string) {
    setBusy(true);
    setError("");
    setMessage("");

    try {
      const data = await api<StocktakeDetail>(`/inventory/stocktakes/${id}`);
      setDetail(data);

      const initialCounts: Record<string, string> = {};
      const initialNotes: Record<string, string> = {};

      data.items.forEach((item) => {
        initialCounts[item.productId] =
          item.countedQty == null ? "" : String(item.countedQty);
        initialNotes[item.productId] = item.note || "";
      });

      setCounts(initialCounts);
      setNotes(initialNotes);
      setSearch("");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "تعذر فتح جلسة الجرد");
    } finally {
      setBusy(false);
    }
  }

  async function createSession() {
    if (!canCreate || busy) return;

    if (locType === "branch" && !locId) {
      setError("اختر الفرع أولاً.");
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");

    try {
      const created = await api<StocktakeDetail>("/inventory/stocktakes", {
        method: "POST",
        body: JSON.stringify({
          locType,
          locId: locType === "warehouse" ? "main" : locId,
          note: newNote.trim() || null,
        }),
      });

      setShowCreate(false);
      setNewNote("");
      await loadSessions();
      await openSession(created.id);
      setMessage("تم إنشاء جلسة الجرد. لم تتغير أرصدة المخزون.");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "تعذر إنشاء الجرد");
    } finally {
      setBusy(false);
    }
  }

  async function saveCount(item: StocktakeItem) {
    if (!detail || detail.status !== "in_progress" || savingProduct) return;

    const raw = counts[item.productId]?.trim() ?? "";

    if (raw === "" || !Number.isSafeInteger(Number(raw)) || Number(raw) < 0) {
      setError("أدخل كمية صحيحة غير سالبة قبل الحفظ.");
      return;
    }

    setSavingProduct(item.productId);
    setError("");
    setMessage("");

    try {
      await api(
        `/inventory/stocktakes/${detail.id}/items/${item.productId}`,
        {
          method: "PUT",
          body: JSON.stringify({
            countedQty: Number(raw),
            note: notes[item.productId]?.trim() || null,
          }),
        },
      );

      const refreshed = await api<StocktakeDetail>(
        `/inventory/stocktakes/${detail.id}`,
      );

      setDetail(refreshed);
      setCounts((previous) => ({
        ...previous,
        [item.productId]: refreshed.items.find(
          (x) => x.productId === item.productId,
        )?.countedQty == null
          ? ""
          : String(refreshed.items.find(
              (x) => x.productId === item.productId,
            )?.countedQty),
      }));
      setNotes((previous) => ({
        ...previous,
        [item.productId]: refreshed.items.find(
          (x) => x.productId === item.productId,
        )?.note || "",
      }));

      await loadSessions();
      setMessage(`تم حفظ عدّ الصنف: ${item.name}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "تعذر حفظ الكمية");
    } finally {
      setSavingProduct("");
    }
  }

  async function submitReview() {
    if (!detail || detail.status !== "in_progress" || busy) return;

    if (detail.items.some((item) => item.countedQty == null)) {
      setError("لا يمكن الإرسال للمراجعة قبل تسجيل الكمية لكل الأصناف.");
      return;
    }

    if (!window.confirm("إرسال جلسة الجرد للمراجعة؟ لن تتم تسوية الأرصدة الآن.")) {
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");

    try {
      await api(`/inventory/stocktakes/${detail.id}/review`, {
        method: "POST",
      });
      await openSession(detail.id);
      await loadSessions();
      setMessage("تم إرسال الجرد للمراجعة.");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "تعذر إرسال الجرد");
    } finally {
      setBusy(false);
    }
  }

  async function approveSession() {
    if (!detail || detail.status !== "review" || !canApprove || busy) return;

    if (!window.confirm(
      "تحذير: اعتماد الجرد قد يغيّر أرصدة المخزون. هل راجعت الفروق وتريد الاعتماد؟",
    )) return;

    setBusy(true);
    setError("");
    setMessage("");

    try {
      await api(`/inventory/stocktakes/${detail.id}/approve`, {
        method: "POST",
      });
      await openSession(detail.id);
      await loadSessions();
      setMessage("تم اعتماد الجرد بنجاح.");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "تعذر اعتماد الجرد");
    } finally {
      setBusy(false);
    }
  }

  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [zeroRest, setZeroRest] = useState(false);

  async function cancelSession() {
    if (!detail || busy) return;
    if (!window.confirm("إلغاء جلسة الجرد؟ لن يتغير أي رصيد، ولا يمكن التراجع.")) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api(`/inventory/stocktakes/${detail.id}/cancel`, { method: "POST" });
      await openSession(detail.id);
      await loadSessions();
      setMessage("تم إلغاء الجلسة.");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "تعذر إلغاء الجلسة");
    } finally {
      setBusy(false);
    }
  }

  async function pickImportFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !detail || busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await api<ImportPreview>(
        `/inventory/stocktakes/${detail.id}/import?commit=false`,
        { method: "POST", body: fd },
      );
      setImportFile(file);
      setZeroRest(false);
      setImportPreview(res);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "تعذر قراءة الملف");
    } finally {
      setBusy(false);
    }
  }

  async function commitImport() {
    if (!detail || !importFile || busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const fd = new FormData();
      fd.append("file", importFile);
      await api(
        `/inventory/stocktakes/${detail.id}/import?commit=true&zeroRest=${zeroRest}`,
        { method: "POST", body: fd },
      );
      setImportPreview(null);
      setImportFile(null);
      await openSession(detail.id);
      await loadSessions();
      setMessage("تم حفظ الكميات من الملف.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "تعذر حفظ الكميات");
    } finally {
      setBusy(false);
    }
  }

  const visibleItems = useMemo(() => {
    if (!detail) return [];

    const q = search.trim().toLowerCase();
    if (!q) return detail.items;

    return detail.items.filter((item) =>
      [item.name, item.barcode, item.category, item.spec]
        .some((v) => (v || "").toLowerCase().includes(q)),
    );
  }, [detail, search]);

  const counted = detail?.items.filter((item) => item.countedQty != null).length || 0;
  const totalDifference = detail?.items.reduce(
    (sum, item) => sum + (item.difference ?? 0), 0,
  ) || 0;

  if (!canCreate) {
    return (
      <main dir="rtl" className="mx-auto max-w-5xl p-6">
        <div className="rounded-2xl border border-amber-200 bg-brass-soft p-5 text-sm font-bold text-brass">
          ليس لديك صلاحية إدارة الجرد الفعلي. راجع مدير النظام لمنحك صلاحية inventory.stocktake.
        </div>
      </main>
    );
  }

  return (
    <main dir="rtl" className="mx-auto max-w-[1500px] space-y-5 p-4 md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-text">الجرد الفعلي</h1>
          <p className="mt-1 text-sm text-text-dim">
            تسجيل الكميات ومراجعة الفروق قبل تسوية المخزون.
          </p>
        </div>

        <button
          className={`${buttonClass} bg-slate-900 text-white`}
          onClick={() => { setShowCreate(!showCreate); setError(""); }}
          disabled={busy}
        >
          {showCreate ? "إلغاء" : "+ جلسة جرد جديدة"}
        </button>
      </header>

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}
      {message && (
        <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          {message}
        </div>
      )}

      {showCreate && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-lg font-extrabold">إنشاء جلسة جرد</h2>

          {isAdmin ? (
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block text-sm font-bold">
                نوع الموقع
                <select
                  className="mt-2 w-full rounded-xl border border-slate-300 bg-white p-3"
                  value={locType}
                  onChange={(e) => setLocType(e.target.value as "warehouse" | "branch")}
                >
                  <option value="branch">فرع</option>
                  <option value="warehouse">المستودع الرئيسي</option>
                </select>
              </label>

              {locType === "branch" && (
                <label className="block text-sm font-bold">
                  الفرع
                  <select
                    className="mt-2 w-full rounded-xl border border-slate-300 bg-white p-3"
                    value={locId}
                    onChange={(e) => setLocId(e.target.value)}
                  >
                    <option value="">اختر الفرع</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          ) : (
            <p className="mb-3 text-sm text-text-dim">
              موقع الجرد: {locationName("branch", user?.branchId || "")}
            </p>
          )}

          <label className="mt-4 block text-sm font-bold">
            ملاحظات الجرد (اختياري)
            <textarea
              className="mt-2 w-full rounded-xl border border-slate-300 p-3"
              rows={2}
              maxLength={500}
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder="سبب الجرد أو أي ملاحظات..."
            />
          </label>

          <p className="my-3 text-xs leading-6 text-text-dim">
            إنشاء الجلسة يأخذ لقطة للأرصدة الحالية ويجهّز الأصناف للعدّ.
            لن يتم تعديل المخزون حتى الاعتماد.
          </p>

          <button
            className={`${buttonClass} bg-blue-700 text-white`}
            onClick={createSession}
            disabled={busy || (locType === "branch" && !locId)}
          >
            {busy ? "جارٍ الإنشاء..." : "إنشاء الجلسة"}
          </button>
        </section>
      )}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4">
          <h2 className="font-extrabold">جلسات الجرد</h2>
          <button
            className={`${buttonClass} border border-slate-300 text-text`}
            onClick={() => {
              setLoading(true);
              setError("");
              loadSessions()
                .catch((e: unknown) => setError(e instanceof Error ? e.message : "تعذر تحديث القائمة"))
                .finally(() => setLoading(false));
            }}
            disabled={loading}
          >
            تحديث
          </button>
        </div>

        {loading ? (
          <p className="p-6 text-sm text-text-dim">جارٍ تحميل الجلسات...</p>
        ) : sessions.length === 0 ? (
          <p className="p-6 text-sm text-text-dim">لا توجد جلسات جرد حتى الآن.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[750px] text-right text-sm">
              <thead className="bg-ink-3 text-xs text-text-dim">
                <tr>
                  <th className="p-3">الموقع</th>
                  <th className="p-3">تاريخ الإنشاء</th>
                  <th className="p-3">منشئ الجلسة</th>
                  <th className="p-3">التقدم</th>
                  <th className="p-3">الحالة</th>
                  <th className="p-3">الإجراء</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id} className="border-t border-slate-100">
                    <td className="p-3 font-bold">
                      {locationName(s.locType, s.locId)}
                    </td>
                    <td className="p-3">
                      {s.createdAt ? new Date(s.createdAt).toLocaleString((typeof document !== "undefined" && document.documentElement.lang === "en" ? "en-US" : "ar-SA")) : "—"}
                    </td>
                    <td className="p-3">{s.createdByName || "—"}</td>
                    <td className="p-3">
                      {s.countedItems} / {s.totalItems}
                    </td>
                    <td className="p-3">
                      <span className="rounded-full bg-ink-3 px-3 py-1 text-xs font-bold">
                        {STATUS[s.status] || s.status}
                      </span>
                    </td>
                    <td className="p-3">
                      <button
                        className="font-bold text-blue-700 hover:underline"
                        onClick={() => openSession(s.id)}
                        disabled={busy}
                      >
                        فتح الجلسة
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {detail && (
        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-5">
          <div className="flex flex-wrap gap-3 border-b border-slate-100 pb-4">
            {detail.status === "in_progress" && (
              <>
                <label className={`${buttonClass} cursor-pointer bg-sky-700 text-white`}>
                  رفع ملف Excel / CSV
                  <input
                    type="file"
                    accept=".xlsx,.xlsm,.csv"
                    className="hidden"
                    onChange={pickImportFile}
                    disabled={busy}
                  />
                </label>
                <a
                  className={`${buttonClass} bg-ink-3 text-text`}
                  href="data:text/csv;charset=utf-8,%EF%BB%BFbarcode%0A"
                  download="stocktake-template.csv"
                >
                  تحميل قالب
                </a>
              </>
            )}
            {(detail.status === "in_progress" || detail.status === "review") && (
              <button
                className={`${buttonClass} border border-red-300 bg-white text-red-700`}
                onClick={cancelSession}
                disabled={busy}
              >
                إلغاء الجلسة
              </button>
            )}
            {detail.status === "in_progress" && (
              <button
                className={`${buttonClass} bg-amber-600 text-white`}
                onClick={submitReview}
                disabled={busy || !!savingProduct || counted === 0}
              >
                إرسال للمراجعة
              </button>
            )}

            {detail.status === "review" && canApprove && (
              <button
                className={`${buttonClass} bg-emerald-700 text-white`}
                onClick={approveSession}
                disabled={busy || !!savingProduct}
              >
                اعتماد الجرد وتسوية الأرصدة
              </button>
            )}

            {detail.status === "review" && !canApprove && (
              <p className="self-center text-sm text-amber-800">
                الجرد بانتظار مستخدم لديه صلاحية اعتماد الجرد.
              </p>
            )}

            {detail.status === "approved" && (
              <p className="self-center text-sm font-bold text-emerald-700">
                تم اعتماد الجرد.
              </p>
            )}

            {detail.status === "cancelled" && (
              <p className="self-center text-sm text-text-dim">هذه الجلسة ملغاة.</p>
            )}
          </div>

          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-black">
                تفاصيل الجرد — {locationName(detail.locType, detail.locId)}
              </h2>
              <p className="mt-1 text-xs text-text-dim">
                رقم الجلسة: {detail.id}
              </p>
              {detail.note && (
                <p className="mt-1 text-sm text-text-dim">{detail.note}</p>
              )}
            </div>
            <button
              className={`${buttonClass} border border-slate-300 text-text`}
              onClick={() => setDetail(null)}
            >
              إغلاق التفاصيل
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="rounded-xl bg-ink-3 p-3">
              <p className="text-xs text-text-dim">عدد الأصناف</p>
              <p className="mt-1 text-xl font-black">{detail.totalItems}</p>
            </div>
            <div className="rounded-xl bg-ink-3 p-3">
              <p className="text-xs text-text-dim">تم عدّه</p>
              <p className="mt-1 text-xl font-black">{counted}</p>
            </div>
            <div className="rounded-xl bg-ink-3 p-3">
              <p className="text-xs text-text-dim">متبقٍ للعدّ</p>
              <p className="mt-1 text-xl font-black">{detail.totalItems - counted}</p>
            </div>
            <div className="rounded-xl bg-ink-3 p-3">
              <p className="text-xs text-text-dim">صافي الفروق المسجلة</p>
              <p className="mt-1 text-xl font-black" dir="ltr">{totalDifference}</p>
            </div>
          </div>

          {detail.status === "in_progress" && (
            <div className="rounded-xl bg-blue-50 p-3 text-sm leading-6 text-blue-900">
              أدخل الكمية الفعلية واحفظ كل صنف. البحث أدناه يفلتر الأصناف المحمّلة
              داخل المتصفح ولا ينشئ جلسات أو يغيّر الأرصدة.
            </div>
          )}

          <input
            className="w-full rounded-xl border border-slate-300 p-3 text-sm"
            placeholder="ابحث باسم الصنف أو الباركود أو المواصفة..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <div className="overflow-x-auto">
            <table className="w-full min-w-[850px] text-right text-sm">
              <thead className="bg-ink-3 text-xs text-text-dim">
                <tr>
                  <th className="p-3">الصنف</th>
                  <th className="p-3">الباركود</th>
                  <th className="p-3">الرصيد المتوقع</th>
                  <th className="p-3">الكمية المعدودة</th>
                  <th className="p-3">الفرق</th>
                  {detail.status === "in_progress" && <th className="p-3">حفظ</th>}
                </tr>
              </thead>
              <tbody>
                {visibleItems.map((item) => (
                  <tr key={item.productId} className="border-t border-slate-100 align-top">
                    <td className="max-w-[300px] p-3">
                      <p className="font-bold">{item.name}</p>
                      <p className="mt-1 text-xs text-text-dim">
                        {[item.category, item.spec, item.unit].filter(Boolean).join(" • ") || "—"}
                      </p>
                      {detail.status === "in_progress" && (
                        <input
                          className="mt-2 w-full rounded-lg border border-slate-200 p-2 text-xs"
                          placeholder="ملاحظة للصنف (اختياري)"
                          value={notes[item.productId] || ""}
                          onChange={(e) => setNotes((old) => ({
                            ...old, [item.productId]: e.target.value,
                          }))}
                        />
                      )}
                      {detail.status !== "in_progress" && item.note && (
                        <p className="mt-1 text-xs text-text-dim">{item.note}</p>
                      )}
                    </td>
                    <td className="p-3 text-xs" dir="ltr">{item.barcode || "—"}</td>
                    <td className="p-3 font-bold">{item.expectedQty}</td>
                    <td className="p-3">
                      {detail.status === "in_progress" ? (
                        <input
                          type="number"
                          min="0"
                          step="1"
                          inputMode="numeric"
                          className="w-28 rounded-lg border border-slate-300 p-2 font-bold"
                          value={counts[item.productId] ?? ""}
                          onChange={(e) => setCounts((old) => ({
                            ...old, [item.productId]: e.target.value,
                          }))}
                          aria-label={`الكمية المعدودة ${item.name}`}
                        />
                      ) : (
                        item.countedQty ?? "—"
                      )}
                    </td>
                    <td className="p-3 font-black" dir="ltr">
                      {item.difference == null ? "—" : (
                        <span className={
                          item.difference < 0 ? "text-red-700" :
                          item.difference > 0 ? "text-emerald-700" : "text-text-dim"
                        }>
                          {item.difference > 0 ? `+${item.difference}` : item.difference}
                        </span>
                      )}
                    </td>
                    {detail.status === "in_progress" && (
                      <td className="p-3">
                        <button
                          className={`${buttonClass} bg-blue-700 px-3 py-2 text-white`}
                          onClick={() => saveCount(item)}
                          disabled={busy || !!savingProduct}
                        >
                          {savingProduct === item.productId ? "حفظ..." : "حفظ"}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>

            {visibleItems.length === 0 && (
              <p className="p-6 text-center text-sm text-text-dim">
                لا توجد أصناف مطابقة للبحث.
              </p>
            )}
          </div>

          {detail.countedItems > 0 && detail.status !== "cancelled" && (
            <div className="rounded-2xl border border-slate-200 p-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <p className="text-xs text-text-dim">قيمة العجز (بالتكلفة)</p>
                  <p className="mt-1 text-xl font-black text-red-600">
                    {fmtMoney(detail.shortageValue)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-text-dim">قيمة الزيادة (بالتكلفة)</p>
                  <p className="mt-1 text-xl font-black text-emerald-700">
                    {fmtMoney(detail.surplusValue)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-text-dim">الصافي</p>
                  <p
                    className={`mt-1 text-xl font-black ${
                      detail.surplusValue - detail.shortageValue < 0
                        ? "text-red-600"
                        : "text-emerald-700"
                    }`}
                  >
                    {fmtMoney(detail.surplusValue - detail.shortageValue)}
                  </p>
                </div>
              </div>
              <p className="mt-3 text-xs text-text-dim">
                محسوبة بآخر سعر شراء وقت بدء الجلسة، ولا تتأثر بتغيّر الأسعار بعدها.
              </p>
              {detail.zeroCostDiffItems > 0 && (
                <p className="mt-2 rounded-lg bg-brass-soft p-2 text-sm text-amber-800">
                  تنبيه: {detail.zeroCostDiffItems} صنف به فرق وتكلفته صفر، فلم تُحسب
                  قيمة فرقه. أدخل تكلفته من المشتريات.
                </p>
              )}
            </div>
          )}
</section>
      )}
          {importPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-2xl bg-white p-5 shadow-xl">
            <h3 className="mb-1 text-lg font-bold">معاينة الجرد من الملف</h3>
            <p className="mb-3 text-sm text-text-dim">
              {importPreview.totalPieces} قطعة · {importPreview.matched.length} صنف مطابق ·{" "}
              {importPreview.unmatched.length} باركود غير معروف
            </p>

            {importPreview.matched.some((m) => m.previousCounted != null) && (
              <p className="mb-3 rounded-lg bg-brass-soft p-2 text-sm text-amber-800">
                سيتم استبدال الكميات المعدودة سابقاً للأصناف المطابقة.
              </p>
            )}

            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-text-dim">
                  <th className="p-2 text-right">الصنف</th>
                  <th className="p-2 text-right">الباركود</th>
                  <th className="p-2 text-right">المعدود</th>
                  <th className="p-2 text-right">رصيد السيستم</th>
                  <th className="p-2 text-right">الفرق</th>
                </tr>
              </thead>
              <tbody>
                {importPreview.matched.map((m) => (
                  <tr key={m.productId} className="border-b border-slate-100">
                    <td className="p-2">{m.name}</td>
                    <td className="p-2 font-mono text-xs">{m.barcode}</td>
                    <td className="p-2 font-bold">{m.scanned}</td>
                    <td className="p-2">{m.expectedQty}</td>
                    <td
                      className={`p-2 font-bold ${
                        m.difference < 0
                          ? "text-red-600"
                          : m.difference > 0
                            ? "text-emerald-700"
                            : "text-text-dim"
                      }`}
                    >
                      {m.difference > 0 ? `+${m.difference}` : m.difference}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {importPreview.unmatched.length > 0 && (
              <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">
                <p className="mb-1 font-bold">باركودات غير موجودة في هذه الجلسة (لن تُحفظ):</p>
                <p className="font-mono text-xs leading-6">
                  {importPreview.unmatched
                    .slice(0, 50)
                    .map((u) => `${u.barcode} ×${u.count}`)
                    .join(" ، ")}
                </p>
              </div>
            )}

            {importPreview.uncountedRemaining > 0 && (
              <label className="mt-4 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={zeroRest}
                  onChange={(e) => setZeroRest(e.target.checked)}
                />
                اعتبر {importPreview.uncountedRemaining} صنف لم يظهر في الملف = 0
                (وإلا يبقى «لم يُجرد» ولا تتغير أرصدته)
              </label>
            )}

            <div className="mt-5 flex gap-3">
              <button
                className={`${buttonClass} bg-emerald-700 text-white`}
                onClick={commitImport}
                disabled={busy || importPreview.matched.length === 0}
              >
                حفظ الكميات
              </button>
              <button
                className={`${buttonClass} bg-ink-3 text-text`}
                onClick={() => {
                  setImportPreview(null);
                  setImportFile(null);
                }}
                disabled={busy}
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
