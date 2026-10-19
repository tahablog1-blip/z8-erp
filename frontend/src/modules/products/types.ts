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
  sku: string | null;
  price: number;
  price_vat: number;
  cost_price: number;
  min_qty: number;
  stock_qty?: number | null;
  has_image?: boolean;
  service_interval_km: number | null;
  is_service: boolean;
  is_oil: boolean;
  is_oil_filter: boolean;
  is_active: boolean;
  oil_brand: string | null;
  oil_type: string | null;
  filter_kind: string | null;
  brand: string | null;
  model: string | null;
  year_from: number | null;
  year_to: number | null;
  counts?: Record<string, number> | null;
  price_overridden?: boolean;
  qty_discount_rules?: { min_qty: number; discount_percent: number }[];
};

export type ProductLink = {
  id: string;
  linkType: "substitute" | "related";
  productId: string;
  category: string;
  name: string;
  spec: string | null;
  price: number;
  stock_qty: number;
};
/** وصف الصنف الكامل بسطر واحد — نفس الصيغة المخزّنة في السندات والفواتير */
export function productLabel(p: Pick<Product, "category" | "name" | "spec">) {
  return [p.category, p.name, p.spec].filter(Boolean).join(" — ");
}

// تنسيق الأرقام يحترم إعداد "تنسيق الأرقام" بالنظام (لاتينية/عربية هندية) — راجع lib/format.ts
export { money } from "@/lib/format";
