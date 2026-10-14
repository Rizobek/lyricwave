// Поиск текстов песен (LRCLIB — открытая база синхронизированных текстов),
// разбор LRC и построение таймлайна строк/слов.

const API = 'https://lrclib.net/api';
const HEADERS = { 'Lrclib-Client': 'LyricWave v1.0 (https://github.com/)' };

// ---------- нормализация названий
const JUNK = /\b(official|video|audio|lyrics?|lyric video|visuali[sz]er|hd|hq|4k|8k|remaster(ed)?|mv|m\/v|clip|explicit|full version|music video|premiere|color coded|sub(s|title)?s?|eng|rus)\b|клип|премьера|официальн\w*|текст|аудио|караоке|сингл|single/i;

export function cleanTitle(s) {
  return String(s || '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/【[^】]*】/g, ' ')
    .replace(/\(([^)]*)\)/g, (m, inner) => (JUNK.test(inner) ? ' ' : m))
    .replace(/\s[|｜•·]\s.*$/, ' ')
    .replace(/#\S+/g, ' ')
    .replace(/[«»"“”]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanArtist(s) {
  return String(s || '')
    .replace(/\s*-\s*Topic$/i, '')
    .replace(/VEVO$/i, '')
    .replace(/official( channel)?|официальный канал( группы)?|music$/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Из заголовка видео «Исполнитель - Песня (Official Video)» получаем пару artist/title.
export function guessArtistTitle({ title, track, artist, uploader }) {
  if (track && artist) return { artist: artist.split(/,|&| feat\.? | ft\.? /i)[0].trim(), title: cleanTitle(track) };
  const t = cleanTitle(title);
  const m = t.match(/^(.+?)\s+[-–—~]\s+(.+)$/);
  if (m) return { artist: cleanArtist(m[1]), title: cleanTitle(m[2]) };
  const m2 = t.match(/^(.+?)\s*[«"](.+?)[»"]/);
  if (m2) return { artist: cleanArtist(m2[1]), title: m2[2] };
  return { artist: cleanArtist(artist || uploader || ''), title: t };
}

export const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/\b(feat|ft)\.?\s.*$/, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

function similarity(a, b) {
  a = norm(a); b = norm(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.8;
  const A = new Set(a.split(' ')), B = new Set(b.split(' '));
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / Math.max(A.size, B.size);
}

// ---------- LRCLIB
async function api(path, params) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== ''));
  const r = await fetch(`${API}/${path}?${qs}`, { headers: HEADERS });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('LRCLIB ' + r.status);
  return r.json();
}

function score(c, { artist, title, duration }) {
  let s = 0;
  if (c.instrumental) s -= 6;
  if (c.syncedLyrics) s += 3;
  else if (c.plainLyrics) s += 1;
  else s -= 10;
  s += similarity(c.trackName, title) * 3;
  if (artist) s += similarity(c.artistName, artist) * 2;
  if (duration && c.duration) {
    const d = Math.abs(c.duration - duration);
    s -= Math.min(d / 2.5, 6);
    if (d <= 2) s += 1.5;
  }
  return s;
}

export async function searchCandidates({ artist, title, duration }) {
  const seen = new Map();
  const add = (list) => (list || []).forEach((c) => c && !seen.has(c.id) && seen.set(c.id, c));
  if (artist && title && duration) {
    try { add([await api('get', { artist_name: artist, track_name: title, duration: Math.round(duration) })]); } catch {}
  }
  if (title) add(await api('search', { track_name: title, artist_name: artist }).catch(() => []));
  if (seen.size < 3) add(await api('search', { q: `${artist || ''} ${title}`.trim() }).catch(() => []));
  if (seen.size === 0 && title) add(await api('search', { q: title }).catch(() => []));
  return [...seen.values()]
    .map((c) => ({ ...c, _score: score(c, { artist, title, duration }) }))
    .sort((a, b) => b._score - a._score);
}

export function lyricsFromCandidate(c, duration) {
  if (c.syncedLyrics) {
    return { status: 'synced', lines: parseLrc(c.syncedLyrics), lrclibId: c.id, matchDuration: c.duration, name: `${c.artistName} — ${c.trackName}` };
  }
  if (c.plainLyrics) {
    return { status: 'approx', plain: c.plainLyrics, lines: null, lrclibId: c.id, matchDuration: c.duration, name: `${c.artistName} — ${c.trackName}`, approxFor: duration || c.duration };
  }
  return { status: 'none' };
}

export async function findLyrics(q) {
  const list = await searchCandidates(q);
  const best = list[0];
  if (!best || best._score < 1.2) return { status: 'none', checkedFor: q.duration || null };
  return { ...lyricsFromCandidate(best, q.duration), checkedFor: q.duration || null };
}

// ---------- разбор LRC
export function parseLrc(text) {
  const out = [];
  let offset = 0;
  for (const raw of String(text).split(/\r?\n/)) {
    const off = raw.match(/^\[offset:\s*([+-]?\d+)\]/i);
    if (off) { offset = parseInt(off[1], 10) / 1000; continue; }
    const tags = [...raw.matchAll(/\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g)];
    if (!tags.length) continue;
    const textPart = raw.replace(/\[[^\]]*\]/g, '').replace(/<\d+:\d+(?:\.\d+)?>/g, '').trim();
    for (const m of tags) {
      const frac = m[3] ? parseInt(m[3], 10) / Math.pow(10, m[3].length) : 0;
      out.push({ t: +m[1] * 60 + +m[2] + frac, text: textPart });
    }
  }
  out.sort((a, b) => a.t - b.t);
  return out.map((l) => ({ t: Math.max(0, +(l.t - offset).toFixed(3)), text: l.text }));
}

// Только текст без таймингов: распределяем строки по длительности трека.
export function approximateLines(plain, duration) {
  const rows = String(plain).split(/\r?\n/).map((s) => s.trim());
  const D = duration || 200;
  const start = Math.min(14, D * 0.07), end = D - Math.min(12, D * 0.06);
  const weights = rows.map((r) => (r ? r.length + 10 : 12));
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let acc = start;
  const lines = [];
  rows.forEach((r, i) => {
    if (r) lines.push({ t: +acc.toFixed(2), text: r });
    else if (lines.length && lines[lines.length - 1].text) lines.push({ t: +acc.toFixed(2), text: '' });
    acc += (weights[i] / total) * (end - start);
  });
  return lines;
}

export function linesFor(lyrics, duration) {
  if (!lyrics) return [];
  if (lyrics.status === 'synced' || lyrics.status === 'manual') return lyrics.lines || [];
  if (lyrics.status === 'approx') return approximateLines(lyrics.plain, duration || lyrics.approxFor);
  return [];
}

// Разбор произвольного вставленного текста: LRC или просто строки.
export function lyricsFromUserText(text, duration) {
  const lrc = parseLrc(text);
  if (lrc.length >= 2) return { status: 'manual', lines: lrc, name: 'Свой текст' };
  return { status: 'approx', plain: text, lines: null, name: 'Свой текст', approxFor: duration };
}

// ---------- таймлайн
// Строки с концом, словами и примерными таймингами слов (LRC даёт только начало строки).
export function buildTimeline(lines, duration) {
  const D = duration || (lines.length ? lines[lines.length - 1].t + 8 : 0);
  const tl = [];
  const counts = new Map();
  for (const l of lines) if (l.text) counts.set(norm(l.text), (counts.get(norm(l.text)) || 0) + 1);

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const next = lines[i + 1]?.t ?? D;
    if (!l.text) continue;
    const span = Math.max(0.4, next - l.t);
    const words = l.text.split(/\s+/).filter(Boolean);
    const chars = l.text.replace(/\s/g, '').length;
    // Пение строки обычно короче промежутка до следующей строки.
    const sing = Math.min(span * 0.92, chars * 0.13 + 0.7);
    const wts = words.map((w) => w.replace(/[^\p{L}\p{N}]/gu, '').length + 1.6);
    const wsum = wts.reduce((a, b) => a + b, 0) || 1;
    let acc = l.t;
    const W = words.map((w, k) => {
      const d = (wts[k] / wsum) * sing;
      const o = { text: w, t: acc, end: acc + d };
      acc += d;
      return o;
    });
    const end = Math.min(next, l.t + Math.max(sing + 1.2, Math.min(span, sing * 1.6)));
    tl.push({
      i: tl.length, t: l.t, end, next, text: l.text, words: W,
      repeat: counts.get(norm(l.text)) || 1,
    });
  }
  return tl;
}

// Бинарный поиск текущей строки.
export function lineAt(tl, t) {
  let lo = 0, hi = tl.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (tl[mid].t <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}
