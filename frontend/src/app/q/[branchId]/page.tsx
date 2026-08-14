"use client";
// المسار القديم /q — تحويل دائم لصفحة الحجز الجديدة /booking
import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

export default function LegacyQRedirect() {
  const { branchId } = useParams<{ branchId: string }>();
  const router = useRouter();
  useEffect(() => { router.replace(`/booking/${branchId}`); }, [branchId, router]);
  return <p style={{ textAlign: "center", padding: 40, fontWeight: 700 }}>جارِ التحويل...</p>;
}
