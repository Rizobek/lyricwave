// Стили показа текста. Текст приходит из LRCLIB уже с таймингами строк;
// тайминги слов внутри строки оцениваются (см. buildTimeline).
import { escapeHtml, el, rand, clamp } from './util.js';
import { lineAt } from './lyrics.js';

export const TEXT_STYLES = [
  { id: 'focus', name: 'Фокус', font: "'Unbounded', sans-serif", sample: 'Аа' },
  { id: 'kinetic', name: 'Кинетика', font: "'Russo One', sans-serif", sample: 'АА' },
  { id: 'cinema', name: 'Кино', font: "'Playfair Display', serif", sample: 'Аа' },
  { id: 'neon', name: 'Неон', font: "'Comfortaa', sans-serif", sample: 'Аа' },
  { id: 'type', name: 'Печать', font: "'JetBrains Mono', monospace", sample: 'Аа_' },
  { id: 'scatter', name: 'Коллаж', font: "'Caveat', cursive", sample: 'Аа' },
];

const wordSpans = (line) => line.words.map((w, k) => `<span class="w" style="--k:${k}">${escapeHtml(w.text)}</span>`).join(' ');

class Base {
  constructor(root) { this.root = root; this.tl = []; this.idx = -2; }
  mount() {}
  setTimeline(tl) { this.tl = tl; this.idx = -2; this.build?.(); }
  update(t, F) {
    const i = lineAt(this.tl, t);
    if (i !== this.idx) { const prev = this.idx; this.idx = i; this.onLine(i, prev, t); }
    this.tick?.(t, F);
  }
  onLine() {}
  unmount() { this.root.innerHTML = ''; }
  // Слова текущей строки, которые уже «спеты».
  markWords(node, line, t) {
    if (!node || !line) return;
    const ws = node.querySelectorAll('.w');
    for (let k = 0; k < ws.length; k++) {
      const on = line.words[k] && line.words[k].t <= t;
      if (on !== ws[k].classList.contains('sung')) ws[k].classList.toggle('sung', on);
    }
  }
}

// 1. Фокус — лента строк, текущая крупно в центре, соседние размыты.
class Focus extends Base {
  mount() {
    this.wrap = el('div', { class: 'ly-focus' });
    this.track = el('div', { class: 'track' });
    this.wrap.append(this.track);
    this.root.append(this.wrap);
  }
  build() {
    this.track.innerHTML = this.tl.map((l) => `<div class="ln">${wordSpans(l)}</div>`).join('');
    this.nodes = [...this.track.children];
    this.center(0, true);
  }
  center(i, instant) {
    const n = this.nodes[Math.max(0, i)];
    if (!n) return;
    const y = n.offsetTop + n.offsetHeight / 2;
    if (instant) this.track.style.transition = 'none';
    this.track.style.transform = `translateY(${-y}px)`;
    if (instant) { this.track.offsetHeight; this.track.style.transition = ''; }
  }
  onLine(i, prev) {
    this.nodes.forEach((n, k) => {
      const d = Math.abs(k - i);
      n.className = 'ln' + (k === i ? ' on' : d === 1 ? ' near' : d === 2 ? ' mid' : ' far') + (k < i ? ' past' : '');
    });
    // После смены классов размер строк меняется — центрируем на следующем кадре.
    requestAnimationFrame(() => this.center(i, Math.abs(i - prev) > 3));
  }
  tick(t) { this.markWords(this.nodes?.[this.idx], this.tl[this.idx], t); }
}

// 2. Кинетика — слова «впрыгивают» по одному, строка улетает.
class Kinetic extends Base {
  mount() { this.stage = el('div', { class: 'ly-kinetic' }); this.root.append(this.stage); }
  build() { this.stage.innerHTML = ''; this.cur = null; }
  onLine(i) {
    if (this.cur) {
      const old = this.cur;
      old.classList.add('out');
      setTimeout(() => old.remove(), 900);
    }
    this.cur = null;
    const line = this.tl[i];
    if (!line) return;
    const longest = line.words.reduce((m, w, k) => (w.text.length > line.words[m].text.length ? k : m), 0);
    const node = el('div', { class: 'line' });
    node.innerHTML = line.words.map((w, k) => {
      const big = k === longest && line.words.length > 2 ? ' big' : '';
      return `<span class="w${big}" style="--r:${rand(-9, 9).toFixed(1)}deg;--x:${rand(-30, 30).toFixed(0)}px">${escapeHtml(w.text)}</span>`;
    }).join(' ');
    this.stage.append(node);
    this.cur = node;
  }
  tick(t) { this.markWords(this.cur, this.tl[this.idx], t); }
}

