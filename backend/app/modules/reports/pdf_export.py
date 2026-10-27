# modules/reports/pdf_export.py — تصدير التقارير PDF من الخادم (A4 عربي RTL)
# المحرك نفسه المستخدم في فاتورة PDF (WeasyPrint) مع احتياطي fpdf2 لو لم يتوفر.
# الأمان: التصدير = نفس صلاحيات العرض (فهرس مركز التقارير) ويعيد تشغيل نفس دوال التقرير على الخادم،
# فلا يخرج في الملف رقم لا يراه المستخدم على الشاشة (مثلاً التكلفة والربح لغير المخوّل).
import datetime as dt
import html as _h

from fastapi import HTTPException

from ...core.db import execute, fetchrow
from . import center, detail

_M = lambda v: "—" if v is None else f"{float(v):,.2f}"
_N = lambda v: "—" if v is None else f"{float(v):,.0f}"
_D = lambda v: "—" if not v else (v.date().isoformat() if hasattr(v, "date") else str(v)[:10])


def _kpis(*items):
    return {"kpis": [{"label": l, "value": v} for l, v in items]}


def _table(heading, headers, rows, num=()):
    return {"heading": heading, "headers": headers, "rows": rows, "num": list(num)}


# كل باني يعيد (عنوان، meta، أقسام). الأقسام: kpis أو جدول.
async def _payment_methods(user, p):
    d = await center.payment_methods(user, p.get("from"), p.get("to"), p.get("branchId"))
    return "المبيعات حسب طريقة الدفع", d["meta"], [
        _kpis(("الإجمالي", _M(d["totals"]["amount"])), ("العمليات", _N(d["totals"]["count"]))),
        _table("طرق الدفع", ["الطريقة", "القيمة", "العمليات", "النسبة %"], [[r["label"], _M(r["amount"]), _N(r["count"]), r["sharePct"]] for r in d["rows"]], (1, 2, 3)),
    ], d["note"]


async def _purchases(user, p):
    d = await center.purchases_report(user, p.get("from"), p.get("to"), p.get("supplierId"))
    t = d["totals"]
    return "تقرير المشتريات", d["meta"], [
        _kpis(("الإجمالي", _M(t["total"])), ("الضريبة", _M(t["vat"])), ("المدفوع", _M(t["paid"])), ("المتبقي", _M(t["remaining"]))),
        _table("حسب المورد", ["المورد", "الفواتير", "الإجمالي", "المدفوع", "المتبقي"], [[r["name"], _N(r["n"]), _M(r["total"]), _M(r["paid"]), _M(r["remaining"])] for r in d["bySupplier"]], (1, 2, 3, 4)),
        _table("حسب الشهر", ["الشهر", "الفواتير", "الضريبة", "الإجمالي"], [[r["month"], _N(r["n"]), _M(r["vat"]), _M(r["total"])] for r in d["byMonth"]], (1, 2, 3)),
    ], d["note"]


async def _treasury(user, p):
    d = await center.treasury_report(user, p.get("from"), p.get("to"), p.get("branchId"))
    t = d["totals"]
    T = lambda x: "قبض" if x == "receipt" else "صرف"
    return "حركة الخزينة", d["meta"], [
        _kpis(("المقبوضات", _M(t["receipts"])), ("المدفوعات", _M(t["payments"])), ("الصافي", _M(t["net"])), ("السندات", _N(t["count"]))),
        _table("حسب التصنيف", ["النوع", "التصنيف", "العدد", "المبلغ"], [[T(r["type"]), r["category"], _N(r["count"]), _M(r["amount"])] for r in d["byCategory"]], (2, 3)),
        _table("حسب الفرع", ["الفرع", "المقبوضات", "المدفوعات", "الصافي"], [[r["branch"], _M(r["receipts"]), _M(r["payments"]), _M(r["net"])] for r in d["byBranch"]], (1, 2, 3)),
    ], d["note"]


