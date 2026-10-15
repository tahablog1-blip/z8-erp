// lib/auto-translate.ts — يترجم النصوص العربية الظاهرة للإنجليزية وقت التشغيل
// القاموس: /i18n-en.json (مفتاحه النص العربي نفسه، و{0} {1} أماكن القيم المتغيرة)
type Pat = { rx: RegExp; idx: number[]; en: string };

const AR = /[\u0600-\u06FF]/;
const ATTRS = ["placeholder", "title", "aria-label", "alt"];
let exact = new Map<string, string>();
let pats: Pat[] = [];
let loading: Promise<void> | null = null;
const missing = new Set<string>();

const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isPh = (p: string) => /^\{\d+\}$/.test(p);

function build(d: Record<string, string>) {
  exact = new Map();
  pats = [];
  for (const [ar, en] of Object.entries(d)) {
    if (!/\{\d+\}/.test(ar)) { exact.set(ar, en); continue; }
    const parts = ar.split(/(\{\d+\})/);
    const idx: number[] = [];
    let lit = 0;
    for (const p of parts) if (!isPh(p)) lit += p.replace(/\s/g, "").length;
    // نمط قصير الحروف (مثل "{0} كم") لا يلتقط إلا أرقاماً، حتى لا يطابق كلمات عربية عادية
    const short = lit < 4 && parts.filter(isPh).length < 2;
    const cap = short ? "([\\d.,:/%+\\-\\s]+?)" : "(.+?)";
    const src = parts.map((p) => {
      if (isPh(p)) { idx.push(Number(p.slice(1, -1))); return cap; }
      return esc(p);
    }).join("");
    try { pats.push({ rx: new RegExp("^" + src + "$"), idx, en }); } catch { /* تجاهل */ }
  }
  pats.sort((a, b) => b.rx.source.length - a.rx.source.length);
}

function tr1(n: string): string | null {
  const e = exact.get(n);
  if (e !== undefined) return e;
  for (const p of pats) {
    const m = p.rx.exec(n);
    if (m) {
      return p.en.replace(/\{(\d+)\}/g, (whole, k) => {
        const j = p.idx.indexOf(Number(k));
        return j >= 0 ? m[j + 1] : whole;
      });
    }
  }
  return null;
}

function translate(s: string): string {
  if (!AR.test(s)) return s;
  const lead = (s.match(/^\s*/) || [""])[0];
  const trail = (s.match(/\s*$/) || [""])[0];
  const n = norm(s);
  let out = tr1(n);
  if (out === null) {
    const parts = n.split(/(\s*[—·|:]\s*)/);
    let changed = false;
    const res = parts.map((p, i) => {
      if (i % 2 === 1 || !AR.test(p)) return p;
      const t = tr1(p.trim());
      if (t === null) return p;
      changed = true;
      return t;
    });
    out = changed ? res.join("") : null;
  }
  if (out === null) { missing.add(n); return s; }
  return lead + out + trail;
}

function fixAttr(el: Element, a: string) {
  const v = el.getAttribute(a);
  if (v && AR.test(v)) {
    const t = translate(v);
    if (t !== v) el.setAttribute(a, t);
  }
}

function fixNode(node: Node) {
  if (node.nodeType === 3) {
    const v = node.nodeValue || "";
    if (AR.test(v)) {
      const t = translate(v);
      if (t !== v) node.nodeValue = t;
    }
    return;
  }
  if (node.nodeType !== 1) return;
  const el = node as Element;
  const tag = el.tagName;
  if (tag === "SCRIPT" || tag === "STYLE" || el.hasAttribute("data-no-translate")) return;
  for (const a of ATTRS) fixAttr(el, a);
  el.childNodes.forEach((c) => fixNode(c));
}

export function startAutoTranslate(): () => void {
  let obs: MutationObserver | null = null;
  let stopped = false;
  if (!loading) {
    loading = fetch("/i18n-en.json", { cache: "no-cache" })
      .then((r) => r.json())
      .then(build)
      .catch(() => { /* القاموس غير متاح — تبقى النصوص عربية */ });
  }
  loading.then(() => {
    if (stopped) return;
    document.title = translate(document.title);
    fixNode(document.body);
    obs = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === "childList") m.addedNodes.forEach((n) => fixNode(n));
        else if (m.type === "characterData") fixNode(m.target);
        else if (m.type === "attributes" && m.attributeName && m.target instanceof Element) {
          fixAttr(m.target, m.attributeName);
        }
      }
    });
    obs.observe(document.body, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ATTRS,
    });
  });
  (window as unknown as Record<string, unknown>).__z8_missing = () => Array.from(missing).join("\n");
  return () => { stopped = true; if (obs) obs.disconnect(); };
}
