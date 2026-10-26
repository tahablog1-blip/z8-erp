// engines/wwebjs.js — المحرك القديم (whatsapp-web.js + Chrome). بيتفعّل بـ WA_ENGINE=wwebjs
const fail = (msg, code) => Object.assign(new Error(msg), { code });

module.exports = function createWwebjsEngine({ dataDir }) {
  const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
  let state = "starting", lastQr = null, number = null, client = null, restarting = false;

  function scheduleRestart(delayMs = 15000) {
    if (restarting) return;
    restarting = true;
    setTimeout(async () => {
      try { if (client) await client.destroy(); } catch (_) {}
      restarting = false;
      start();
    }, delayMs);
  }

  async function start() {
    state = "starting";
    client = new Client({
      authStrategy: new LocalAuth({ dataPath: dataDir }),
      puppeteer: { headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--no-first-run", "--no-zygote"] },
    });
    const c = client;
    c.on("qr", (qr) => { state = "qr"; lastQr = qr; number = null; console.log("QR جاهز للمسح"); });
    c.on("ready", () => { state = "ready"; lastQr = null; number = c.info?.wid?.user || null; console.log("واتساب جاهز", number || ""); });
    c.on("auth_failure", (m) => { console.error("فشل التوثيق:", m); state = "disconnected"; scheduleRestart(); });
    c.on("disconnected", (r) => { console.error("انقطع الاتصال:", r); state = "disconnected"; lastQr = null; number = null; scheduleRestart(); });
    try { await c.initialize(); } catch (e) { console.error("تعذّر تشغيل واتساب:", e.message); state = "disconnected"; scheduleRestart(); }
  }

  async function resolveId(to) {
    const digits = String(to || "").replace(/\D/g, "");
    if (digits.length < 10) throw fail("invalid_number", 422);
    const id = await client.getNumberId(digits);
    if (!id) throw fail("not_on_whatsapp", 404);
    return id._serialized;
  }

  return {
    start,
    getState: () => ({ state, number }),
    getQr: () => (state === "qr" ? lastQr : null),
    async send(to, text) {
      if (state !== "ready") throw fail("not_ready", 503);
      await client.sendMessage(await resolveId(to), String(text), { sendSeen: false });
    },
    async sendDocument(to, b64, filename, caption) {
      if (state !== "ready") throw fail("not_ready", 503);
      const id = await resolveId(to);
      const media = new MessageMedia("application/pdf", b64, filename || "document.pdf");
      await client.sendMessage(id, media, { sendMediaAsDocument: true, sendSeen: false, caption: caption || "" });
    },
    async logout() { try { await client.logout(); } catch (_) {} state = "disconnected"; scheduleRestart(1000); },
    async stop() { try { await client.destroy(); } catch (_) {} },
  };
};
