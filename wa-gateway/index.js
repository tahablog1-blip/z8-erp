// wa-gateway/index.js — بوابة واتساب محلية لنظام Z8
//
// بتشتغل على نفس السيرفر، والباك اند بيكلمها على 127.0.0.1 بمفتاح سري (x-api-key).
// المحرك الافتراضي: Baileys (اتصال مباشر بدون متصفح). للرجوع للقديم: WA_ENGINE=wwebjs
//   GET  /status          → { state, number, sentToday }   state: starting | qr | ready | disconnected
//   GET  /qr              → { qr }                          السلسلة النصية للـ QR (الواجهة بترسمها)
//   POST /send            → { to, message }
//   POST /send-document   → { to, filename, b64, caption }  (PDF)
//   POST /logout          → فصل الرقم الحالي لربط رقم تاني
//
// ⚠ الاتنين غير رسميين: استخدم رقماً مخصّصاً للشركة وبمعدل رسائل معقول (فاصل بين الرسائل + حد يومي).
const http = require("http");

const PORT = parseInt(process.env.WA_PORT || "4100", 10);
const API_KEY = process.env.WA_API_KEY || "";
const DATA_DIR = process.env.WA_DATA_DIR || "./.wa-session";
const ENGINE = (process.env.WA_ENGINE || "baileys").toLowerCase();
const MIN_GAP_MS = parseInt(process.env.WA_MIN_GAP_MS || "2500", 10);
const DAILY_LIMIT = parseInt(process.env.WA_DAILY_LIMIT || "300", 10);

if (!API_KEY || API_KEY.length < 16) {
  console.error("WA_API_KEY مطلوب (16 حرف على الأقل) — اتوقّفت البوابة.");
  process.exit(1);
}

const engine = ENGINE === "wwebjs"
  ? require("./engines/wwebjs")({ dataDir: DATA_DIR })
  : require("./engines/baileys")({ dataDir: DATA_DIR });
console.log("المحرك:", ENGINE === "wwebjs" ? "whatsapp-web.js" : "baileys");

// ── طابور الإرسال: رسالة واحدة في المرة بفاصل زمني + حد يومي ──
let queue = Promise.resolve();
let sentToday = 0;
let dayKey = new Date().toISOString().slice(0, 10);
function enqueue(job) {
  const run = queue.then(async () => {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== dayKey) { dayKey = today; sentToday = 0; }
    if (sentToday >= DAILY_LIMIT) { const e = new Error("daily_limit"); e.code = 429; throw e; }
    const r = await job();
    sentToday += 1;
    await new Promise((res) => setTimeout(res, MIN_GAP_MS));
    return r;
  });
  queue = run.catch(() => {});
  return run;
}

function readBody(req, limit = 15 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", (d) => { size += d.length; if (size > limit) { reject(Object.assign(new Error("too_large"), { code: 413 })); req.destroy(); } else chunks.push(d); });
    req.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || "{}")); } catch { reject(Object.assign(new Error("bad_json"), { code: 400 })); } });
    req.on("error", reject);
  });
}

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.headers["x-api-key"] !== API_KEY) return send(res, 401, { error: "unauthorized" });
    const url = req.url.split("?")[0];
    const st = engine.getState();

    if (req.method === "GET" && url === "/status") return send(res, 200, { state: st.state, number: st.number, sentToday });
    if (req.method === "GET" && url === "/qr") {
      const qr = engine.getQr();
      return qr ? send(res, 200, { qr }) : send(res, 404, { error: "no_qr", state: st.state });
    }
    if (req.method === "POST" && url === "/logout") { await engine.logout(); return send(res, 200, { ok: true }); }

    if (req.method === "POST" && (url === "/send" || url === "/send-document")) {
      if (st.state !== "ready") return send(res, 503, { error: "not_ready", state: st.state });
      const b = await readBody(req);
      if (url === "/send") {
        if (!b.message) return send(res, 422, { error: "empty_message" });
        await enqueue(() => engine.send(b.to, b.message));
      } else {
        if (!b.b64) return send(res, 422, { error: "empty_document" });
        await enqueue(() => engine.sendDocument(b.to, b.b64, b.filename, b.caption));
      }
      return send(res, 200, { ok: true });
    }
    send(res, 404, { error: "not_found" });
  } catch (e) {
    const code = e.code && Number.isInteger(e.code) ? e.code : 500;
    if (code === 500) console.error("خطأ:", e);
    send(res, code, { error: e.message });
  }
});

server.listen(PORT, "127.0.0.1", () => console.log(`WA gateway على 127.0.0.1:${PORT}`));
engine.start();

process.on("SIGTERM", async () => { try { await engine.stop(); } catch (_) {} process.exit(0); });
process.on("unhandledRejection", (e) => console.error("unhandledRejection:", e && e.message));
