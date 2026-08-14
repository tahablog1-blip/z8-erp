// next.config.mjs — بروكسي داخلي: المتصفح بيكلم Next بس، وNext بيوصّل للباك اند
// 127.0.0.1 بدل localhost عشان نتفادى مشكلة IPv6 على ويندوز (::1 مقابل 127.0.0.1)
const API_URL = process.env.API_URL || "http://127.0.0.1:4001";

const nextConfig = {
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
