-- tests/schema_min.sql — مخطط أدنى لاختبارات الاستعلامات (أعمدة الجداول التي تقرأها شاشات العملاء والأصناف فقط).
-- ليس نسخة من مخطط الإنتاج؛ لو تغيّر عمود تعتمد عليه الاستعلامات حدّثه هنا.
CREATE TABLE branches (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid, name text, is_active boolean DEFAULT true);
CREATE TABLE users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid, full_name text, email text, permissions jsonb DEFAULT '[]'::jsonb, role text DEFAULT 'employee', is_active boolean DEFAULT true, totp_enabled boolean DEFAULT false, locked_until timestamptz);
CREATE TABLE customers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid, name text, customer_type text DEFAULT 'individual',
  phone text, email text, vat_number text, cr_number text, is_active boolean DEFAULT true, credit_limit numeric, loyalty_points int DEFAULT 0,
  created_at timestamptz DEFAULT now(), updated_at timestamptz);
CREATE TABLE customer_ledger (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid, customer_id uuid, entry_type text, amount numeric(12,2), invoice_id uuid, note text, created_by uuid, created_at timestamptz DEFAULT now());
CREATE TABLE customer_vehicles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid, customer_id uuid, plate text, plate_type text DEFAULT 'saudi', brand text, make_model text, model_year text,
  car_category text, cylinders text, engine_size text, color text, chassis_number text, notes text, created_at timestamptz DEFAULT now());
CREATE TABLE invoices (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid, branch_id uuid, invoice_no text, source text, customer_id uuid, customer_name text, issued_at timestamptz DEFAULT now(),
  total_ex numeric(12,2), total_inc numeric(12,2), paid_total numeric(12,2), credit_total numeric(12,2) DEFAULT 0, cogs_total numeric(12,2), is_returned boolean DEFAULT false, created_by uuid, created_at timestamptz DEFAULT now(), qr_tlv text, zatca_status text DEFAULT 'pending', total_vat numeric(12,2) DEFAULT 0, car_id uuid);
CREATE TABLE invoice_items (id serial PRIMARY KEY, invoice_id uuid, product_id uuid, label text, qty numeric, unit_price_vat numeric, discount_amount numeric DEFAULT 0, line_ex numeric, line_vat numeric DEFAULT 0, line_inc numeric);
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

-- الموردون/المشتريات (أعمدة تقرؤها شاشة الموردين فقط)
CREATE TABLE suppliers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid, name text, phone text, vat_number text, address text, payment_terms_days int DEFAULT 0,
  category text, rating numeric, rating_note text, is_active boolean DEFAULT true, created_at timestamptz DEFAULT now(), updated_at timestamptz);
CREATE TABLE purchase_invoices (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid, supplier_id uuid, invoice_no text, supplier_invoice_ref text, invoice_date date DEFAULT CURRENT_DATE,
  payment_terms text, due_date date, subtotal numeric(12,2) DEFAULT 0, vat_total numeric(12,2) DEFAULT 0, total numeric(12,2) DEFAULT 0, paid_total numeric(12,2) DEFAULT 0, status text DEFAULT 'unpaid',
  created_by uuid, created_at timestamptz DEFAULT now());
CREATE TABLE purchase_invoice_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), invoice_id uuid, product_id uuid, product_label text, qty int, unit_cost numeric(12,2), line_total numeric(12,2));
CREATE TABLE supplier_ledger (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid, supplier_id uuid, entry_type text, invoice_id uuid, amount numeric(12,2), note text, created_by uuid, created_at timestamptz DEFAULT now());
CREATE TABLE supplier_payments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid, supplier_id uuid, invoice_id uuid, method text, amount numeric(12,2), note text, created_by uuid, created_at timestamptz DEFAULT now());
CREATE TABLE journal_entries (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid, entry_date date DEFAULT CURRENT_DATE, source_type text, source_id text, branch_id uuid);

