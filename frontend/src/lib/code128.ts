// lib/code128.ts — ترميز Code 128 (المجموعة B) إلى أعمدة SVG — مستقل بلا مكتبات.
// يدعم أي نص ASCII طباعي (أرقام/حروف/شرطات): يكفي للباركود الداخلي ورموز SKU والـ EAN المخزّنة كنص.
const P = ["212222","222122","222221","121223","121322","131222","122213","122312","132212","221213","221312","231212","112232","122132","122231","113222","123122","123221","223211","221132","221231","213212","223112","312131","311222","321122","321221","312212","322112","322211","212123","212321","232121","111323","131123","131321","112313","132113","132311","211313","231113","231311","112133","112331","132131","113123","113321","133121","313121","211331","231131","213113","213311","213131","311123","311321","331121","312113","312311","332111","314111","221411","431111","111224","111422","121124","121421","141122","141221","112214","112412","122114","122411","142112","142211","241211","221114","413111","241112","134111","111242","121142","121241","114212","124112","124211","411212","421112","421211","212141","214121","412121","111143","111341","131141","114113","114311","411113","411311","113141","114131","311141","411131","211412","211214","211232","2331112"];
const START_B = 104, STOP = 106;

export type Barcode128 = { width: number; bars: { x: number; w: number }[]; valid: boolean };

export function encode128(text: string): Barcode128 {
  const clean = [...text].filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) <= 126).join("");
  if (!clean) return { width: 0, bars: [], valid: false };
  const codes = [START_B, ...[...clean].map((c) => c.charCodeAt(0) - 32)];
  let sum = START_B; codes.slice(1).forEach((c, i) => { sum += c * (i + 1); });
  codes.push(sum % 103, STOP);
  const bars: { x: number; w: number }[] = []; let x = 0;
  for (const c of codes) {
    const pat = P[c]; let black = true;
    for (const ch of pat) { const w = Number(ch); if (black) bars.push({ x, w }); x += w; black = !black; }
  }
  return { width: x, bars, valid: clean === text };
}

/** SVG جاهز للإدراج (نص) — quiet zone = 10 وحدات يميناً ويساراً */
export function barcodeSvg(text: string, opts: { height?: number; module?: number; color?: string } = {}): string {
  const { height = 40, module = 1.4, color = "#000" } = opts;
  const b = encode128(text);
  if (!b.bars.length) return "";
  const q = 10, W = (b.width + q * 2) * module;
  const rects = b.bars.map((r) => `<rect x="${((r.x + q) * module).toFixed(2)}" y="0" width="${(r.w * module).toFixed(2)}" height="${height}" fill="${color}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W.toFixed(2)} ${height}" width="${W.toFixed(0)}" height="${height}" shape-rendering="crispEdges" role="img" aria-label="${text}">${rects}</svg>`;
}
