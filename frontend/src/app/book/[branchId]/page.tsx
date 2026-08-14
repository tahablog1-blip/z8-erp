"use client";
// المسار القديم — تحويل دائم للمسار الجديد /booking (حل جذري لأي كاش قديم)
import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

export default function LegacyBookRedirect() {
  const { branchId } = useParams<{ branchId: string }>();
  const router = useRouter();
  useEffect(() => { router.replace(`/booking/${branchId}`); }, [branchId, router]);
  return <p style={{ textAlign: "center", padding: 40, fontWeight: 700 }}>جارِ التحويل...</p>;
}
