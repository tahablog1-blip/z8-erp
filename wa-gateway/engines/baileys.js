// engines/baileys.js — اتصال مباشر بواتساب (بدون متصفح) عبر Baileys.
// إرسال المستندات (PDF) جزء أساسي من البروتوكول هنا، فمش بيعتمد على واجهة واتساب ويب.
const fs = require("fs");
const path = require("path");

const fail = (msg, code) => Object.assign(new Error(msg), { code });

module.exports = function createBaileysEngine({ dataDir }) {
  const authDir = path.resolve(dataDir, "baileys");
  let sock = null;
  let state = "starting";
  let lastQr = null;
  let number = null;
  let baileys = null;
  let pino = null;
  let restartTimer = null;
  let generation = 0;           // يتجاهل أحداث الاتصالات القديمة بعد إعادة التشغيل

  async function load() {
    if (baileys) return;
    baileys = await import("@whiskeysockets/baileys");
    pino = (await import("pino")).default;
  }

  function scheduleRestart(ms = 5000) {
    if (restartTimer) return;
    restartTimer = setTimeout(() => { restartTimer = null; start(); }, ms);
  }

  async function start() {
    const gen = ++generation;
    state = "starting";
    try {
      await load();
      const makeWASocket = baileys.default?.default ?? baileys.default ?? baileys.makeWASocket;
      const { useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason, Browsers } = baileys;
      fs.mkdirSync(authDir, { recursive: true });
      const { state: auth, saveCreds } = await useMultiFileAuthState(authDir);
      let version;
      try { version = (await fetchLatestBaileysVersion()).version; } catch (_) { /* نستخدم الافتراضي */ }

      try { sock?.end?.(undefined); } catch (_) {}
      sock = makeWASocket({
        ...(version ? { version } : {}),
        auth: auth,
        logger: pino({ level: process.env.WA_LOG_LEVEL || "warn" }),
        browser: Browsers.ubuntu("Z8 Gateway"),
        syncFullHistory: false,
        markOnlineOnConnect: false,
        generateHighQualityLinkPreview: false,
      });
      const s = sock;
      s.ev.on("creds.update", saveCreds);
      s.ev.on("connection.update", (u) => {
        if (gen !== generation) return;
        const { connection, lastDisconnect, qr } = u;
        if (qr) { state = "qr"; lastQr = qr; number = null; console.log("QR جاهز للمسح"); }
        if (connection === "open") {
          state = "ready"; lastQr = null;
          number = (s.user?.id || "").split(":")[0].split("@")[0] || null;
          console.log("واتساب جاهز", number || "");
        }
        if (connection === "close") {
          const code = lastDisconnect?.error?.output?.statusCode;
          lastQr = null; number = null;
          if (code === DisconnectReason.loggedOut) {
            console.error("تم تسجيل الخروج من الجوال — نمسح الجلسة ونطلب QR جديد");
            state = "disconnected";
            try { fs.rmSync(authDir, { recursive: true, force: true }); } catch (_) {}
            scheduleRestart(1000);
          } else {
            // 515 (restartRequired) بعد أول ربط، أو انقطاع شبكة — إعادة اتصال بنفس الجلسة
            console.error("انقطع الاتصال (كود", code, ") — إعادة محاولة");
            state = code === DisconnectReason.restartRequired ? "starting" : "disconnected";
            scheduleRestart(code === DisconnectReason.restartRequired ? 500 : 5000);
          }
        }
      });
    } catch (e) {
      console.error("تعذّر تشغيل Baileys:", e && e.message);
      state = "disconnected";
      scheduleRestart(15000);
    }
  }

  async function jidFor(to) {
    const digits = String(to || "").replace(/\D/g, "");
    if (digits.length < 10) throw fail("invalid_number", 422);
    const res = await sock.onWhatsApp(digits);
    const hit = Array.isArray(res) ? res.find((r) => r.exists) : null;
    if (!hit) throw fail("not_on_whatsapp", 404);
    return hit.jid;
  }

  return {
    start,
    getState: () => ({ state, number }),
    getQr: () => (state === "qr" ? lastQr : null),
    async send(to, text) {
      if (state !== "ready") throw fail("not_ready", 503);
      const jid = await jidFor(to);
      await sock.sendMessage(jid, { text: String(text) });
    },
    async sendDocument(to, b64, filename, caption) {
      if (state !== "ready") throw fail("not_ready", 503);
      const jid = await jidFor(to);
      await sock.sendMessage(jid, {
        document: Buffer.from(b64, "base64"),
        mimetype: "application/pdf",
        fileName: filename || "document.pdf",
        ...(caption ? { caption } : {}),
      });
    },
    async logout() {
      try { await sock.logout(); } catch (_) {}
      try { fs.rmSync(authDir, { recursive: true, force: true }); } catch (_) {}
      state = "disconnected"; lastQr = null; number = null;
      scheduleRestart(1000);
    },
    async stop() { try { sock?.end?.(undefined); } catch (_) {} },
  };
};