async def _zatca(user, p):
    d = await center.zatca_status(user, p.get("from"), p.get("to"), p.get("branchId"))
    t = d["totals"]
    return "حالة الفواتير الضريبية", d["meta"], [
        _kpis(("الفواتير", _N(t["invoices"])), ("QR موجود", _N(t["withQr"])), ("QR غير موجود", _N(t["withoutQr"]))),
        _table("حسب الحالة المسجّلة", ["الحالة", "الفواتير"], [[r["status"], _N(r["n"])] for r in d["byStatus"]], (1,)),
        _table("فواتير بلا QR (آخر 50)", ["الفاتورة", "التاريخ", "الإجمالي", "الحالة"], [[r["invoiceNo"], _D(r["issuedAt"]), _M(r["total"]), r["status"]] for r in d["missingQr"]], (2,)),
    ], d["note"]


async def _sales_breakdown(user, p):
    dim = p.get("dim") or "product"
    d = await detail.sales_breakdown(user, p.get("from"), p.get("to"), p.get("branchId"), dim, p.get("compare") or None)
    labels = {"product": "الصنف", "category": "التصنيف", "brand": "العلامة", "branch": "الفرع", "employee": "الموظف", "customer": "العميل", "car_brand": "علامة السيارة", "car_model": "موديل السيارة", "day": "اليوم", "month": "الشهر"}
    t = d["totals"]
    hdr = [labels[dim], "المبيعات", "الكمية", "الفواتير"] + (["التكلفة", "الربح", "الهامش %"] if d["canCost"] else [])
    rows = [[r["label"], _M(r["revenue"]), _N(r["qty"]), _N(r["invoices"])] + ([_M(r.get("cogs")), _M(r.get("grossProfit")), r.get("marginPct") if r.get("marginPct") is not None else "—"] if d["canCost"] else []) for r in d["rows"]]
    ks = [("المبيعات (قبل الضريبة)", _M(t["revenue"])), ("مرتجعات جزئية", _M(t["returnsEx"])), ("صافي المبيعات", _M(t["netRevenue"])), ("الفواتير", _N(t["invoices"]))]
    if d["canCost"] and t.get("grossProfit") is not None:
        ks.append(("مجمل الربح", _M(t["grossProfit"])))
    if d.get("compare") and d["compare"]["revenue"]["pct"] is not None:
        ks.append(("التغيّر عن الفترة المقارنة", f'{d["compare"]["revenue"]["pct"]:+.1f}%'))
    return f"تحليل المبيعات حسب {labels[dim]}", d["meta"], [_kpis(*ks), _table("التفاصيل", hdr, rows, range(1, len(hdr)))], d["note"]


async def _returns(user, p):
    d = await detail.returns_report(user, p.get("from"), p.get("to"), p.get("branchId"))
    t = d["totals"]
    return "تقرير المرتجعات", d["meta"], [
        _kpis(("الإجمالي", _M(t["totalInc"])), ("جزئية", f'{_N(t["partialCount"])} / {_M(t["partialInc"])}'), ("كاملة", f'{_N(t["fullCount"])} / {_M(t["fullInc"])}')),
        _table("التفاصيل", ["النوع", "الفاتورة", "التاريخ", "الفرع", "الإجمالي"], [["كامل" if r["kind"] == "full" else "جزئي", r["invoiceNo"], _D(r["at"]), r["branch"], _M(r["totalInc"])] for r in d["rows"]], (4,)),
    ], d["note"]


async def _stock(user, p):
    d = await detail.stock_movements_report(user, p.get("from"), p.get("to"), p.get("branchId"))
    return "حركة المخزون", d["meta"], [
        _kpis(("إجمالي الحركات", _N(d["totals"]["count"])), *[(t["label"], _N(t["count"])) for t in d["byType"]]),
        _table("الأصناف الأكثر حركة", ["الصنف", "الحركات", "إجمالي الكمية"], [[r["name"], _N(r["count"]), _N(r["qty"])] for r in d["topProducts"]], (1, 2)),
    ], d["note"]


