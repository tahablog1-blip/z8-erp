"use client";
// الإعدادات — الموجّه: أي رابط قديم لـ /settings يتحول لأول صفحة مسموح بها
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";

export default function SettingsIndex() {
  const router = useRouter();
  const { hasPerm } = useAuth();
  useEffect(() => {
    router.replace(
      hasPerm("settings.company") ? "/settings/company"
      : hasPerm("settings.users") ? "/settings/users"
      : "/settings/printing"
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
