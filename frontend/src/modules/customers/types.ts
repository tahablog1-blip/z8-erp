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
  balance: number;
  vehicle_count: number;
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
  color: string | null;
  chassis_number: string | null;
  notes: string | null;
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

export const money = (n: number) =>
  Number(n || 0).toLocaleString("ar-SA-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
