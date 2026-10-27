-- tests/schema_min.sql — مخطط أدنى لاختبارات الاستعلامات (أعمدة الجداول التي تقرأها شاشات العملاء والأصناف فقط).
-- ليس نسخة من مخطط الإنتاج؛ لو تغيّر عمود تعتمد عليه الاستعلامات حدّثه هنا.
CREATE TABLE branches (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid, name text, is_active boolean DEFAULT true);
CREATE TABLE users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid, full_name text);
CREATE TABLE customers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid, name text, customer_type text DEFAULT 'individual',
  phone text, email text, vat_number text, cr_number text, is_active boolean DEFAULT true, credit_limit numeric, loyalty_points int DEFAULT 0,
  created_at timestamptz DEFAULT now(), updated_at timestamptz);
CREATE TABLE customer_ledger (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid, customer_id uuid, entry_type text, amount numeric(12,2), invoice_id uuid, note text, created_by uuid, created_at timestamptz DEFAULT now());
CREATE TABLE customer_vehicles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid, customer_id uuid, plate text, plate_type text DEFAULT 'saudi', brand text, make_model text, model_year text,
  car_category text, cylinders text, engine_size text, color text, chassis_number text, notes text, created_at timestamptz DEFAULT now());
CREATE TABLE invoices (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid, branch_id uuid, invoice_no text, source text, customer_id uuid, customer_name text, issued_at timestamptz DEFAULT now(),
  total_ex numeric(12,2), total_inc numeric(12,2), paid_total numeric(12,2), credit_total numeric(12,2) DEFAULT 0, cogs_total numeric(12,2), is_returned boolean DEFAULT false, created_by uuid);
CREATE TABLE invoice_items (id serial PRIMARY KEY, invoice_id uuid, product_id uuid, label text, qty numeric, unit_price_vat numeric, discount_amount numeric DEFAULT 0, line_ex numeric, line_inc numeric);
CREATE TABLE invoice_payments (id serial PRIMARY KEY, invoice_id uuid, company_id uuid, method text, amount numeric, created_at timestamptz DEFAULT now());
CREATE TABLE products (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid, category text DEFAULT '', name text, spec text DEFAULT '', unit text DEFAULT 'قطعة', barcode text, sku text,
  price numeric(12,2) DEFAULT 0, price_vat numeric(12,2) DEFAULT 0, cost_price numeric(12,2) DEFAULT 0, min_qty int DEFAULT 0, service_interval_km int, is_service boolean DEFAULT false,
  is_oil boolean DEFAULT false, is_oil_filter boolean DEFAULT false, oil_brand text, oil_type text, filter_kind text, is_active boolean DEFAULT true, image_base64 text,
  created_at timestamptz DEFAULT now(), updated_at timestamptz);
CREATE TABLE inventory (company_id uuid, loc_type text, loc_id text, product_id uuid, qty int DEFAULT 0, shelf_location text, updated_at timestamptz, UNIQUE (loc_type, loc_id, product_id));
CREATE TABLE stock_moves (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid, move_type text, from_loc_type text, from_loc_id text, to_loc_type text, to_loc_id text, product_id uuid,
  product_label text, qty int, move_no text, note text, supplier_name text, created_by uuid, unit_cost numeric, purchase_invoice_id uuid, created_at timestamptz DEFAULT now());
-- كما في main.py (ensure-schema)
ALTER TABLE customers ADD COLUMN IF NOT EXISTS customer_no BIGSERIAL;
CREATE TABLE customer_notes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL, customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE, note text NOT NULL, created_by uuid, created_at timestamptz NOT NULL DEFAULT now());

-- الجرد: نفس تعريفات main.py (+ unit_cost) وaudit_log بالأعمدة التي يكتبها الكود فعلياً (actor_id/actor_name/scope/details)
CREATE TABLE stocktake_sessions (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL, loc_type VARCHAR NOT NULL, loc_id VARCHAR NOT NULL,
  status VARCHAR NOT NULL DEFAULT 'draft', note TEXT, created_by UUID, created_by_name TEXT, approved_by UUID, approved_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), approved_at TIMESTAMPTZ,
  name TEXT, count_type VARCHAR NOT NULL DEFAULT 'full', category_filter TEXT, submitted_by UUID, submitted_by_name TEXT, submitted_at TIMESTAMPTZ,
  cancelled_by_name TEXT, cancelled_at TIMESTAMPTZ, cancel_reason TEXT, reopen_count INTEGER NOT NULL DEFAULT 0, last_reopen_reason TEXT,
  adjust_in_no TEXT, adjust_out_no TEXT, adjust_note TEXT);
CREATE TABLE stocktake_items (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), session_id UUID NOT NULL REFERENCES stocktake_sessions(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id), snapshot_qty INTEGER NOT NULL DEFAULT 0, counted_qty INTEGER, note TEXT, unit_cost numeric(12,2) NOT NULL DEFAULT 0, item_condition VARCHAR,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (session_id, product_id));
CREATE TABLE audit_log (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL, branch_id UUID, actor_id text, actor_name TEXT, action TEXT NOT NULL,
  scope TEXT, car_id uuid, details TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE stocktake_count_log (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), session_id UUID NOT NULL REFERENCES stocktake_sessions(id) ON DELETE CASCADE, product_id UUID NOT NULL,
  counted_qty INTEGER NOT NULL, item_condition VARCHAR, note TEXT, counted_by UUID, counted_by_name TEXT, counted_at TIMESTAMPTZ NOT NULL DEFAULT now());
