"use client";
// المحادثات اندمجت داخل مركز ملاحظات الخدمة — تحويل للحفاظ على الروابط القديمة
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function ChatsRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/service-notes"); }, [router]);
  return null;
}