async def _hr(user, p):
    d = await detail.hr_report(user, p.get("from"), p.get("to"), p.get("branchId"))
    h, a = d["headcount"], d["attendance"]
    mm = lambda m: f"{m // 60}:{m % 60:02d}"
    sec = [_kpis(("الموظفون", _N(h["total"])), ("سعودي", _N(h["saudi"])), ("غير سعودي", _N(h["nonSaudi"])), ("أيام الحضور", _N(a["daysPresent"])), ("أيام التأخير", _N(a["lateDays"])), ("الإضافي (س:د)", mm(a["overtimeMinutes"]))),
           _table("الموظفون حسب الفرع", ["الفرع", "العدد"], [[r["name"], _N(r["count"])] for r in h["byBranch"]], (1,)),
           _table("الموظفون حسب القسم", ["القسم", "العدد"], [[r["name"], _N(r["count"])] for r in h["byDepartment"]], (1,))]
    if d["payroll"]:
        sec.append(_table("مسيرات الرواتب", ["الشهر", "القسائم", "الأساسي", "البدلات", "الخصومات", "السلف", "الصافي"],
                          [[f'{r["month"]}/{r["year"]}', _N(r["slips"]), _M(r["basic"]), _M(r["allowances"]), _M(r["deductions"]), _M(r["advances"]), _M(r["net"])] for r in d["payroll"]], range(1, 7)))
    return "تقارير الموارد البشرية", d["meta"], sec, d["note"]


async def _recon(user, p):
    d = await detail.reconciliation(user, p.get("from"), p.get("to"), p.get("branchId"))
    sec = [_table("نتيجة الفحص", ["البند", "من الفواتير/الحركة", "من الأستاذ/المخزون", "الفرق", "الحالة"],
                  [[c["label"], _M(c["invoices"]), _M(c["ledger"]), _M(c["diff"]), "غير قابل للمقارنة" if c["ok"] is None else ("مطابق" if c["ok"] else "فرق")] for c in d["checks"]], (1, 2, 3))]
    return "فحص التسوية", d["meta"], sec, (d["warning"] or "") + " " + d["note"]


EXPORTERS = {
    "payment-methods": _payment_methods, "purchases": _purchases, "treasury-report": _treasury, "zatca-status": _zatca,
    "sales-breakdown": _sales_breakdown, "returns": _returns, "stock-movements": _stock, "hr-report": _hr, "reconciliation": _recon,
}

_CSS = """
@page { size: A4; margin: 14mm 12mm 16mm; @bottom-center { content: "Z8 ERP — صفحة " counter(page) " من " counter(pages); font-size: 8.5pt; color:#667; } }
* { box-sizing: border-box; } body { font-family: 'IBM Plex Sans Arabic','Noto Naskh Arabic','Noto Sans Arabic',Tahoma,'DejaVu Sans',sans-serif; font-size: 10pt; color:#111; direction: rtl; }
.head { border-bottom: 2px solid #1E3A8A; padding-bottom: 6px; margin-bottom: 8px; display:flex; justify-content:space-between; align-items:flex-end; }
h1 { font-size: 16pt; color:#1E3A8A; margin:0; } .co { font-size: 10pt; color:#445; } .meta { font-size: 8.5pt; color:#556; margin-bottom: 10px; line-height: 1.7; }
.kpis { display:flex; flex-wrap:wrap; gap:6px; margin: 8px 0; } .kpi { flex:1; min-width: 28mm; border:1px solid #c9d4d6; border-radius:6px; padding:6px; text-align:center; }
.kpi b { display:block; font-size: 11.5pt; direction:ltr; } .kpi span { font-size: 8pt; color:#556; }
h2 { font-size: 11pt; margin: 12px 0 5px; border-right: 4px solid #1E3A8A; padding-right: 7px; }
table { width:100%; border-collapse: collapse; } th { background:#eef3f4; border:1px solid #c9d4d6; padding:4px 6px; font-size: 8.5pt; text-align:right; }
td { border:1px solid #dbe3e4; padding:3px 6px; font-size: 8.5pt; } td.n { direction:ltr; text-align:left; font-variant-numeric: tabular-nums; } tr { page-break-inside: avoid; } thead { display: table-header-group; }
.note { margin-top: 10px; font-size: 8pt; color:#667; border-top: 1px dashed #ccc; padding-top: 5px; }
"""


