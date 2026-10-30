// next.config.mjs — بروكسي داخلي: المتصفح بيكلم Next بس، وNext بيوصّل للباك اند
// 127.0.0.1 بدل localhost عشان نتفادى مشكلة IPv6 على ويندوز (::1 مقابل 127.0.0.1)
const API_URL = process.env.API_URL || "http://127.0.0.1:4001";

// رقم النسخة المبنية (آخر commit) — يظهر أسفل القائمة الجانبية عشان تتأكد إن السيرفر شغّال بآخر تحديث
import { execSync } from "node:child_process";
let BUILD = "dev";
try { BUILD = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { /* */ }

// ── ترويسات الأمان (تنطبق حتى لو لم يضفها nginx) ──
// CSP في وضع Report-Only: تُظهر المخالفات في console المتصفح دون حجب شيء — بعد أسبوع بلا مخالفات حوّلها إلى Content-Security-Policy.
// 'unsafe-inline' مطلوب لسكربتات Next المضمّنة ولسكربت الثيم في layout.tsx.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://api.qrserver.com",
  "media-src 'self' blob: data:",
  "connect-src 'self' ws: wss: https://cdnjs.cloudflare.com",
  "frame-src 'self' blob: data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ");
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // الكاميرا والميكروفون يستخدمهما النظام (لوحة السيارة، تسجيل صوت الحجز) — مسموحان لنفس الأصل فقط
  { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(), payment=(), usb=()" },
  { key: "Strict-Transport-Security", value: "max-age=15552000" },   // 180 يوماً — يُتجاهل على HTTP العادي
  { key: "Content-Security-Policy-Report-Only", value: CSP },
];

const nextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  // deploy.sh يبني في مجلد منفصل (NEXT_DIST_DIR) ثم يبدّله بـ .next بعد نجاح البناء — فتبقى النسخة الشغّالة سليمة لو فشل البناء
  distDir: process.env.NEXT_DIST_DIR || ".next",
  env: { NEXT_PUBLIC_BUILD: BUILD },
  // السماح بفتح المشروع من أي عنوان شبكة محلية (منزل / هوت سبوت موبايل / مكتب)
  // Next 16 بيحظر كل الطلبات (fetch + HMR WebSocket) لو فتحت من IP مش localhost
  allowedDevOrigins: [
    "localhost", "127.0.0.1",
    "192.168.0.*", "192.168.1.*", "192.168.8.*", "192.168.43.*", "192.168.137.*",
    "10.*.*.*", "172.16.*.*", "172.17.*.*", "172.18.*.*", "172.19.*.*", "172.20.*.*",
  ],
  async rewrites() {
    return {
      beforeFiles: [
        { source: "/api/:path*", destination: `${API_URL}/api/:path*` },
      ],
    };
  },
};
export default nextConfig;
