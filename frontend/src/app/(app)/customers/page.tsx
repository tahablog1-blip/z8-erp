"use client";
// شاشة العملاء — سجل العملاء (أفراد/شركات) + أسطول سياراتهم + كشف الحساب
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { printReport, tableHTML, kpisHTML } from "@/lib/print";
import { useAuth } from "@/lib/auth";
import { DataTable, Column } from "@/components/DataTable";
import { Badge, Button, Card, ErrorNote, Field, Input, Modal, Select, Textarea } from "@/components/ui";
import { appAlert, appConfirm } from "@/components/dialog";
import { Customer, Vehicle, Statement, money } from "@/modules/customers/types";

const EMPTY_CUSTOMER = {
  name: "", customerType: "individual" as "individual" | "company", phone: "", email: "",
  vatNumber: "", crNumber: "", address: "",
  buildingNo: "", street: "", district: "", city: "", postalCode: "", additionalNo: "",
};

const EMPTY_VEHICLE = {
  plate: "", plateType: "saudi" as "saudi" | "other", brand: "", makeModel: "",
  modelYear: "", carCategory: "", cylinders: "", color: "", chassisNumber: "", notes: "",
};

const dateFmt = (s: string) =>
  new Date(s).toLocaleDateString("ar-SA-u-nu-latn", { year: "numeric", month: "2-digit", day: "2-digit" });

