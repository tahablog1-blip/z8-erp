// modules/products/types.ts — عقد الصنف المشترك بين الشاشات
// متحطّ هنا مش جوه page.tsx عن قصد: Next.js بيرفض أي export غير متوقع من ملف صفحة،
// وكمان شاشة المخزون ومحرّر السندات محتاجين نفس النوع من غير ما يعتمدوا على شاشة الأصناف.

export type Product = {
  id: string;
  category: string;
  name: string;
  spec: string | null;
  unit: string | null;
  barcode: string | null;
  price: number;
  price_vat: number;
  cost_price: number;
  min_qty: number;
  service_interval_km: number | null;
  is_service: boolean;
  is_oil: boolean;
  is_oil_filter: boolean;
  oil_brand: string | null;
};

/** وصف الصنف الكامل بسطر واحد — نفس الصيغة المخزّنة في السندات والفواتير */
export function productLabel(p: Pick<Product, "category" | "name" | "spec">) {
  return [p.category, p.name, p.spec].filter(Boolean).join(" — ");
}

/** تنسيق المبالغ — خانتين عشريتين دايماً عشان أعمدة الأرقام تتراص */
export const money = (n: number) =>
  Number(n || 0).toLocaleString("ar-SA-u-nu-latn", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
