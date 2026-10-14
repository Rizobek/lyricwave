// Связь с локальным сервером настольной версии. В веб-версии сервера нет —
// тогда приложение работает в «облегчённом» режиме (YouTube-плеер, прямые ссылки, файлы).
import { sleep } from './util.js';

const LOCAL_HOSTS = ['127.0.0.1', 'localhost'];

export const backend = {
  available: false,
  ytdlp: null,

  async detect() {
    // Настольная версия всегда открывается на 127.0.0.1:47821 — в остальных случаях это веб-версия.
    if (!LOCAL_HOSTS.includes(location.hostname) || location.port !== '47821') return false;
    try {
      const r = await fetch('api/health', { cache: 'no-store' });
      const j = await r.json();
      this.available = j.app === 'LyricWave';
      this.ytdlp = j.ytdlp;
    } catch {
      this.available = false;
    }
    if (this.available) {
      const ping = () => this.post('api/ping', {}).catch(() => {});
      ping();
      setInterval(ping, 15000);
    }
    return this.available;
  },

  async health() {
    const r = await fetch('api/health', { cache: 'no-store' });
    const j = await r.json();
    this.ytdlp = j.ytdlp;
    return j;
  },

  async post(path, body) {
    const r = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error(j.error || `Ошибка сервера (${r.status})`);
    return j;
  },

  resolve(url) {
    return this.post('api/resolve', { url });
  },

  search(query) {
    return this.post('api/search', { query }).then((j) => j.results);
  },

  // Скачивает звук в кэш (если ещё не скачан) и возвращает адрес для <audio>.
  async prepare(url, { onProgress, signal } = {}) {
    let job = await this.post('api/prepare', { url });
    while (job.state !== 'done') {
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
      if (job.state === 'error') throw new Error(job.error || 'Не удалось загрузить звук');
      onProgress?.(job.progress || 0, job.state);
      await sleep(350);
      job = await (await fetch(`api/job/${job.key}`, { cache: 'no-store' })).json();
    }
    onProgress?.(1, 'done');
    return `api/audio/${job.key}`;
  },

  imageUrl(url) {
    if (!url) return url;
    if (!this.available || /^https:\/\/i\.ytimg\.com\//.test(url) || url.startsWith('blob:')) return url;
    return 'api/img?url=' + encodeURIComponent(url);
  },
};
