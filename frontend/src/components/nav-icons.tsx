// components/nav-icons.tsx — أيقونات القائمة: Material Symbols Rounded (المكتبة الموحدة)
import { MIcon } from "@/components/m-icon";

const MAP: Record<string, string> = {
  // الشاشات
  dashboard: "space_dashboard",
  sales: "point_of_sale",
  invoices: "receipt_long",
  car: "directions_car",
  customers: "group",
  products: "inventory_2",
  inventory: "warehouse",
  suppliers: "local_shipping",
  purchases: "shopping_bag",
  treasury: "account_balance_wallet",
  accounting: "calculate",
  reports: "monitoring",
  branches: "storefront",
  hr: "badge",
  settings: "settings",
  // الأقسام
  sec_ops: "bolt",
  sec_stock: "package_2",
  sec_finance: "payments",
  sec_admin: "admin_panel_settings",
};

export function NavIcon({ name, className = "" }: { name: string; className?: string }) {
  return <MIcon name={MAP[name] || "circle"} className={`msr-20 ${className}`} />;
}