def _html(title: str, company: str, meta_lines: list[str], sections: list[dict], note: str) -> str:
    e = _h.escape
    out = [f'<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><style>{_CSS}</style></head><body>',
           f'<div class="head"><div><h1>{e(title)}</h1><div class="co">{e(company)}</div></div></div>',
           '<div class="meta">' + "<br>".join(e(x) for x in meta_lines) + "</div>"]
    for s in sections:
        if "kpis" in s:
            out.append('<div class="kpis">' + "".join(f'<div class="kpi"><b>{e(str(k["value"]))}</b><span>{e(k["label"])}</span></div>' for k in s["kpis"]) + "</div>")
        else:
            num = set(s["num"])
            out.append(f'<h2>{e(s["heading"])}</h2>')
            if not s["rows"]:
                out.append('<p class="meta">لا توجد بيانات للفترة.</p>'); continue
            out.append("<table><thead><tr>" + "".join(f"<th>{e(h)}</th>" for h in s["headers"]) + "</tr></thead><tbody>")
            for r in s["rows"]:
                out.append("<tr>" + "".join(f'<td class="{"n" if i in num else ""}">{e(str(c))}</td>' for i, c in enumerate(r)) + "</tr>")
            out.append("</tbody></table>")
    if note.strip():
        out.append(f'<div class="note">{e(note.strip())}</div>')
    out.append("</body></html>")
    return "".join(out)


def _fallback_pdf(title, company, meta_lines, sections, note) -> bytes:
    """احتياطي fpdf2 (بلا WeasyPrint): نص وجداول بسيطة — نفس نهج فاتورة PDF القديمة"""
    import arabic_reshaper
    from bidi.algorithm import get_display
    from fpdf import FPDF
    rtl = lambda s: get_display(arabic_reshaper.reshape(str(s or "")))
    font = next((p for p in (r"C:\Windows\Fonts\tahoma.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf") if __import__("os").path.exists(p)), None)
    if not font:
        raise RuntimeError("خط عربي غير متاح")
    pdf = FPDF(format="A4"); pdf.set_auto_page_break(True, 14); pdf.add_page(); pdf.add_font("A", "", font); pdf.set_font("A", "", 11)
    w = pdf.w - 20
    def line(txt, size=10, h=6):
        pdf.set_font("A", "", size); pdf.set_x(10); pdf.multi_cell(w, h, rtl(txt), align="R", new_x="LMARGIN", new_y="NEXT")
    line(title, 15, 9); line(company, 10)
    for m in meta_lines: line(m, 8.5, 5)
    for s in sections:
        if "kpis" in s:
            line("  |  ".join(f'{k["label"]}: {k["value"]}' for k in s["kpis"]), 9.5, 6); continue
        line(s["heading"], 11.5, 8)
        if not s["rows"]: line("لا توجد بيانات للفترة.", 9); continue
        cw = w / len(s["headers"])
        pdf.set_font("A", "", 8.5)
        for row in [s["headers"]] + s["rows"]:
            for c in reversed(row):
                pdf.cell(cw, 5.5, rtl(str(c))[:34], border=1, align="R")
            pdf.ln(5.5)
    if note.strip(): line(note.strip(), 8, 5)
    return bytes(pdf.output())


async def build(user, report_id: str, params: dict) -> tuple[bytes, str]:
    r = next((x for x in center.CATALOG if x["id"] == report_id), None)
    if not r or report_id not in EXPORTERS or not center._allowed(user, r):
        raise HTTPException(404, "التقرير غير موجود أو غير قابل للتصدير")
    title, meta, sections, note = await EXPORTERS[report_id](user, params)
    co = await fetchrow("SELECT name AS n FROM companies WHERE id=$1", user.company_id)
    company = (co["n"] if co else "") or ""
    riyadh_now = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=3)).strftime("%Y-%m-%d %H:%M")
    meta_lines = [f'الفترة: {meta["from"]} → {meta["to"]}   |   الفرع: {"فرع المستخدم" if meta.get("branchLocked") else ("فرع محدد" if meta.get("branchId") else "كل الفروع")}',
                  f'أُنشئ: {riyadh_now} (توقيت الرياض)   |   بواسطة: {user.full_name or user.email}']
    if r["sensitive"]:
        try:
            await execute("INSERT INTO audit_log (company_id, actor_id, actor_name, action, scope, details) VALUES ($1,$2,$3,'report_export','reports',$4)",
                          user.company_id, user.user_id, user.full_name or user.email, f"{report_id} pdf")
        except Exception as ex:
            print(f"⚠ report export audit: {ex}")
    try:
        from weasyprint import HTML
        pdf = HTML(string=_html(title, company, meta_lines, sections, note)).write_pdf()
    except ImportError:
        pdf = _fallback_pdf(title, company, meta_lines, sections, note)
    return pdf, f"{report_id}-{meta['from']}_{meta['to']}.pdf"
