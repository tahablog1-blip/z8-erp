"use client";
// lib/dashboard/useExecutive.ts — طلب واحد /reports/executive بفترة وفرع، مع:
//   • كاش قصير (stale-while-revalidate): تبديل الفلتر لحالة سبق تحميلها يظهر فوراً ويتحدّث بالخلفية
//   • إلغاء الطلب القديم عند تغيّر الفلتر (ما يكتبش فوق الجديد)
//   • تحديث تلقائي كل 60 ثانية والتبويب ظاهر، وتحديث عند الرجوع للتبويب
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { Executive } from "./types";

const cache = new Map<string, { at: number; data: Executive }>();
const TTL = 60_000;

export function useExecutive(from: string, to: string, branchId: string | null) {
  const key = `${from}|${to}|${branchId ?? ""}`;
  const [data, setData] = useState<Executive | null>(() => cache.get(key)?.data ?? null);
  const [loading, setLoading] = useState(!cache.get(key));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const ctl = useRef<AbortController | null>(null);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    ctl.current?.abort();
    const c = new AbortController(); ctl.current = c;
    if (opts?.silent) setRefreshing(true); else if (!cache.get(key)) setLoading(true);
    setError("");
    try {
      const qs = new URLSearchParams({ from, to });
      if (branchId) qs.set("branchId", branchId);
      const d = await api<Executive>(`/reports/executive?${qs}`, { signal: c.signal });
      cache.set(key, { at: Date.now(), data: d });
      setData(d);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setError(e instanceof Error ? e.message : "تعذّر تحميل لوحة القيادة");
    } finally {
      if (ctl.current === c) { setLoading(false); setRefreshing(false); }
    }
  }, [key, from, to, branchId]);

  useEffect(() => {
    const hit = cache.get(key);
    setData(hit?.data ?? null);
    setLoading(!hit);
    load({ silent: !!hit && Date.now() - hit.at < TTL });
    return () => ctl.current?.abort();
  }, [key, load]);

  useEffect(() => {
    const tick = setInterval(() => { if (!document.hidden) load({ silent: true }); }, 60_000);
    const onVis = () => { if (!document.hidden) load({ silent: true }); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(tick); document.removeEventListener("visibilitychange", onVis); };
  }, [load]);

  return { data, loading, refreshing, error, reload: () => load({ silent: !!data }) };
}
