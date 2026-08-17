"use client";
// الإعدادات ← الطباعة — صفحة كاملة
import { useEffect, useState } from "react";
import { Button, Card, Field, Input } from "@/components/ui";

export default function PrintingSettingsPage() {
  const [autoPrint, setAutoPrint] = useState(true);
  const [footer, setFooter] = useState("شكراً لتعاملكم معنا");
  const [prOk, setPrOk] = useState("");

  useEffect(() => {
    try {
      setAutoPrint(localStorage.getItem("z8_print_auto") !== "off");
      setFooter(localStorage.getItem("z8_print_footer") || "شكراً لتعاملكم معنا");
    } catch { /* */ }
  }, []);

  function savePrinting() {
    localStorage.setItem("z8_print_auto", autoPrint ? "on" : "off");
    localStorage.setItem("z8_print_footer", footer.trim() || "شكراً لتعاملكم معنا");
    setPrOk("تم الحفظ — الفواتير الجاية هتطبق الإعدادات دي");
  }

  return (
    <div className="space-y-4">
      <h1 className="text-[19px] font-extrabold">الإعدادات — الطباعة</h1>
      <Card>
        <div className="max-w-xl space-y-4">
          <label className="flex cursor-pointer items-center justify-between rounded-lg border border-line p-3">
            <div>
              <div className="text-[13px] font-bold">الطباعة التلقائية عند إصدار الفاتورة</div>
              <div className="text-[11.5px] text-text-dim">نافذة الطباعة الحرارية تفتح لوحدها فور الإصدار</div>
            </div>
            <input type="checkbox" checked={autoPrint} className="h-4 w-4 accent-petrol"
                   onChange={(e) => setAutoPrint(e.target.checked)} />
          </label>
          <Field label="نص أسفل الفاتورة (التذييل)">
            <Input value={footer} onChange={(e) => setFooter(e.target.value)} />
          </Field>
          <div className="rounded-lg bg-ink-3 p-3 text-[12px] text-text-dim">
            صيغ الطباعة المتاحة في كل النظام: <b>حراري 80مم</b> للكاشير والتذاكر، و<b>A4 رسمي</b> للفواتير الضريبية والتقارير وكشوف الحساب — الاختيار بيظهر عند عرض أي فاتورة.
          </div>
          {prOk && <p className="text-[12.5px] font-bold text-emerald">{prOk}</p>}
          <div className="flex justify-end">
            <Button onClick={savePrinting}>حفظ إعدادات الطباعة</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