// 3. Кино — одна строка, буквы проявляются из размытия.
class Cinema extends Base {
  mount() {
    this.stage = el('div', { class: 'ly-cinema' });
    this.nextEl = el('div', { class: 'next' });
    this.stage.append(this.nextEl);
    this.root.append(this.stage);
  }
  build() { this.stage.querySelectorAll('.line').forEach((n) => n.remove()); this.cur = null; this.nextEl.textContent = ''; }
  onLine(i) {
    if (this.cur) { const o = this.cur; o.classList.add('out'); setTimeout(() => o.remove(), 1200); }
    const line = this.tl[i];
    this.cur = null;
    const nxt = this.tl[i + 1];
    this.nextEl.textContent = nxt ? nxt.text : '';
    this.nextEl.classList.remove('show');
    void this.nextEl.offsetWidth;
    this.nextEl.classList.add('show');
    if (!line) return;
    const dur = clamp((line.end - line.t) * 0.45, 0.4, 2.2);
    const per = Math.min(0.045, dur / Math.max(1, line.text.length));
    const node = el('div', { class: 'line' });
    // Буквы — внутри неразрывных слов, иначе строка переносилась бы посреди слова.
    let k = 0;
    node.innerHTML = line.text.split(/\s+/).filter(Boolean).map((word) => {
      const letters = [...word].map((c) => `<span class="ch" style="animation-delay:${(k++ * per).toFixed(3)}s">${escapeHtml(c)}</span>`).join('');
      k++;
      return `<span class="wd">${letters}</span>`;
    }).join(' ');
    this.stage.append(node);
    this.cur = node;
  }
}

// 4. Неон — светящиеся трубки, мерцают при включении.
class Neon extends Base {
  mount() { this.stage = el('div', { class: 'ly-neon' }); this.root.append(this.stage); }
  build() { this.stage.innerHTML = ''; this.lines = []; }
  onLine(i) {
    const line = this.tl[i];
    for (const n of this.lines) n.classList.add('off');
    while (this.lines.length > 1) { const o = this.lines.shift(); o.classList.add('gone'); setTimeout(() => o.remove(), 700); }
    if (!line) return;
    const node = el('div', { class: 'line', style: { '--neon': `var(--c${(i % 3) + 1})` } });
    node.innerHTML = wordSpans(line);
    this.stage.append(node);
    this.lines.push(node);
  }
  tick(t) { this.markWords(this.lines?.[this.lines.length - 1], this.tl[this.idx], t); }
}

// 5. Печать — строки печатаются с кареткой, предыдущие уходят вверх.
class Typewriter extends Base {
  mount() { this.stage = el('div', { class: 'ly-type' }); this.root.append(this.stage); }
  build() { this.stage.innerHTML = ''; this.cur = null; this.shown = -1; }
  onLine(i) {
    if (this.cur) {
      this.cur.classList.remove('cur');
      this.cur.querySelector('.txt').textContent = this.curLine?.text || '';
    }
    const all = [...this.stage.children];
    if (all.length > 3) all.slice(0, all.length - 3).forEach((n) => { n.classList.add('gone'); setTimeout(() => n.remove(), 600); });
    this.cur = null;
    this.curLine = this.tl[i];
    if (!this.curLine) return;
    const node = el('div', { class: 'line cur' }, el('span', { class: 'txt' }), el('span', { class: 'caret' }));
    this.stage.append(node);
    this.cur = node;
    this.shown = -1;
  }
  tick(t) {
    const line = this.curLine;
    if (!line || !this.cur) return;
    const last = line.words[line.words.length - 1];
    const typeEnd = Math.max(line.t + 0.3, last ? last.end : line.t + 1);
    const p = clamp((t - line.t) / (typeEnd - line.t));
    const n = Math.round(p * line.text.length);
    if (n !== this.shown) { this.shown = n; this.cur.querySelector('.txt').textContent = line.text.slice(0, n); }
  }
}

