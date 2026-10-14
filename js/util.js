// Общие утилиты: математика, шум, цвета, форматирование.

export const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (cur, target, dt, tau) => cur + (target - cur) * (1 - Math.exp(-dt / Math.max(tau, 1e-4)));
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const uid = (p = 'id') => p + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

export function fmtTime(s) {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') {
      for (const [p, val] of Object.entries(v)) {
        if (p.startsWith('--')) n.style.setProperty(p, val);
        else n.style[p] = val;
      }
    }
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null) n.append(c.nodeType ? c : document.createTextNode(c));
  return n;
}

// ---- Value noise (1D/2D), дешёвый и плавный — для «дыхания» анимаций.
const P = new Uint8Array(512);
{
  const p = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) P[i] = p[i & 255];
}
const fade = (t) => t * t * (3 - 2 * t);
export function noise1(x) {
  const i = Math.floor(x), f = x - i;
  const a = P[i & 255] / 255, b = P[(i + 1) & 255] / 255;
  return lerp(a, b, fade(f)) * 2 - 1;
}
export function noise2(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const h = (i, j) => P[(P[(xi + i) & 255] + yi + j) & 255] / 255;
  const u = fade(xf), v = fade(yf);
  return lerp(lerp(h(0, 0), h(1, 0), u), lerp(h(0, 1), h(1, 1), u), v) * 2 - 1;
}

// ---- Цвета
export function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
}
export function rgbToHsl(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}
export const rgbCss = (c, a = 1) => `rgba(${(c[0] * 255) | 0},${(c[1] * 255) | 0},${(c[2] * 255) | 0},${a})`;
export const mixRgb = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

// Палитры: a, b, c — акценты, bg — фон. Значения 0..1.
const hsl = (h, s, l) => hslToRgb(h, s, l);
export const PALETTES = {
  sunset: { name: 'Закат', a: hsl(338, .85, .6), b: hsl(24, .95, .6), c: hsl(270, .7, .62), bg: hsl(262, .45, .06) },
  ocean: { name: 'Океан', a: hsl(190, .9, .55), b: hsl(220, .85, .6), c: hsl(160, .75, .5), bg: hsl(220, .6, .05) },
  neon: { name: 'Неон', a: hsl(300, 1, .6), b: hsl(180, 1, .5), c: hsl(60, 1, .55), bg: hsl(250, .5, .04) },
  forest: { name: 'Лес', a: hsl(140, .6, .5), b: hsl(75, .7, .55), c: hsl(40, .8, .6), bg: hsl(150, .4, .04) },
  fire: { name: 'Огонь', a: hsl(10, .95, .55), b: hsl(40, 1, .55), c: hsl(350, .85, .45), bg: hsl(10, .5, .04) },
  mono: { name: 'Монохром', a: hsl(0, 0, .92), b: hsl(220, .1, .6), c: hsl(0, 0, .4), bg: hsl(0, 0, .03) },
};

// Достаём 3 ярких цвета из обложки.
export async function paletteFromImage(url) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.decoding = 'async';
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
  const N = 48;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(img, 0, 0, N, N);
  const d = cx.getImageData(0, 0, N, N).data;
  const buckets = Array.from({ length: 18 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
  let darkR = 0, darkG = 0, darkB = 0, darkN = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
    const [h, s, l] = rgbToHsl(r, g, b);
    if (l < 0.3) { darkR += r; darkG += g; darkB += b; darkN++; }
    if (s < 0.22 || l < 0.12 || l > 0.92) continue;
    const w = s * s * (1 - Math.abs(l - 0.55));
    const bk = buckets[Math.floor(h / 20) % 18];
    bk.w += w; bk.r += r * w; bk.g += g * w; bk.b += b * w;
  }
  const top = buckets.map((b, i) => ({ ...b, i })).filter((b) => b.w > 0.6).sort((x, y) => y.w - x.w);
  if (!top.length) return null;
  const picked = [];
  for (const b of top) {
    if (picked.every((p) => Math.min(Math.abs(p.i - b.i), 18 - Math.abs(p.i - b.i)) >= 2)) picked.push(b);
    if (picked.length === 3) break;
  }
  const vivid = (b) => {
    const [h, s, l] = rgbToHsl(b.r / b.w, b.g / b.w, b.b / b.w);
    return hslToRgb(h, clamp(s * 1.15, 0.55, 1), clamp(l, 0.5, 0.66));
  };
  const cols = picked.map(vivid);
  while (cols.length < 3) {
    const [h, s, l] = rgbToHsl(...cols[0]);
    cols.push(hslToRgb(h + (cols.length === 1 ? 40 : -50), s, l));
  }
  let bg;
  if (darkN > 20) {
    const [h, s] = rgbToHsl(darkR / darkN, darkG / darkN, darkB / darkN);
    bg = hslToRgb(h, clamp(s, 0.25, 0.6), 0.05);
  } else {
    const [h] = rgbToHsl(...cols[0]);
    bg = hslToRgb(h, 0.45, 0.05);
  }
  return { name: 'Обложка', a: cols[0], b: cols[1], c: cols[2], bg };
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
