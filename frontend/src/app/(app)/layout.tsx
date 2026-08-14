"use client";
// حارس المصادقة لكل صفحات التطبيق + تركيب الهيكل (هيدر/قائمة جانبية)
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { Shell } from "@/components/Shell";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  if (loading) {
    return <div className="grid min-h-screen place-items-center text-text-dim">جارِ التحقق من الجلسة...</div>;
  }
  if (!user) return null;

  return <Shell>{children}</Shell>;
}