export default function CustomersPage() {
  const { hasPerm } = useAuth();
  const canCreate = hasPerm("customers.create");
  const canEdit = hasPerm("customers.edit");
  const canDelete = hasPerm("customers.delete");
  const canStatement = hasPerm("customers.view_statement");
  const canPay = hasPerm("customers.record_payment");

  const [rows, setRows] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageErr, setPageErr] = useState("");

  const [modal, setModal] = useState<null | { mode: "create" } | { mode: "edit"; id: string }>(null);
  const [form, setForm] = useState({ ...EMPTY_CUSTOMER });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  // ── تفاصيل عميل (سيارات + كشف حساب) ──
  const [detail, setDetail] = useState<Customer | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [statement, setStatement] = useState<Statement | null>(null);
  const [detailTab, setDetailTab] = useState<"vehicles" | "statement">("vehicles");
  const [vehicleForm, setVehicleForm] = useState({ ...EMPTY_VEHICLE });
  const [vehicleErr, setVehicleErr] = useState("");
  const [showVehicleForm, setShowVehicleForm] = useState(false);

  // ── سداد ──
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState<"cash" | "card" | "transfer">("cash");
  const [payNote, setPayNote] = useState("");
  const [payErr, setPayErr] = useState("");

  async function load() {
    setLoading(true);
    try { setRows(await api<Customer[]>("/customers")); setPageErr(""); }
    catch (e: any) { setPageErr(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  function openCreate() {
    setForm({ ...EMPTY_CUSTOMER }); setErr(""); setModal({ mode: "create" });
  }
  function openEdit(c: Customer) {
    setForm({
      name: c.name, customerType: c.customer_type, phone: c.phone || "", email: c.email || "",
      vatNumber: c.vat_number || "", crNumber: c.cr_number || "", address: c.address || "",
      buildingNo: c.building_no || "", street: c.street || "", district: c.district || "",
      city: c.city || "", postalCode: c.postal_code || "", additionalNo: c.additional_no || "",
    });
    setErr(""); setModal({ mode: "edit", id: c.id });
  }

  async function save() {
    setErr(""); setBusy(true);
    const body = { ...form, email: form.email.trim() || null };
    try {
      if (modal?.mode === "create") {
        await api("/customers", { method: "POST", body: JSON.stringify(body) });
      } else if (modal?.mode === "edit") {
        await api(`/customers/${modal.id}`, { method: "PUT", body: JSON.stringify(body) });
      }
      setModal(null);
      await load();
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function remove(c: Customer) {
    if (!await appConfirm(`حذف العميل «${c.name}»؟`)) return;
    try { await api(`/customers/${c.id}`, { method: "DELETE" }); await load(); }
    catch (e: any) { await appAlert(e.message); }
  }

  async function openDetail(c: Customer) {
    setDetail(c); setDetailTab("vehicles"); setShowVehicleForm(false);
    setVehicleForm({ ...EMPTY_VEHICLE }); setVehicleErr("");
    setPayAmount(""); setPayNote(""); setPayErr("");
    try {
      const v = await api<Vehicle[]>(`/customers/${c.id}/vehicles`);
      setVehicles(v);
    } catch (e: any) { await appAlert(e.message); }
  }

  async function loadStatement(customerId: string) {
    try { setStatement(await api<Statement>(`/customers/${customerId}/statement`)); }
    catch (e: any) { await appAlert(e.message); }
  }

  async function addVehicle() {
    if (!detail) return;
    setVehicleErr("");
    try {
      await api(`/customers/${detail.id}/vehicles`, {
        method: "POST", body: JSON.stringify(vehicleForm),
      });
      setVehicleForm({ ...EMPTY_VEHICLE }); setShowVehicleForm(false);
      setVehicles(await api<Vehicle[]>(`/customers/${detail.id}/vehicles`));
      await load();
    } catch (e: any) { setVehicleErr(e.message); }
  }

  async function removeVehicle(v: Vehicle) {
    if (!detail) return;
    if (!await appConfirm(`حذف سيارة اللوحة «${v.plate}»؟`)) return;
    try {
      await api(`/customers/vehicles/${v.id}`, { method: "DELETE" });
      setVehicles(await api<Vehicle[]>(`/customers/${detail.id}/vehicles`));
      await load();
    } catch (e: any) { await appAlert(e.message); }
  }

  async function submitPayment() {
    if (!detail) return;
    setPayErr("");
    const amount = Number(payAmount);
    if (!amount || amount <= 0) { setPayErr("أدخل مبلغاً صحيحاً"); return; }
    try {
      await api(`/customers/${detail.id}/pay`, {
        method: "POST",
        body: JSON.stringify({ amount, method: payMethod, note: payNote.trim() || null }),
      });
      setPayAmount(""); setPayNote("");
      await loadStatement(detail.id);
      await load();
    } catch (e: any) { setPayErr(e.message); }
  }

  const columns: Column<Customer>[] = [
    {
      key: "name", title: "العميل",
      render: (c) => (
        <div>
          <div className="font-extrabold">{c.name}</div>
          <div className="text-[11px] text-text-dim">
            {c.customer_type === "company" ? "شركة" : "فرد"}
            {c.phone ? ` · ${c.phone}` : ""}
          </div>
        </div>
      ),
    },
    {
      key: "vehicle_count", title: "السيارات", width: "90px",
      render: (c) => <span className="tnum">{c.vehicle_count}</span>,
    },
    {
      key: "balance", title: "الرصيد (آجل)", width: "130px",
      render: (c) => (
        <span className={`tnum font-bold ${c.balance > 0 ? "text-ember" : "text-text-dim"}`}>
          {money(c.balance)}
        </span>
      ),
    },
    {
      key: "vat_number", title: "الرقم الضريبي", width: "140px",
      render: (c) => c.vat_number || <span className="text-text-dim">—</span>,
    },
    {
      key: "actions", title: "", width: "230px",
      render: (c) => (
        <div className="flex justify-end gap-1.5">
          {canStatement && (
            <Button variant="ghost" className="!px-2.5 !py-1 !text-[11.5px]"
                    onClick={() => openDetail(c)}>عرض</Button>
          )}
          {canEdit && (
            <Button variant="ghost" className="!px-2.5 !py-1 !text-[11.5px]"
                    onClick={() => openEdit(c)}>تعديل</Button>
          )}
          {canDelete && (
            <Button variant="danger" className="!px-2.5 !py-1 !text-[11.5px]"
                    onClick={() => remove(c)}>حذف</Button>
          )}
        </div>
      ),
    },
  ];

  const isCompany = form.customerType === "company";

  function printStatement() {
    if (!statement || !detail) return;
    const typeAr = (t: string) => t === "invoice" ? "فاتورة آجل" : t === "payment" ? "سداد" : "مرتجع";
    const body =
      kpisHTML([
        { label: "العميل", value: detail.name },
        { label: "الجوال", value: detail.phone || "—" },
        { label: "الرصيد الحالي (ر.س)", value: money(statement.balance) },
      ]) +
      tableHTML(["التاريخ", "النوع", "المرجع", "المبلغ", "الرصيد"],
        statement.entries.map((e) => [
          dateFmt(e.created_at), typeAr(e.entry_type), e.invoice_no || "—",
          (e.amount > 0 ? "+" : "") + money(e.amount), money(e.running_balance),
        ]), { numericCols: [3, 4] });
    printReport("كشف حساب عميل", `${detail.name}${detail.phone ? " — " + detail.phone : ""}`, body);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-[19px] font-extrabold">العملاء</h1>
        <span className="text-[12px] text-text-dim tnum">{rows.length} عميل</span>
      </div>

      <ErrorNote msg={pageErr} />

      <Card>
        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          searchKeys={["name", "phone", "vat_number"]}
          searchPlaceholder="بحث بالاسم أو الجوال أو الرقم الضريبي..."
          emptyText="لا يوجد عملاء بعد — أضف أول عميل"
          toolbar={canCreate && <Button onClick={openCreate}>+ عميل جديد</Button>}
        />
      </Card>

      {/* ══════════ إنشاء / تعديل عميل ══════════ */}
      <Modal open={!!modal} size="lg" onClose={() => setModal(null)}
             title={modal?.mode === "create" ? "عميل جديد" : "تعديل العميل"}>
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <Field label="نوع العميل">
              <Select value={form.customerType}
                      onChange={(e) => setForm({ ...form, customerType: e.target.value as any })}>
                <option value="individual">فرد</option>
                <option value="company">شركة</option>
              </Select>
            </Field>
            <Field label="الاسم">
              <Input value={form.name} autoFocus
                     onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="رقم الجوال">
              <Input value={form.phone} className="tnum"
                     onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </Field>
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            <Field label="البريد الإلكتروني">
              <Input type="email" value={form.email}
                     onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
            <Field label="الرقم الضريبي" hint={isCompany ? "مطلوب للفاتورة الضريبية القياسية" : undefined}>
              <Input value={form.vatNumber} className="tnum"
                     onChange={(e) => setForm({ ...form, vatNumber: e.target.value })} />
            </Field>
            <Field label="رقم السجل التجاري">
              <Input value={form.crNumber} className="tnum"
                     onChange={(e) => setForm({ ...form, crNumber: e.target.value })} />
            </Field>
          </div>

          {isCompany ? (
            <div className="rounded-lg border border-line bg-ink-3 p-3">
              <p className="mb-2 text-[12px] font-bold text-text-dim">العنوان الوطني (للفاتورة الضريبية)</p>
              <div className="grid gap-2 sm:grid-cols-3">
                <Field label="رقم المبنى">
                  <Input value={form.buildingNo} className="tnum"
                         onChange={(e) => setForm({ ...form, buildingNo: e.target.value })} />
                </Field>
                <Field label="الشارع">
                  <Input value={form.street}
                         onChange={(e) => setForm({ ...form, street: e.target.value })} />
                </Field>
                <Field label="الحي">
                  <Input value={form.district}
                         onChange={(e) => setForm({ ...form, district: e.target.value })} />
                </Field>
                <Field label="المدينة">
                  <Input value={form.city}
                         onChange={(e) => setForm({ ...form, city: e.target.value })} />
                </Field>
                <Field label="الرمز البريدي">
                  <Input value={form.postalCode} className="tnum"
                         onChange={(e) => setForm({ ...form, postalCode: e.target.value })} />
                </Field>
                <Field label="الرقم الإضافي">
                  <Input value={form.additionalNo} className="tnum"
                         onChange={(e) => setForm({ ...form, additionalNo: e.target.value })} />
                </Field>
              </div>
            </div>
          ) : (
            <Field label="العنوان">
              <Textarea value={form.address}
                        onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </Field>
          )}

          <ErrorNote msg={err} />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setModal(null)}>إلغاء</Button>
            <Button onClick={save} disabled={busy || form.name.trim().length < 1}>
              {busy ? "جارِ الحفظ..." : "حفظ"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ══════════ تفاصيل العميل: سيارات + كشف حساب ══════════ */}
      <Modal open={!!detail} size="lg" onClose={() => setDetail(null)} title={detail?.name || ""}>
        {detail && (
          <div className="space-y-3">
            <div className="flex gap-1 border-b border-line">
              <button onClick={() => setDetailTab("vehicles")}
                      className={`-mb-px border-b-2 px-4 py-2 text-[13px] font-bold transition
                        ${detailTab === "vehicles" ? "border-petrol text-petrol" : "border-transparent text-text-dim"}`}>
                السيارات
              </button>
              {canStatement && (
                <button onClick={() => { setDetailTab("statement"); if (!statement) loadStatement(detail.id); }}
                        className={`-mb-px border-b-2 px-4 py-2 text-[13px] font-bold transition
                          ${detailTab === "statement" ? "border-petrol text-petrol" : "border-transparent text-text-dim"}`}>
                  كشف الحساب
                </button>
              )}
            </div>

            {detailTab === "vehicles" && (
              <div className="space-y-3">
                <div className="overflow-x-auto rounded-lg border border-line">
                  <table className="w-full border-collapse text-[12.5px]">
                    <thead>
                      <tr className="bg-ink-3 text-[11.5px] font-extrabold text-text-dim">
                        <th className="px-3 py-2 text-right">اللوحة</th>
                        <th className="px-3 py-2 text-right">الموديل</th>
                        <th className="px-3 py-2 text-right">اللون</th>
                        <th className="w-10 px-2 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {vehicles.length === 0 ? (
                        <tr><td colSpan={4} className="px-3 py-5 text-center text-text-dim">لا توجد سيارات مسجّلة</td></tr>
                      ) : vehicles.map((v) => (
                        <tr key={v.id} className="border-t border-line/70">
                          <td className="px-3 py-2 tnum font-bold">{v.plate}</td>
                          <td className="px-3 py-2">{[v.brand, v.make_model, v.model_year].filter(Boolean).join(" ") || "—"}</td>
                          <td className="px-3 py-2">{v.color || "—"}</td>
                          <td className="px-2 py-2 text-center">
                            {canEdit && (
                              <button onClick={() => removeVehicle(v)} aria-label="حذف"
                                      className="rounded-md px-2 py-1 text-text-dim hover:bg-ember-bg hover:text-ember">✕</button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {canEdit && !showVehicleForm && (
                  <Button variant="ghost" onClick={() => setShowVehicleForm(true)}>+ إضافة سيارة</Button>
                )}
                {canEdit && showVehicleForm && (
                  <div className="space-y-2 rounded-lg border border-line bg-ink-3 p-3">
                    <div className="grid gap-2 sm:grid-cols-3">
                      <Field label="رقم اللوحة">
                        <Input value={vehicleForm.plate} autoFocus className="tnum"
                               onChange={(e) => setVehicleForm({ ...vehicleForm, plate: e.target.value })} />
                      </Field>
                      <Field label="الماركة">
                        <Input value={vehicleForm.brand}
                               onChange={(e) => setVehicleForm({ ...vehicleForm, brand: e.target.value })} />
                      </Field>
                      <Field label="الموديل">
                        <Input value={vehicleForm.makeModel}
                               onChange={(e) => setVehicleForm({ ...vehicleForm, makeModel: e.target.value })} />
                      </Field>
                      <Field label="سنة الصنع">
                        <Input value={vehicleForm.modelYear} className="tnum"
                               onChange={(e) => setVehicleForm({ ...vehicleForm, modelYear: e.target.value })} />
                      </Field>
                      <Field label="اللون">
                        <Input value={vehicleForm.color}
                               onChange={(e) => setVehicleForm({ ...vehicleForm, color: e.target.value })} />
                      </Field>
                      <Field label="رقم الشاصي">
                        <Input value={vehicleForm.chassisNumber} className="tnum"
                               onChange={(e) => setVehicleForm({ ...vehicleForm, chassisNumber: e.target.value })} />
                      </Field>
                    </div>
                    <ErrorNote msg={vehicleErr} />
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" onClick={() => setShowVehicleForm(false)}>إلغاء</Button>
                      <Button onClick={addVehicle} disabled={vehicleForm.plate.trim().length < 1}>حفظ السيارة</Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {detailTab === "statement" && (
              <div className="space-y-3">
                {statement && (
                  <>
                    <div className="flex items-center justify-between rounded-lg bg-ink-3 p-3">
                      <span className="text-[12.5px] font-bold text-text-dim">الرصيد الحالي</span>
                      <div className="flex items-center gap-3">
                        <span className={`tnum text-[16px] font-black ${statement.balance > 0 ? "text-ember" : "text-emerald"}`}>
                          {money(statement.balance)} ر.س
                        </span>
                        <Button variant="ghost" className="!px-2.5 !py-1 !text-[11.5px]" onClick={printStatement}>
                          🖨 طباعة الكشف
                        </Button>
                      </div>
                    </div>

                    <div className="max-h-64 overflow-y-auto rounded-lg border border-line">
                      <table className="w-full border-collapse text-[12px]">
                        <thead>
                          <tr className="bg-ink-3 text-[11px] font-extrabold text-text-dim">
                            <th className="px-3 py-2 text-right">التاريخ</th>
                            <th className="px-3 py-2 text-right">النوع</th>
                            <th className="px-3 py-2 text-right">المرجع</th>
                            <th className="px-3 py-2 text-right">المبلغ</th>
                            <th className="px-3 py-2 text-right">الرصيد</th>
                          </tr>
                        </thead>
                        <tbody>
                          {statement.entries.length === 0 ? (
                            <tr><td colSpan={5} className="px-3 py-5 text-center text-text-dim">لا توجد حركات بعد</td></tr>
                          ) : statement.entries.map((e) => (
                            <tr key={e.id} className="border-t border-line/70">
                              <td className="px-3 py-2 text-text-dim">{dateFmt(e.created_at)}</td>
                              <td className="px-3 py-2">
                                {e.entry_type === "invoice" ? <Badge tone="warn">فاتورة آجل</Badge>
                                  : e.entry_type === "payment" ? <Badge tone="good">سداد</Badge>
                                  : <Badge tone="info">مرتجع</Badge>}
                              </td>
                              <td className="px-3 py-2 tnum">{e.invoice_no || "—"}</td>
                              <td className={`px-3 py-2 tnum font-bold ${e.amount > 0 ? "text-ember" : "text-emerald"}`}>
                                {e.amount > 0 ? "+" : ""}{money(e.amount)}
                              </td>
                              <td className="px-3 py-2 tnum font-bold">{money(e.running_balance)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {canPay && statement.balance > 0 && (
                      <div className="space-y-2 rounded-lg border border-line bg-ink-3 p-3">
                        <p className="text-[12.5px] font-bold">تسجيل سداد</p>
                        <div className="grid gap-2 sm:grid-cols-3">
                          <Field label="المبلغ">
                            <Input type="number" min={0.01} step="0.01" className="tnum" value={payAmount}
                                   onChange={(e) => setPayAmount(e.target.value)} />
                          </Field>
                          <Field label="طريقة السداد">
                            <Select value={payMethod} onChange={(e) => setPayMethod(e.target.value as any)}>
                              <option value="cash">نقدي</option>
                              <option value="card">شبكة</option>
                              <option value="transfer">تحويل</option>
                            </Select>
                          </Field>
                          <Field label="ملاحظة">
                            <Input value={payNote} onChange={(e) => setPayNote(e.target.value)} />
                          </Field>
                        </div>
                        <ErrorNote msg={payErr} />
                        <div className="flex justify-end">
                          <Button onClick={submitPayment}>تسجيل السداد</Button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