-- الموارد البشرية (أعمدة تقرؤها اختبارات HR) — companies/users مبسّطة
CREATE TABLE companies (id uuid PRIMARY KEY, name text, vat_number text, cr_number text,
  gosi_saudi_employee_pct numeric(5,2) NOT NULL DEFAULT 9.75, gosi_saudi_employer_pct numeric(5,2) NOT NULL DEFAULT 11.75, gosi_nonsaudi_employer_pct numeric(5,2) NOT NULL DEFAULT 2.00,
  eos_first_years_months numeric(5,2) NOT NULL DEFAULT 0.5, eos_after_months numeric(5,2) NOT NULL DEFAULT 1, eos_threshold_years numeric(5,2) NOT NULL DEFAULT 5,
  leave_days_before int NOT NULL DEFAULT 21, leave_days_after int NOT NULL DEFAULT 30, leave_threshold_years numeric(5,2) NOT NULL DEFAULT 5, gosi_basis text NOT NULL DEFAULT 'basic');
CREATE TABLE hr_departments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL, name text NOT NULL, is_active boolean NOT NULL DEFAULT TRUE, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (company_id, name));
CREATE TABLE hr_positions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL, name text NOT NULL, department_id uuid, is_active boolean NOT NULL DEFAULT TRUE, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (company_id, name));
CREATE TABLE hr_work_schedules (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL, name text NOT NULL, start_time time NOT NULL, end_time time NOT NULL, grace_minutes int NOT NULL DEFAULT 0, weekly_off int[] NOT NULL DEFAULT '{5}', is_active boolean NOT NULL DEFAULT TRUE, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (company_id, name));
CREATE TABLE hr_employees (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL, branch_id uuid, linked_user_id uuid, full_name text NOT NULL, national_id text, nationality text,
  is_saudi boolean NOT NULL DEFAULT FALSE, birth_date date, phone text, job_title text, contract_type text NOT NULL DEFAULT 'full_time', hire_date date NOT NULL DEFAULT CURRENT_DATE, termination_date date,
  basic_salary numeric(12,2) NOT NULL DEFAULT 0, iban text, iqama_number text, iqama_expiry_date date, is_active boolean NOT NULL DEFAULT TRUE, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  tech_role text, allowances numeric(12,2) NOT NULL DEFAULT 0, approval_pin text, commission_type text NOT NULL DEFAULT 'none', commission_pct numeric(5,2) NOT NULL DEFAULT 0,
  department_id uuid, position_id uuid, manager_id uuid, schedule_id uuid, gender text, email text, address text, gosi_number text, gosi_status text,
  housing_allowance numeric(12,2) NOT NULL DEFAULT 0, transport_allowance numeric(12,2) NOT NULL DEFAULT 0, other_allowance numeric(12,2) NOT NULL DEFAULT 0);
