// Хранение библиотеки и настроек: localStorage для метаданных, IndexedDB для файлов.
import { PRESETS } from './presets.js';
import { uid } from './util.js';

const K_TRACKS = 'lw.tracks.v1';
const K_SETTINGS = 'lw.settings.v1';
const K_SEEDED = 'lw.seeded.v1';

export const DEFAULT_SETTINGS = {
  visual: 'aurora',
  text: 'focus',
  palette: 'auto',
  reactivity: 1,
  textScale: 1,
  volume: 0.85,
  shuffle: false,
  repeat: 'all', // all | one | off
};

function readJson(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key, v) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch (e) {
    console.warn('storage write failed', e);
  }
}

export function ytThumb(id) {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

export function presetTracks() {
  return PRESETS.map((p, i) => ({
    id: 'preset_' + p.yt,
    title: p.title,
    artist: p.artist,
    source: { kind: 'youtube', ytId: p.yt, url: `https://www.youtube.com/watch?v=${p.yt}` },
    duration: p.duration || null,
    cover: ytThumb(p.yt),
    lyrics: null,
    offset: 0,
    preset: true,
    addedAt: i,
  }));
}

export const store = {
  tracks: [],
  settings: { ...DEFAULT_SETTINGS },
  listeners: new Set(),

  load() {
    this.settings = { ...DEFAULT_SETTINGS, ...readJson(K_SETTINGS, {}) };
    this.tracks = readJson(K_TRACKS, []);
    if (!readJson(K_SEEDED, false)) {
      const have = new Set(this.tracks.map((t) => t.id));
      this.tracks.push(...presetTracks().filter((t) => !have.has(t.id)));
      writeJson(K_SEEDED, true);
      this.saveTracks();
    }
  },
  saveTracks() {
    writeJson(K_TRACKS, this.tracks);
    this.emit();
  },
  saveSettings() {
    writeJson(K_SETTINGS, this.settings);
  },
  set(key, value) {
    this.settings[key] = value;
    this.saveSettings();
  },
  get(id) {
    return this.tracks.find((t) => t.id === id);
  },
  add(track) {
    const t = { id: uid('tr'), lyrics: null, offset: 0, addedAt: Date.now(), ...track };
    this.tracks.unshift(t);
    this.saveTracks();
    return t;
  },
  update(id, patch) {
    const t = this.get(id);
    if (!t) return;
    Object.assign(t, patch);
    this.saveTracks();
    return t;
  },
  remove(id) {
    const t = this.get(id);
    this.tracks = this.tracks.filter((x) => x.id !== id);
    if (t?.source?.kind === 'file') files.delete(t.source.fileKey).catch(() => {});
    this.saveTracks();
  },
  restorePresets() {
    const have = new Set(this.tracks.map((t) => t.id));
    const missing = presetTracks().filter((t) => !have.has(t.id));
    this.tracks.push(...missing);
    this.saveTracks();
    return missing.length;
  },
  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  },
  emit() {
    for (const fn of this.listeners) fn();
  },
};

// ---- IndexedDB для аудиофайлов, добавленных с компьютера
let dbp;
function db() {
  dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open('lyricwave', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
function tx(mode, fn) {
  return db().then((d) => new Promise((res, rej) => {
    const t = d.transaction('files', mode);
    const req = fn(t.objectStore('files'));
    t.oncomplete = () => res(req?.result);
    t.onerror = () => rej(t.error);
  }));
}
export const files = {
  put: (key, blob) => tx('readwrite', (s) => s.put(blob, key)),
  get: (key) => tx('readonly', (s) => s.get(key)),
  delete: (key) => tx('readwrite', (s) => s.delete(key)),
};

// ---- Экспорт/импорт плейлиста кодом (без файлов с компьютера)
export function encodePlaylist(tracks) {
  const data = tracks
    .filter((t) => t.source.kind !== 'file')
    .map((t) => [t.source.url, t.title, t.artist, t.offset || 0]);
  const json = JSON.stringify({ v: 1, t: data });
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodePlaylist(code) {
  code = code.trim();
  const m = code.match(/[#&?]import=([A-Za-z0-9_-]+)/);
  if (m) code = m[1];
  const b64 = code.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const obj = JSON.parse(new TextDecoder().decode(bytes));
  if (!obj || obj.v !== 1 || !Array.isArray(obj.t)) throw new Error('bad code');
  return obj.t.map(([url, title, artist, offset]) => ({ url, title, artist, offset }));
}
