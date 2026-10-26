"use client";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { NAV_MODULES } from "@/modules/registry";
import { useDx, type DKey } from "@/lib/dashboard/i18n";
import { Widget } from "../Widget";
import { MIcon } from "@/components/m-icon";

// كل إجراء مربوط بمسار موديول — الظهور = نفس صلاحيات القائمة الجانبية (لا صلاحيات جديدة)
const ACTIONS: { path: string; key: DKey; icon: string }[] = [
  { path: "/sales", key: "qa.service", icon: "directions_car" },
  { path: "/sales/direct", key: "qa.direct", icon: "shopping_cart_checkout" },
  { path: "/purchases", key: "qa.purchase", icon: "shopping_bag" },
  { path: "/customers", key: "qa.customer", icon: "person_add" },
  { path: "/suppliers", key: "qa.supplier", icon: "local_shipping" },
  { path: "/products", key: "qa.product", icon: "add_box" },
  { path: "/treasury", key: "qa.treasury", icon: "payments" },
  { path: "/inventory/stocktake", key: "qa.stocktake", icon: "fact_check" },
  { path: "/reports", key: "qa.salesReport", icon: "bar_chart" },
  { path: "/accounting", key: "qa.journal", icon: "menu_book" },
];

export function QuickActions() {
  const { d } = useDx();
  const { user, hasPerm } = useAuth();
  const allowed = ACTIONS.filter((a) => {
    const m = NAV_MODULES.find((x) => x.path === a.path);
    return m && (m.adminOnly ? user?.role === "admin" : m.permissions.length === 0 || hasPerm(...m.permissions));
  });
  if (!allowed.length) return null;
  return (
    <Widget title={d("qa.title")} icon="bolt">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
        {allowed.map((a) => (
          <Link key={a.path} href={a.path} className="flex min-h-[44px] items-center gap-2 rounded-xl border border-line bg-ink px-3 py-2 text-t-sm font-bold transition hover:border-petrol hover:text-petrol focus-visible:outline focus-visible:outline-2 focus-visible:outline-petrol">
            <MIcon name={a.icon} className="!text-[19px] text-petrol" /><span className="truncate">{d(a.key)}</span>
          </Link>
        ))}
      </div>
    </Widget>
  );
}
