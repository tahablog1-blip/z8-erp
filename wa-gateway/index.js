// wa-gateway/index.js — بوابة واتساب محلية (whatsapp-web.js) لنظام Z8
//
// بتشتغل على نفس السيرفر، والباك اند بيكلمها على 127.0.0.1 بمفتاح سري (x-api-key).
// الجلسة بتتخزّن في WA_DATA_DIR فمايحتاجش مسح QR كل مرة بعد إعادة التشغيل.
//   GET  /status          → { state, number }   state: starting | qr | ready | disconnected
//   GET  /qr              → { qr }              السلسلة النصية للـ QR (الواجهة بترسمها)
//   POST /send            → { to, message }
//   POST /send-document   → { to, filename, b64, caption }
//   POST /logout          → فصل الرقم الحالي لربط رقم تاني
//
// ⚠ whatsapp-web.js غير رسمي: استخدمه برقم مخصّص للشركة وبمعدل رسائل معقول (الحماية
// من الحظر: طابور بفاصل بين الرسائل + حد يومي).
const http = require("http");
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");

const PORT = parseInt(process.env.WA_PORT || "4100", 10);
const API_KEY = process.env.WA_API_KEY || "";
const DATA_DIR = process.env.WA_DATA_DIR || "./.wwebjs_auth";
const MIN_GAP_MS = parseInt(process.env.WA_MIN_GAP_MS || "2500", 10);      // فاصل بين رسالتين
const DAILY_LIMIT = parseInt(process.env.WA_DAILY_LIMIT || "300", 10);     // حد أقصى للرسائل يومياً

if (!API_KEY || API_KEY.length < 16) {
  console.error("WA_API_KEY مطلوب (16 حرف على الأقل) — اتوقّفت البوابة.");
  process.exit(1);
}

let state = "starting";
let lastQr = null;
let number = null;
let client = null;
let restarting = false;

function createClient() {
  const c = new Client({
    authStrategy: new LocalAuth({ dataPath: DATA_DIR }),
    puppeteer: {
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
             "--disable-gpu", "--no-first-run", "--no-zygote"],
    },
  });
  c.on("qr", (qr) => { state = "qr"; lastQr = qr; number = null; console.log("QR جاهز للمسح"); });
  c.on("authenticated", () => { console.log("تم التوثيق"); });
  c.on("auth_failure", (m) => { console.error("فشل التوثيق:", m); state = "disconnected"; scheduleRestart(); });
  c.on("ready", () => {
    state = "ready"; lastQr = null;
    number = c.info && c.info.wid ? c.info.wid.user : null;
    console.log("واتساب جاهز", number || "");
  });
  c.on("disconnected", (reason) => {
    console.error("انقطع الاتصال:", reason);
    state = "disconnected"; lastQr = null; number = null;
    scheduleRestart();
  });
  return c;
}

async function start() {
  state = "starting";
  client = createClient();
  try { await client.initialize(); }
  catch (e) { console.error("تعذّر تشغيل واتساب:", e.message); state = "disconnected"; scheduleRestart(); }
}

function scheduleRestart(delayMs = 15000) {
  if (restarting) return;
  restarting = true;
  setTimeout(async () => {
    try { if (client) await client.destroy(); } catch (_) {}
    restarting = false;
    start();
  }, delayMs);
}

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

async function resolveId(to) {
  const digits = String(to || "").replace(/\D/g, "");
  if (digits.length < 10) { const e = new Error("invalid_number"); e.code = 422; throw e; }
  const id = await client.getNumberId(digits);   // يتأكد إن الرقم عنده واتساب فعلاً
  if (!id) { const e = new Error("not_on_whatsapp"); e.code = 404; throw e; }
  return id._serialized;
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

    if (req.method === "GET" && url === "/status") return send(res, 200, { state, number, sentToday });
    if (req.method === "GET" && url === "/qr") {
      return state === "qr" && lastQr ? send(res, 200, { qr: lastQr }) : send(res, 404, { error: "no_qr", state });
    }
    if (req.method === "POST" && url === "/logout") {
      try { await client.logout(); } catch (_) {}
      state = "disconnected"; scheduleRestart(1000);
      return send(res, 200, { ok: true });
    }
    if (req.method === "POST" && (url === "/send" || url === "/send-document")) {
      if (state !== "ready") return send(res, 503, { error: "not_ready", state });
      const b = await readBody(req);
      const to = await resolveId(b.to);
      if (url === "/send") {
        if (!b.message) return send(res, 422, { error: "empty_message" });
        await enqueue(() => client.sendMessage(to, String(b.message)));
      } else {
        if (!b.b64) return send(res, 422, { error: "empty_document" });
        const media = new MessageMedia("application/pdf", b.b64, b.filename || "document.pdf");
        await enqueue(() => client.sendMessage(to, media, { caption: b.caption || "" }));
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
start();

process.on("SIGTERM", async () => { try { await client.destroy(); } catch (_) {} process.exit(0); });
process.on("unhandledRejection", (e) => console.error("unhandledRejection:", e && e.message));