// 6. Коллаж — строки появляются в разных местах экрана, старые медленно тают.
class Scatter extends Base {
  mount() { this.stage = el('div', { class: 'ly-scatter' }); this.root.append(this.stage); }
  build() { this.stage.innerHTML = ''; this.items = []; this.slots = []; }
  pickSlot() {
    const cells = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 2; c++) cells.push([c, r]);
    const recent = this.slots.slice(-3).map((s) => s.join());
    const free = cells.filter((c) => !recent.includes(c.join()));
    const [c, r] = free[(Math.random() * free.length) | 0];
    this.slots.push([c, r]);
    return { x: 30 + c * 40 + rand(-5, 5), y: 22 + r * 20 + rand(-3, 3) };
  }
  onLine(i) {
    for (const n of this.items) n.classList.add('old');
    while (this.items.length > 3) { const o = this.items.shift(); o.classList.add('gone'); setTimeout(() => o.remove(), 1500); }
    const line = this.tl[i];
    if (!line) return;
    const { x, y } = this.pickSlot();
    const node = el('div', {
      class: 'line',
      style: { left: x + '%', top: y + '%', '--rot': rand(-7, 7).toFixed(1) + 'deg', '--sz': rand(0.85, 1.3).toFixed(2), '--col': `var(--c${(i % 3) + 1})` },
    });
    node.innerHTML = wordSpans(line);
    this.stage.append(node);
    this.items.push(node);
    this.keepInside(node);
  }
  // Не даём строке вылезти за края экрана и залезть под панель управления.
  keepInside(node) {
    const r = node.getBoundingClientRect();
    const pad = 24, top = 80, bottom = innerHeight - 170;
    let dx = 0, dy = 0;
    if (r.right > innerWidth - pad) dx = innerWidth - pad - r.right;
    if (r.left + dx < pad) dx = pad - r.left;
    if (r.bottom > bottom) dy = bottom - r.bottom;
    if (r.top + dy < top) dy = top - r.top;
    if (dx || dy) {
      node.style.left = `calc(${node.style.left} + ${dx.toFixed(0)}px)`;
      node.style.top = `calc(${node.style.top} + ${dy.toFixed(0)}px)`;
    }
  }
  tick(t) { this.markWords(this.items?.[this.items.length - 1], this.tl[this.idx], t); }
}

const CLASSES = { focus: Focus, kinetic: Kinetic, cinema: Cinema, neon: Neon, type: Typewriter, scatter: Scatter };

// Менеджер: стиль + заставка с названием + индикатор проигрышей.
export class LyricsView {
  constructor(root) {
    this.root = root;
    this.layer = el('div', { class: 'ly-layer' });
    this.intro = el('div', { class: 'ly-intro' });
    this.gap = el('div', { class: 'ly-gap', html: '<i></i><i></i><i></i>' });
    this.note = el('div', { class: 'ly-note' });
    root.append(this.layer, this.intro, this.gap, this.note);
    this.tl = [];
    this.style = null;
  }
  setStyle(id) {
    this.style?.unmount();
    this.layer.innerHTML = '';
    const C = CLASSES[id] || Focus;
    this.root.dataset.style = id in CLASSES ? id : 'focus';
    this.style = new C(this.layer);
    this.style.mount();
    this.style.setTimeline(this.tl);
  }
  setMeta({ title, artist }) {
    this.intro.innerHTML = `<div class="t">${escapeHtml(title || '')}</div><div class="a">${escapeHtml(artist || '')}</div><div class="cd"><i></i><i></i><i></i></div>`;
  }
  setTimeline(tl) {
    this.tl = tl || [];
    this.style?.setTimeline(this.tl);
  }
  setNote(html) {
    this.note.innerHTML = html || '';
    this.note.classList.toggle('show', !!html);
  }
  update(t, F) {
    const tl = this.tl;
    const first = tl[0];
    const introOn = !first || t < first.t - 0.4;
    this.intro.classList.toggle('show', introOn);
    this.root.classList.toggle('intro-on', introOn && !!first);
    if (first && introOn) {
      const left = first.t - t;
      const dots = this.intro.querySelectorAll('.cd i');
      this.intro.classList.toggle('count', left < 3.4);
      dots.forEach((d, k) => d.classList.toggle('on', left < 3.4 - k * 1.0));
    }
    const i = lineAt(tl, t);
    const cur = tl[i], nxt = tl[i + 1];
    const inGap = !!cur && t > cur.end + 0.4 && (!nxt || nxt.t - t > 2.5);
    this.gap.classList.toggle('show', inGap && !!nxt);
    this.layer.classList.toggle('resting', inGap);
    this.style?.update(t, F);
  }
}
