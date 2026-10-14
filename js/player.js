// Единый интерфейс плеера над двумя «движками»:
//  * MediaEngine — <audio>; звук идёт через Web Audio, поэтому анимация слышит музыку;
//  * YouTubeEngine — встроенный плеер YouTube (веб-версия), звук анализировать нельзя.

class Emitter {
  constructor() { this.h = {}; }
  on(e, f) { (this.h[e] ??= []).push(f); return this; }
  emit(e, ...a) { (this.h[e] || []).forEach((f) => f(...a)); }
}

export class MediaEngine extends Emitter {
  constructor(audio, { analyzable }) {
    super();
    this.kind = 'media';
    this.a = audio;
    this.analyzable = analyzable;
    for (const ev of ['play', 'pause', 'ended', 'loadedmetadata', 'waiting', 'playing']) {
      audio.addEventListener(ev, () => this.emit(ev));
    }
    audio.addEventListener('error', () => this.emit('error', audio.error));
  }
  load(src, { cors = false } = {}) {
    if (cors) this.a.crossOrigin = 'anonymous';
    else this.a.removeAttribute('crossorigin');
    this.a.src = src;
    this.a.load();
  }
  play() { return this.a.play(); }
  pause() { this.a.pause(); }
  stop() { this.a.pause(); this.a.removeAttribute('src'); this.a.load(); }
  seek(t) { if (isFinite(t)) this.a.currentTime = Math.max(0, t); }
  get time() { return this.a.currentTime || 0; }
  get duration() { return isFinite(this.a.duration) ? this.a.duration : 0; }
  get paused() { return this.a.paused; }
  set volume(v) { this.a.volume = v; }
}

let ytApi;
function loadYouTubeApi() {
  ytApi ??= new Promise((res, rej) => {
    if (window.YT?.Player) return res(window.YT);
    window.onYouTubeIframeAPIReady = () => res(window.YT);
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => rej(new Error('Не удалось загрузить YouTube-плеер'));
    document.head.append(s);
  });
  return ytApi;
}

export class YouTubeEngine extends Emitter {
  constructor(hostId) {
    super();
    this.kind = 'youtube';
    this.analyzable = false;
    this.hostId = hostId;
    this.player = null;
    this._t = 0;
    this._stamp = 0;
    this._playing = false;
    this._vol = 0.85;
  }
  async ensure() {
    if (this.player) return this.player;
    const YT = await loadYouTubeApi();
    await new Promise((res) => {
      this.player = new YT.Player(this.hostId, {
        width: '100%', height: '100%',
        playerVars: { autoplay: 1, controls: 1, playsinline: 1, rel: 0, modestbranding: 1, iv_load_policy: 3 },
        events: {
          onReady: () => res(),
          onStateChange: (e) => this._state(e.data),
          onError: (e) => this.emit('error', { code: e.data, message: ytError(e.data) }),
        },
      });
    });
    this.player.setVolume(this._vol * 100);
    return this.player;
  }
  _state(s) {
    const YT = window.YT;
    this._sync();
    if (s === YT.PlayerState.PLAYING) {
      this._playing = true;
      this.emit('play'); this.emit('playing');
      if (!this._metaSent) { this._metaSent = true; this.emit('loadedmetadata'); }
    } else if (s === YT.PlayerState.PAUSED) { this._playing = false; this.emit('pause'); }
    else if (s === YT.PlayerState.ENDED) { this._playing = false; this.emit('ended'); }
    else if (s === YT.PlayerState.BUFFERING) { this.emit('waiting'); }
  }
  _sync() {
    if (!this.player?.getCurrentTime) return;
    this._t = this.player.getCurrentTime() || 0;
    this._stamp = performance.now();
  }
  async load(videoId) {
    await this.ensure();
    this._metaSent = false;
    this._t = 0; this._stamp = performance.now();
    this.player.loadVideoById(videoId);
  }
  play() { this.player?.playVideo(); return Promise.resolve(); }
  pause() { this.player?.pauseVideo(); }
  stop() { this.player?.stopVideo(); this._playing = false; }
  seek(t) { this.player?.seekTo(Math.max(0, t), true); this._t = t; this._stamp = performance.now(); }
  get time() {
    // getCurrentTime обновляется рывками — интерполируем между опросами.
    const now = performance.now();
    if (now - this._stamp > 250) this._sync();
    return this._playing ? this._t + (performance.now() - this._stamp) / 1000 : this._t;
  }
  get duration() { return this.player?.getDuration?.() || 0; }
  get paused() { return !this._playing; }
  set volume(v) { this._vol = v; this.player?.setVolume?.(v * 100); }
}

function ytError(code) {
  if (code === 101 || code === 150) return 'Владелец видео запретил проигрывание на других сайтах';
  if (code === 100) return 'Видео не найдено или удалено';
  if (code === 2) return 'Неверная ссылка на видео';
  return 'Ошибка YouTube-плеера (' + code + ')';
}
