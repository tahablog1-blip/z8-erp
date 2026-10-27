// next.config.mjs — بروكسي داخلي: المتصفح بيكلم Next بس، وNext بيوصّل للباك اند
// 127.0.0.1 بدل localhost عشان نتفادى مشكلة IPv6 على ويندوز (::1 مقابل 127.0.0.1)
const API_URL = process.env.API_URL || "http://127.0.0.1:4001";

// رقم النسخة المبنية (آخر commit) — يظهر أسفل القائمة الجانبية عشان تتأكد إن السيرفر شغّال بآخر تحديث
import { execSync } from "node:child_process";
let BUILD = "dev";
try { BUILD = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { /* */ }

const nextConfig = {
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
