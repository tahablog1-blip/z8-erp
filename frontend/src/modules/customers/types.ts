// modules/customers/types.ts — عقود العميل المشتركة بين الشاشات
export type Customer = {
  id: string;
  name: string;
  customer_type: "individual" | "company";
  phone: string | null;
  email: string | null;
  vat_number: string | null;
  cr_number: string | null;
  address: string | null;
  building_no: string | null;
  street: string | null;
  district: string | null;
  city: string | null;
  postal_code: string | null;
  additional_no: string | null;
  credit_limit: number | null;
  price_list_id: string | null;
  contract_discount_pct: number | null;
  contract_valid_from: string | null;
  contract_valid_until: string | null;
  contract_notes: string | null;
  loyalty_points: number;
  balance: number;
  vehicle_count: number;
  created_at?: string | null;
};

export type Vehicle = {
  id: string;
  customer_id: string;
  plate: string;
  plate_type: "saudi" | "other";
  brand: string | null;
  make_model: string | null;
  model_year: string | null;
  car_category: string | null;
  cylinders: string | null;
  engine_size: string | null;
  color: string | null;
  chassis_number: string | null;
  notes: string | null;
  name?: string | null;
  fuel_type?: string | null;
  last_odometer?: number | null;
  service_type?: string | null;
};

export type LedgerEntry = {
  id: string;
  entry_type: "invoice" | "payment" | "return";
  invoice_id: string | null;
  invoice_no: string | null;
  amount: number;
  note: string | null;
  created_at: string;
  running_balance: number;
};

export type Statement = {
  customer: Customer;
  entries: LedgerEntry[];
  balance: number;
};

// تنسيق الأرقام يحترم إعداد "تنسيق الأرقام" بالنظام (لاتينية/عربية هندية) — راجع lib/format.ts
export { money } from "@/lib/format";
