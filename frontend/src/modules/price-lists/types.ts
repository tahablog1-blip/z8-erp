// modules/price-lists/types.ts — عقد قوائم الأسعار المشترك بين شاشة الإدارة وفورم العميل وشاشة البيع

export type PriceList = {
  id: string;
  name: string;
  item_count: number;
  created_at?: string | null;
};

export type PriceListItem = {
  product_id: string;
  name: string;
  category: string;
  spec: string | null;
  barcode: string | null;
  base_price_vat: number;
  price_vat: number;
  is_override: boolean;
};