CREATE TABLE hr_attendance (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL, employee_id uuid NOT NULL, work_date date NOT NULL DEFAULT CURRENT_DATE, check_in timestamptz, check_out timestamptz, created_by uuid, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (employee_id, work_date));
CREATE TABLE hr_leave_requests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL, employee_id uuid NOT NULL, leave_type text NOT NULL, start_date date NOT NULL, end_date date NOT NULL, days_count int NOT NULL, reason text, status text NOT NULL DEFAULT 'pending', approved_by uuid, approved_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE hr_violations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL, employee_id uuid NOT NULL, violation_type text, description text, deduction_amount numeric(12,2) NOT NULL DEFAULT 0, violation_date date NOT NULL DEFAULT CURRENT_DATE, issued_by uuid, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE hr_payroll_runs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL, period_month int NOT NULL, period_year int NOT NULL, created_by uuid, created_at timestamptz NOT NULL DEFAULT now(), status text NOT NULL DEFAULT 'draft', finalized_at timestamptz, paid_at timestamptz, paid_by uuid, payment_method text, UNIQUE (company_id, period_month, period_year));
CREATE TABLE hr_payslips (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), payroll_run_id uuid NOT NULL, employee_id uuid NOT NULL, basic_salary numeric(12,2) NOT NULL DEFAULT 0, allowances numeric(12,2) NOT NULL DEFAULT 0, other_deductions numeric(12,2) NOT NULL DEFAULT 0, violations_deduction numeric(12,2) NOT NULL DEFAULT 0, gosi_employee numeric(12,2) NOT NULL DEFAULT 0, gosi_employer numeric(12,2) NOT NULL DEFAULT 0, net_pay numeric(12,2) NOT NULL DEFAULT 0, advance_deduction numeric(12,2) NOT NULL DEFAULT 0, commission_amount numeric(12,2) NOT NULL DEFAULT 0);
CREATE TABLE hr_custody_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL, employee_id uuid NOT NULL, item_name text NOT NULL, description text, estimated_value numeric(12,2) NOT NULL DEFAULT 0, assigned_date date NOT NULL DEFAULT CURRENT_DATE, returned_date date, status text NOT NULL DEFAULT 'held', notes text, created_by uuid, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE hr_employee_requests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL, employee_id uuid NOT NULL, request_type text NOT NULL, title text, details jsonb NOT NULL DEFAULT '{}'::jsonb, status text NOT NULL DEFAULT 'pending', decided_by uuid, decided_at timestamptz, decision_note text, created_by uuid, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE hr_contracts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL, employee_id uuid NOT NULL, contract_type text NOT NULL DEFAULT 'full_time', start_date date NOT NULL, end_date date, basic_salary numeric(12,2) NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'active', notes text, created_by uuid, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE hr_documents (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL, employee_id uuid NOT NULL, doc_type text NOT NULL, doc_number text, issue_date date, expiry_date date, notes text, created_by uuid, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE hr_leave_types (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL, code text NOT NULL, name text NOT NULL, annual_days int, is_paid boolean NOT NULL DEFAULT TRUE, is_active boolean NOT NULL DEFAULT TRUE, UNIQUE (company_id, code));
CREATE TABLE hr_employee_history (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL, employee_id uuid NOT NULL, event_type text NOT NULL, detail jsonb NOT NULL DEFAULT '{}'::jsonb, reason text, actor_id text, actor_name text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE employee_advances (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid, employee_id uuid, amount numeric(12,2), installment numeric(12,2), status text DEFAULT 'active', created_at timestamptz DEFAULT now());
CREATE TABLE advance_repayments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), advance_id uuid, amount numeric(12,2), source text, voucher_id uuid, payroll_run_id uuid);
CREATE TABLE invoice_returns (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid, branch_id uuid, invoice_id uuid, return_no text, total_ex numeric(12,2), total_vat numeric(12,2) DEFAULT 0, total_inc numeric(12,2) DEFAULT 0, note text, created_at timestamptz DEFAULT now());
CREATE TABLE company_settings (company_id uuid NOT NULL, key text NOT NULL, value text NOT NULL, PRIMARY KEY (company_id, key));
CREATE TABLE treasury_vouchers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid, branch_id uuid, voucher_no text, type text, amount numeric(12,2), method text, category text, status text DEFAULT 'active', created_at timestamptz DEFAULT now());
CREATE TABLE accounts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid, code text, name text, type text);
CREATE TABLE journal_lines (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), entry_id uuid, account_id uuid, debit numeric(12,2) DEFAULT 0, credit numeric(12,2) DEFAULT 0);
CREATE TABLE cars (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid, brand text, name text, model_year text);
CREATE TABLE user_sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, company_id uuid, created_at timestamptz DEFAULT now(), last_seen_at timestamptz DEFAULT now(), revoked_at timestamptz);
CREATE TABLE integration_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid, provider text, event text, status text, detail text, created_at timestamptz DEFAULT now());
CREATE TABLE roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid, name text);
