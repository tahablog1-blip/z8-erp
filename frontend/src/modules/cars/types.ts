// modules/cars/types.ts — عقود السيارة المشتركة بين الشاشات
export type Car = {
  id: string;
  branch_id: string;
  plate: string | null;
  plate_type: string | null;
  name: string | null;
  model_year: string | null;
  brand: string | null;
  color: string | null;
  chassis_number: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_id: string | null;
  station: string | null;
  odometer_current: number | null;
  odometer_previous: number | null;
  notes: string | null;
  registrar_name: string | null;
  entered_at: string | null;
  exited_at: string | null;
  created_at: string;
  checklist: { key: string; label: string; status: string; note: string | null }[] | null;
};

export type TimelineStep = {
  step: "registered" | "entered" | "exited" | "invoiced";
  label: string;
  at: string | null;
  by?: string | null;
  ref?: string | null;
};

export type BillingQueueRow = Car & {
  branch_name: string | null;
  invoice_id: string | null;
  invoice_no: string | null;
  invoice_total: number | null;
  brand: string | null;
  name: string | null;
  model_year: string | null;
  entered_at: string | null;
  exited_at: string | null;
  queue_no: number;
  timeline: TimelineStep[];
  prepared_items?: { productId: string | null; label: string; qty: number; unitPrice: number; unitPriceVat: number; isService: boolean }[] | null;
  work_status?: "queued" | "preparing" | "ready" | "invoiced";  // ماكينة حالات أمر العمل
  prepared_by_name?: string | null;                              // موظف الإعداد اللي أكّد
  customer_id?: string | null;
  notes?: string | null;
};

export function carStatus(c: Car): "queued" | "in_service" | "done" {
  if (c.exited_at) return "done";
  if (c.entered_at) return "in_service";
  return "queued";
}
