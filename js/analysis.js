// Анализ музыки → набор «чувств» для анимаций.
//   bass/mid/high — громкость полос (0..1)
//   energy        — мгновенная громкость
//   intensity     — медленная оценка «накала» участка песни: спокойный куплет ≈ 0.2, мощный припев ≈ 0.9
//   pulse         — затухающий импульс на каждом ударе (бит)
//   spectrum      — 64 логарифмических полосы для рисования
import { clamp, smooth, noise1 } from './util.js';
import { lineAt } from './lyrics.js';

const BANDS = 64;

function makeFeatures() {
  return {
    bass: 0, mid: 0, high: 0, energy: 0, intensity: 0.3, pulse: 0, beat: false,
    spectrum: new Float32Array(BANDS), wave: new Float32Array(256), real: false, beats: 0,
  };
}

export class Analyzer {
  constructor() {
    this.ctx = null;
    this.analyser = null;
    this.F = makeFeatures();
    this.sources = new Map();
    this.streamSource = null;
    this.reset();
  }

  init() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.5;
    this.analyser.minDecibels = -95;
    this.analyser.maxDecibels = -20;
    this.freq = new Uint8Array(this.analyser.frequencyBinCount);
    this.prevFreq = new Uint8Array(this.analyser.frequencyBinCount);
    this.time = new Float32Array(this.analyser.fftSize);
    const hz = this.ctx.sampleRate / this.analyser.fftSize;
    const bin = (f) => clamp(Math.round(f / hz), 1, this.analyser.frequencyBinCount - 1);
    this.ranges = { bass: [bin(30), bin(150)], mid: [bin(400), bin(2200)], high: [bin(3500), bin(12000)], kick: [bin(35), bin(220)] };
    // Границы логарифмических полос спектра.
    this.bandEdges = [];
    for (let i = 0; i <= BANDS; i++) this.bandEdges.push(bin(32 * Math.pow(15000 / 32, i / BANDS)));
  }

  // Подключаем <audio>. Сделать это можно только один раз на элемент.
  attachElement(audio) {
    this.init();
    if (!this.sources.has(audio)) {
      const src = this.ctx.createMediaElementSource(audio);
      src.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);
      this.sources.set(audio, src);
    }
  }

  // Захват звука вкладки (веб-версия + YouTube): слушаем, но не выводим повторно в колонки.
  attachStream(stream) {
    this.init();
    this.detachStream();
    this.streamSource = this.ctx.createMediaStreamSource(stream);
    this.streamSource.connect(this.analyser);
    this.stream = stream;
  }
  detachStream() {
    if (this.streamSource) {
      this.streamSource.disconnect();
      this.stream?.getTracks().forEach((t) => t.stop());
      this.streamSource = null;
      this.stream = null;
    }
  }
  get capturing() { return !!this.streamSource; }

  resume() { if (this.ctx?.state === 'suspended') this.ctx.resume(); }

  reset() {
    this.peak = { bass: 0.35, mid: 0.3, high: 0.2, energy: 0.12 };
    this.slowE = 0.3; this.slowH = 0.2;
    this.longMin = 0.25; this.longMax = 0.6;
    this.flux = []; this.lastBeat = 0; this.beatTimes = [];
    this.clock = 0;
  }

  avg(r) {
    let s = 0;
    for (let i = r[0]; i <= r[1]; i++) s += this.freq[i];
    return s / ((r[1] - r[0] + 1) * 255);
  }

  sample(dt, reactivity = 1) {
    const F = this.F;
    this.clock += dt;
    if (!this.analyser) return F;
    [this.prevFreq, this.freq] = [this.freq, this.prevFreq];
    this.analyser.getByteFrequencyData(this.freq);
    this.analyser.getFloatTimeDomainData(this.time);

    let rms = 0;
    for (let i = 0; i < this.time.length; i++) rms += this.time[i] * this.time[i];
    rms = Math.sqrt(rms / this.time.length);
    for (let i = 0; i < F.wave.length; i++) F.wave[i] = this.time[(i * this.time.length / F.wave.length) | 0];

    const raw = { bass: this.avg(this.ranges.bass), mid: this.avg(this.ranges.mid), high: this.avg(this.ranges.high), energy: rms };
    // Адаптивная нормализация: пик медленно забывается (~25 с), поэтому тихий куплет
    // после громкого припева остаётся «тихим», а не растягивается до максимума.
    const decay = Math.exp(-dt / 25);
    for (const k in raw) {
      this.peak[k] = Math.max(raw[k], this.peak[k] * decay, k === 'energy' ? 0.02 : 0.05);
    }
    const n = (k) => clamp(raw[k] / this.peak[k]);
    F.bass = smooth(F.bass, n('bass'), dt, 0.06);
    F.mid = smooth(F.mid, n('mid'), dt, 0.08);
    F.high = smooth(F.high, n('high'), dt, 0.08);
    F.energy = smooth(F.energy, n('energy'), dt, 0.05);

    for (let b = 0; b < BANDS; b++) {
      const a = this.bandEdges[b], z = Math.max(a, this.bandEdges[b + 1] - 1);
      let s = 0;
      for (let i = a; i <= z; i++) s += this.freq[i];
      const v = s / ((z - a + 1) * 255);
      F.spectrum[b] = smooth(F.spectrum[b], v, dt, 0.05);
    }

    // Бит: всплеск энергии в низах (spectral flux) выше адаптивного порога.
    let flux = 0;
    for (let i = this.ranges.kick[0]; i <= this.ranges.kick[1]; i++) {
      const d = this.freq[i] - this.prevFreq[i];
      if (d > 0) flux += d;
    }
    flux /= (this.ranges.kick[1] - this.ranges.kick[0] + 1) * 255;
    this.flux.push(flux);
    if (this.flux.length > 50) this.flux.shift();
    const mean = this.flux.reduce((a, b) => a + b, 0) / this.flux.length;
    const sd = Math.sqrt(this.flux.reduce((a, b) => a + (b - mean) ** 2, 0) / this.flux.length);
    F.beat = false;
    if (flux > mean + 1.4 * sd && flux > 0.018 && this.clock - this.lastBeat > 0.24 && rms > 0.01) {
      F.beat = true;
      this.lastBeat = this.clock;
      this.beatTimes.push(this.clock);
      F.beats++;
    }
    while (this.beatTimes.length && this.clock - this.beatTimes[0] > 4) this.beatTimes.shift();
    F.pulse = F.beat ? 1 : F.pulse * Math.exp(-dt / 0.2);

    // Накал участка: громкость + «яркость» (высокие) + плотность битов, медленно.
    this.slowE = smooth(this.slowE, n('energy'), dt, 1.6);
    this.slowH = smooth(this.slowH, n('high'), dt, 2.0);
    const beatRate = clamp(this.beatTimes.length / 4 / 2.5);
    const target = clamp(0.55 * this.slowE + 0.25 * this.slowH + 0.2 * beatRate);
    // Растягиваем по диапазону, встреченному в этой песне.
    this.longMin = Math.min(target, this.longMin + dt * 0.01);
    this.longMax = Math.max(target, this.longMax - dt * 0.01);
    const span = Math.max(0.25, this.longMax - this.longMin);
    const rel = clamp((target - this.longMin) / span);
    F.intensity = clamp(smooth(F.intensity, 0.15 + 0.85 * rel, dt, 0.9) * reactivity, 0, 1.2);
    if (rms < 0.004) F.intensity = smooth(F.intensity, 0.08, dt, 0.5);
    F.real = true;
    return F;
  }
}

// Когда звук недоступен (YouTube в веб-версии), «чувства» строятся по тексту:
// повторяющиеся строки (припев) — накал выше, слова — мягкие импульсы.
export class SyntheticAnalyzer {
  constructor() { this.F = makeFeatures(); this.t = 0; this.lastWord = -1; }
  reset() { this.lastWord = -1; this.F.intensity = 0.3; }
  sample(dt, { time = 0, playing = false, timeline = [] } = {}, reactivity = 1) {
    const F = this.F;
    this.t += dt;
    const i = lineAt(timeline, time);
    const line = timeline[i];
    let target = 0.25 + 0.12 * (noise1(this.t * 0.15) * 0.5 + 0.5);
    let wordHit = false;
    if (line && time < line.end + 1.5) {
      target += line.repeat > 1 ? 0.45 : 0.18;
      const words = line.words;
      let w = -1;
      for (let k = 0; k < words.length; k++) if (words[k].t <= time) w = k;
      const key = i * 1000 + w;
      if (w >= 0 && key !== this.lastWord) { this.lastWord = key; wordHit = true; }
    }
    if (!playing) target = 0.12;
    F.intensity = clamp(smooth(F.intensity, target, dt, 1.4) * reactivity, 0, 1.2);
    F.beat = playing && wordHit;
    F.pulse = F.beat ? 0.55 + 0.35 * F.intensity : F.pulse * Math.exp(-dt / 0.22);
    const I = F.intensity;
    F.bass = smooth(F.bass, clamp(0.25 + 0.5 * I + 0.4 * F.pulse + 0.1 * noise1(this.t * 2.1)), dt, 0.08);
    F.mid = smooth(F.mid, clamp(0.3 + 0.4 * I + 0.15 * noise1(this.t * 1.3 + 9)), dt, 0.1);
    F.high = smooth(F.high, clamp(0.2 + 0.4 * I + 0.2 * noise1(this.t * 3.7 + 4)), dt, 0.1);
    F.energy = smooth(F.energy, playing ? clamp(0.3 + 0.5 * I + 0.3 * F.pulse) : 0.05, dt, 0.1);
    for (let b = 0; b < BANDS; b++) {
      const shape = Math.pow(1 - b / BANDS, 0.7);
      const v = clamp((0.25 + 0.55 * I) * shape * (0.65 + 0.35 * noise1(this.t * 2.5 + b * 0.35)) + 0.25 * F.pulse * shape);
      F.spectrum[b] = smooth(F.spectrum[b], playing ? v : 0.03, dt, 0.08);
    }
    for (let k = 0; k < F.wave.length; k++) {
      F.wave[k] = playing ? Math.sin(k * 0.12 + this.t * 6) * 0.25 * F.energy * noise1(k * 0.05 + this.t) : 0;
    }
    F.real = false;
    return F;
  }
}
