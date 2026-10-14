import { $, $$, el, clamp, escapeHtml, fmtTime, PALETTES, paletteFromImage, uid } from './util.js';
import { icon } from './icons.js';
import { store, files, ytThumb, encodePlaylist, decodePlaylist } from './store.js';
import { backend } from './backend.js';
import { findLyrics, searchCandidates, lyricsFromCandidate, lyricsFromUserText, linesFor, buildTimeline, guessArtistTitle, cleanTitle, lineAt } from './lyrics.js';
import { MediaEngine, YouTubeEngine } from './player.js';
import { Analyzer, SyntheticAnalyzer } from './analysis.js';
import { Visuals, VISUALS } from './visuals.js';
import { LyricsView, TEXT_STYLES } from './textstyles.js';
import { webUrl } from './config.js';

// ------------------------------------------------------------ setup ---
store.load();
const S = store.settings;
$$('[data-icon]').forEach((b) => b.insertAdjacentHTML('afterbegin', icon(b.dataset.icon)));

const analyzer = new Analyzer();
const synth = new SyntheticAnalyzer();
const mediaA = new MediaEngine($('#audioA'), { analyzable: true });
const mediaB = new MediaEngine($('#audioB'), { analyzable: false });
const yt = new YouTubeEngine('yt');
const visuals = new Visuals($('#gl'), $('#c2d'));
const lyricsView = new LyricsView($('#lyrics'));

const st = {
  mode: 'home',
  track: null,
  engine: null,
  timeline: [],
  token: 0,
  duration: 0,
  autoPalette: null,
  history: [],
};

visuals.setStyle(S.visual);
lyricsView.setStyle(S.text);
applyPalette();
applyTextScale();

// ------------------------------------------------------------ helpers ---
function toast(msg, ms = 3200) {
  const t = $('#toast');
  t.innerHTML = msg;
  t.classList.add('show');
  clearTimeout(toast.h);
  toast.h = setTimeout(() => t.classList.remove('show'), ms);
}

function classify(url) {
  if (/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/.test(url)) {
    const id = url.match(/(?:v=|embed\/|shorts\/|live\/|youtu\.be\/)([A-Za-z0-9_-]{11})/)[1];
    return { kind: 'youtube', ytId: id, url: `https://www.youtube.com/watch?v=${id}` };
  }
  if (/\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|webm)(\?|#|$)/i.test(url)) return { kind: 'direct', url };
  return { kind: 'remote', url };
}

const isUrl = (s) => /^https?:\/\/\S+$/i.test(s.trim());
const canPlay = (t) => backend.available || t.source.kind !== 'remote';

function lyricsBadge(t) {
  const s = t.lyrics?.status;
  if (s === 'synced' || s === 'manual') return '<span class="pill ok">текст ✓</span>';
  if (s === 'approx') return '<span class="pill mid">текст ≈</span>';
  if (s === 'none') return '<span class="pill no">без текста</span>';
  return '';
}

function setCssPalette(p) {
  const r = document.documentElement.style;
  const c = (x) => x.map((v) => Math.round(v * 255)).join(' ');
  r.setProperty('--c1', c(p.a));
  r.setProperty('--c2', c(p.b));
  r.setProperty('--c3', c(p.c));
  r.setProperty('--bg', c(p.bg));
}

function applyPalette(instant) {
  const p = S.palette === 'auto' ? st.autoPalette || PALETTES.sunset : PALETTES[S.palette] || PALETTES.sunset;
  visuals.setPalette(p, instant);
  setCssPalette(p);
}

function applyTextScale() {
  document.documentElement.style.setProperty('--ts', S.textScale);
}

async function loadAutoPalette(track) {
  st.autoPalette = null;
  if (track.cover) {
    try {
      st.autoPalette = await paletteFromImage(backend.imageUrl(track.cover));
    } catch {}
  }
  if (st.track === track) applyPalette();
}

// ------------------------------------------------------------ library UI ---
function renderGrid() {
  const q = $('#filter').value.trim().toLowerCase();
  const grid = $('#grid');
  grid.innerHTML = '';
  const add = el('button', { class: 'card add', onclick: openAdd },
    el('div', { class: 'cover', html: icon('plus', 40) }),
    el('div', { class: 'info' }, el('div', { class: 't' }, 'Добавить песню'), el('div', { class: 'a' }, 'ссылка, название или файл')));
  grid.append(add);
  const list = store.tracks.filter((t) => !q || `${t.title} ${t.artist}`.toLowerCase().includes(q));
  for (const t of list) {
    const playing = st.track?.id === t.id;
    const card = el('div', { class: 'card' + (playing ? ' playing' : '') + (canPlay(t) ? '' : ' disabled'), tabindex: 0, 'data-id': t.id });
    const cover = el('div', { class: 'cover' });
    if (t.cover) cover.append(el('img', { src: t.cover, alt: '', loading: 'lazy', onerror: (e) => e.target.remove() }));
    else cover.append(el('div', { class: 'ph', html: icon('music', 38) }));
    cover.append(el('div', { class: 'play-ov', html: icon('play', 34) }));
    card.append(cover, el('div', { class: 'info' },
      el('div', { class: 't', title: t.title }, t.title || 'Без названия'),
      el('div', { class: 'a' }, t.artist || '—'),
      el('div', { class: 'badges', html: lyricsBadge(t) + (t.source.kind === 'file' ? '<span class="pill">файл</span>' : '') })));
    const menu = el('div', { class: 'card-menu' },
      el('button', { class: 'icon-btn xs', title: 'Текст песни', html: icon('edit', 16), onclick: (e) => { e.stopPropagation(); openLyricsDialog(t); } }),
      el('button', { class: 'icon-btn xs', title: 'Удалить', html: icon('trash', 16), onclick: (e) => { e.stopPropagation(); removeTrack(t); } }));
    card.append(menu);
    card.addEventListener('click', () => startTrack(t));
    card.addEventListener('keydown', (e) => e.key === 'Enter' && startTrack(t));
    grid.append(card);
  }
  const pill = $('#nowPill');
  pill.hidden = !st.track;
  if (st.track) pill.innerHTML = `${icon('wave', 18)} Сейчас играет: <b>${escapeHtml(st.track.title)}</b> — вернуться`;
}

function removeTrack(t) {
  if (!confirm(`Удалить «${t.title}» из библиотеки?`)) return;
  store.remove(t.id);
  if (st.track?.id === t.id) { stopAll(); st.track = null; }
  renderGrid();
  renderQueue();
}

function renderQueue() {
  const list = $('#queueList');
  list.innerHTML = '';
  for (const t of store.tracks) {
    const row = el('button', { class: 'qrow' + (st.track?.id === t.id ? ' on' : '') + (canPlay(t) ? '' : ' disabled'), onclick: () => startTrack(t) },
      t.cover ? el('img', { src: t.cover, alt: '' }) : el('span', { class: 'ph', html: icon('music', 18) }),
      el('span', { class: 'qt' }, el('b', {}, t.title), el('small', {}, t.artist || '—')),
      st.track?.id === t.id ? el('span', { class: 'eq', html: '<i></i><i></i><i></i>' }) : null);
    list.append(row);
  }
}

store.on(() => { if (st.mode === 'home') renderGrid(); renderQueue(); });
$('#filter').addEventListener('input', renderGrid);
$('#nowPill').addEventListener('click', () => showMode('player'));
$('#btnRestore').addEventListener('click', () => {
  const n = store.restorePresets();
  toast(n ? `Вернул ${n} песен` : 'Все предложенные песни уже в библиотеке');
});

function showMode(mode) {
  st.mode = mode;
  document.body.classList.toggle('mode-home', mode === 'home');
  document.body.classList.toggle('mode-player', mode === 'player');
  closePanels();
  if (mode === 'home') renderGrid();
  else renderQueue();
}

// ------------------------------------------------------------ playback ---
function stopAll() {
  for (const e of [mediaA, mediaB, yt]) { try { e.stop(); } catch {} }
  st.engine = null;
  $('#ytbox').hidden = true;
  setPlayIcon();
}

function loader(msg, { progress = null, actions = [] } = {}) {
  const L = $('#loader');
  if (!msg) { L.classList.remove('show'); return; }
  L.classList.add('show');
  L.classList.toggle('error', actions.length > 0);
  $('.msg', L).innerHTML = msg;
  const bar = $('.pbar', L);
  bar.style.visibility = progress == null ? 'hidden' : 'visible';
  if (progress != null) $('i', bar).style.width = (progress * 100).toFixed(1) + '%';
  const a = $('.actions', L);
  a.innerHTML = '';
  for (const [label, fn] of actions) a.append(el('button', { class: 'btn', onclick: fn }, label));
}

function startTrack(track) {
  analyzer.init();
  analyzer.resume();
  if (!canPlay(track)) {
    toast('Эта ссылка открывается только в приложении для компьютера — в веб-версии работают YouTube, прямые ссылки на аудио и файлы.', 5000);
    return;
  }
  playTrack(track);
}

async function playTrack(track) {
  const token = ++st.token;
  endTap();
  stopAll();
  st.track = track;
  st.duration = track.duration || 0;
  showMode('player');
  updateNow();
  lyricsView.setMeta(track);
  lyricsView.setNote('');
  synth.reset();
  analyzer.reset();
  refreshTimeline();
  loadAutoPalette(track);
  ensureLyrics(track, token);

  try {
    const plan = await planSource(track, token);
    if (token !== st.token) return;
    st.engine = plan.engine;
    $('#ytbox').hidden = plan.engine !== yt;
    $('#btnCapture').hidden = plan.engine.analyzable || analyzer.capturing;
    plan.engine.volume = S.volume;
    if (plan.engine === yt) {
      loader('Запускаю YouTube-плеер…');
      await yt.load(plan.ytId);
    } else {
      if (plan.engine === mediaA) analyzer.attachElement($('#audioA'));
      plan.engine.load(plan.src, { cors: plan.cors });
      await plan.engine.play().catch((e) => {
        if (e?.name === 'NotAllowedError') loader('Нажми ▶, чтобы начать', { actions: [['▶ Играть', () => { loader(''); st.engine?.play(); }]] });
        else throw e;
      });
    }
    prefetchNext();
  } catch (e) {
    if (token !== st.token || e?.name === 'AbortError') return;
    console.error(e);
    showError(e.message || String(e));
  }
}

function showError(msg) {
  loader(`<b>Не получилось включить трек</b><br><small>${escapeHtml(msg)}</small>`, {
    actions: [['Попробовать снова', () => st.track && playTrack(st.track)], ['Следующая', () => next()]],
  });
}

async function planSource(track, token) {
  const s = track.source;
  if (s.kind === 'file') {
    const blob = await files.get(s.fileKey);
    if (!blob) throw new Error('Файл не найден в хранилище браузера — добавь его заново');
    return { engine: mediaA, src: URL.createObjectURL(blob) };
  }
  if (backend.available) {
    loader('Загружаю звук…', { progress: 0 });
    const src = await backend.prepare(s.url, {
      onProgress: (p, state) => {
        if (token !== st.token) return;
        const label = backend.ytdlp?.state === 'downloading' ? 'Готовлю загрузчик (только при первом запуске)…' : state === 'queued' ? 'Ищу звук по ссылке…' : 'Загружаю звук…';
        loader(label, { progress: p });
      },
    });
    return { engine: mediaA, src };
  }
  if (s.kind === 'youtube') return { engine: yt, ytId: s.ytId };
  if (s.kind === 'direct') return { engine: mediaA, src: s.url, cors: true, fallback: true };
  throw new Error('Эта ссылка работает только в приложении для компьютера');
}

function prefetchNext() {
  if (!backend.available) return;
  const n = upcoming(1);
  if (n && n.source.kind !== 'file') backend.post('api/prepare', { url: n.source.url }).catch(() => {});
}

// События движков.
for (const eng of [mediaA, mediaB, yt]) {
  eng.on('playing', () => { if (eng === st.engine) { loader(''); setPlayIcon(); } });
  eng.on('play', () => eng === st.engine && setPlayIcon());
  eng.on('pause', () => eng === st.engine && setPlayIcon());
  eng.on('waiting', () => { if (eng === st.engine && eng !== yt) loader('Буферизация…'); });
  eng.on('ended', () => eng === st.engine && onEnded());
  eng.on('loadedmetadata', () => {
    if (eng !== st.engine || !st.track) return;
    const d = eng.duration;
    if (d && isFinite(d)) {
      const changed = Math.abs((st.track.duration || 0) - d) > 1;
      st.duration = d;
      if (changed) store.update(st.track.id, { duration: Math.round(d) });
      refreshTimeline();
      ensureLyrics(st.track, st.token);
    }
  });
  eng.on('error', (err) => {
    if (eng !== st.engine) return;
    // Прямая ссылка без CORS: играем через второй <audio>, без анализа звука.
    if (eng === mediaA && st.track?.source.kind === 'direct' && !backend.available) {
      st.engine = mediaB;
      mediaB.volume = S.volume;
      mediaB.load(st.track.source.url);
      mediaB.play().catch(() => {});
      $('#btnCapture').hidden = false;
      toast('Сайт не разрешает анализировать звук — анимация будет следовать за текстом.');
      return;
    }
    showError(err?.message || 'Ошибка воспроизведения');
  });
}

function onEnded() {
  if (S.repeat === 'one' && st.engine) { st.engine.seek(0); st.engine.play(); return; }
  next(true);
}

function playable() { return store.tracks.filter(canPlay); }

function upcoming(step) {
  const list = playable();
  if (!list.length) return null;
  if (S.shuffle && step > 0) {
    const others = list.filter((t) => t.id !== st.track?.id);
    return others.length ? others[(Math.random() * others.length) | 0] : list[0];
  }
  const i = list.findIndex((t) => t.id === st.track?.id);
  const j = i + step;
  if (j >= list.length) return S.repeat === 'off' ? null : list[0];
  if (j < 0) return list[list.length - 1];
  return list[j];
}

function next(auto) {
  const n = upcoming(1);
  if (!n) { if (auto) { setPlayIcon(); toast('Очередь закончилась'); } return; }
  if (st.track) st.history.push(st.track.id);
  playTrack(n);
}
function prev() {
  if (st.engine && st.engine.time > 4) { st.engine.seek(0); return; }
  const back = S.shuffle && st.history.length ? store.get(st.history.pop()) : upcoming(-1);
  if (back) playTrack(back);
}

function togglePlay() {
  analyzer.resume();
  if (!st.engine) { if (st.track) playTrack(st.track); return; }
  if (st.engine.paused) st.engine.play(); else st.engine.pause();
}

function setPlayIcon() {
  const playing = st.engine && !st.engine.paused;
  $('#btnPlay').innerHTML = icon(playing ? 'pause' : 'play', 30);
  document.body.classList.toggle('is-playing', !!playing);
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
}

function updateNow() {
  const t = st.track;
  if (!t) return;
  $('.now .t').textContent = t.title;
  $('.now .a').textContent = t.artist || '';
  const img = $('.now .cover');
  img.hidden = !t.cover;
  if (t.cover) img.src = t.cover;
  document.title = `${t.title} — LyricWave`;
  updateSync();
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist || '', artwork: t.cover ? [{ src: t.cover, sizes: '480x360' }] : [] });
  }
}

if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession;
  ms.setActionHandler('play', () => st.engine?.play());
  ms.setActionHandler('pause', () => st.engine?.pause());
  ms.setActionHandler('nexttrack', () => next());
  ms.setActionHandler('previoustrack', () => prev());
}

// ------------------------------------------------------------ lyrics ---
function refreshTimeline() {
  const t = st.track;
  if (!t) return;
  const lines = linesFor(t.lyrics, st.duration || t.duration);
  st.timeline = buildTimeline(lines, st.duration || t.duration);
  lyricsView.setTimeline(st.timeline);
  const s = t.lyrics?.status;
  const badge = $('#lyricsBadge');
  const dur = st.duration || t.duration;
  const mismatch = s === 'synced' && dur && t.lyrics.matchDuration && Math.abs(t.lyrics.matchDuration - dur) > 6 && !t.offset;
  badge.hidden = !(s === 'approx' || mismatch);
  if (s === 'approx') { badge.textContent = 'текст без точных таймингов'; badge.title = 'Строки расставлены примерно — нажми, чтобы подогнать, или вставь текст в формате LRC'; }
  if (mismatch) { badge.textContent = 'версия отличается — подогнать текст'; badge.title = 'Эта запись длиннее или короче альбомной, текст может опаздывать. Нажми и следуй подсказке.'; }
  if (s === 'none') {
    lyricsView.setNote(`<div>Текст не найден</div><button class="btn" data-act="find">Найти вручную</button>`);
  } else lyricsView.setNote('');
}

$('#lyrics').addEventListener('click', (e) => {
  if (e.target.closest('[data-act="find"]') && st.track) openLyricsDialog(st.track);
});

const lyricsJobs = new Map();
async function ensureLyrics(track, token) {
  const L = track.lyrics;
  const dur = st.track === track ? st.duration || track.duration : track.duration;
  if (L?.status === 'manual') return;
  const durKnown = dur && Math.round(dur);
  let need = !L;
  if (L && durKnown && L.checkedFor !== durKnown) {
    if (L.status === 'none') need = true;
    else if (L.matchDuration && Math.abs(L.matchDuration - dur) > 6) need = true;
  }
  if (!need) return;
  const key = track.id + ':' + (durKnown || 0);
  if (lyricsJobs.has(key)) return lyricsJobs.get(key);
  const job = (async () => {
    if (st.track === track && !L) lyricsView.setNote('<div class="soft">Ищу текст песни…</div>');
    try {
      const res = await findLyrics({ artist: track.artist, title: track.title, duration: durKnown || null });
      res.checkedFor = durKnown || null;
      // Не заменяем найденный текст на «не найдено» при повторной проверке.
      if (res.status === 'none' && L && L.status !== 'none') store.update(track.id, { lyrics: { ...L, checkedFor: durKnown } });
      else store.update(track.id, { lyrics: res });
    } catch (e) {
      console.warn('lyrics', e);
      if (st.track === track && !track.lyrics) lyricsView.setNote(`<div>Не удалось связаться с базой текстов</div><button class="btn" data-act="find">Повторить</button>`);
      return;
    } finally {
      lyricsJobs.delete(key);
    }
    if (st.track === track && token === st.token) refreshTimeline();
  })();
  lyricsJobs.set(key, job);
  return job;
}

// Фоновая подгрузка текстов для только что добавленных песен.
let bgQueue = Promise.resolve();
function lyricsInBackground(track) {
  bgQueue = bgQueue.then(() => ensureLyrics(track, -1)).catch(() => {});
}

// ------------------------------------------------------------ sync offset ---
function updateSync() {
  const o = st.track?.offset || 0;
  $('#syncVal').textContent = Math.abs(o) < 0.01 ? 'синхр.' : o > 0 ? `раньше ${o.toFixed(2)} с` : `позже ${(-o).toFixed(2)} с`;
}
function shiftSync(d) {
  if (!st.track) return;
  const o = Math.round(((st.track.offset || 0) + d) * 100) / 100;
  store.update(st.track.id, { offset: o });
  updateSync();
}
// «Подогнать»: показываем строку, пользователь жмёт, когда она зазвучит.
let tap = null;
function tapSync() {
  if (!st.track || !st.engine || !st.timeline.length) { toast('Сначала нужен текст песни'); return; }
  if (!tap) {
    const lt = st.engine.time + (st.track.offset || 0);
    let i = lineAt(st.timeline, lt) + 1;
    if (st.engine.time < 30 || i >= st.timeline.length) i = 0;
    if (i === 0 && st.engine.time > st.timeline[0].t + 30) st.engine.seek(0);
    tap = { i };
    const cue = el('div', { class: 'tapcue' }, 'Нажми «подогнать» (или Enter), когда услышишь строку:', el('b', {}, st.timeline[i].text));
    $('#player').append(cue);
    tap.cue = cue;
    $('#syncTap').classList.add('on');
    return;
  }
  const offset = Math.round((st.timeline[tap.i].t - st.engine.time + 0.15) * 100) / 100;
  store.update(st.track.id, { offset });
  endTap();
  updateSync();
  refreshTimeline();
  toast('Текст подогнан ✓ Точнее — кнопками ◀ ▶');
}
function endTap() {
  tap?.cue.remove();
  tap = null;
  $('#syncTap').classList.remove('on');
}
$('#syncTap').addEventListener('click', tapSync);
$('#lyricsBadge').addEventListener('click', () => {
  if (st.track?.lyrics?.status === 'approx' && !st.engine) return openLyricsDialog(st.track);
  tapSync();
});
$('#syncEarlier').addEventListener('click', () => shiftSync(0.25));
$('#syncLater').addEventListener('click', () => shiftSync(-0.25));
$('#syncEarlier').title = 'Текст раньше ( [ )';
$('#syncLater').title = 'Текст позже ( ] )';

// ------------------------------------------------------------ controls ---
$('#btnPlay').addEventListener('click', togglePlay);
$('#btnNext').addEventListener('click', () => next());
$('#btnPrev').addEventListener('click', () => prev());
$('#btnBack').addEventListener('click', () => showMode('home'));
$('#btnFull').addEventListener('click', toggleFull);
$('#btnQueue').addEventListener('click', () => togglePanel('#queuePanel'));
$('#btnStyle').addEventListener('click', () => togglePanel('#stylePanel'));
$('#btnStyleHome').addEventListener('click', () => togglePanel('#stylePanel'));
$('#btnLyricsEdit').addEventListener('click', () => st.track && openLyricsDialog(st.track));
$('#btnAddFromQueue').addEventListener('click', openAdd);
$('#btnShare').addEventListener('click', openShare);

function toggleFull() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
}

function updateModes() {
  $('#btnShuffle').classList.toggle('on', S.shuffle);
  const r = $('#btnRepeat');
  r.classList.toggle('on', S.repeat !== 'off');
  r.dataset.one = S.repeat === 'one' ? '1' : '';
  r.title = { all: 'Повтор очереди', one: 'Повтор песни', off: 'Без повтора' }[S.repeat];
}
$('#btnShuffle').addEventListener('click', () => { store.set('shuffle', !S.shuffle); updateModes(); });
$('#btnRepeat').addEventListener('click', () => {
  store.set('repeat', { all: 'one', one: 'off', off: 'all' }[S.repeat]);
  updateModes();
  toast($('#btnRepeat').title);
});
updateModes();

const vol = $('#vol');
vol.value = S.volume;
function setVolume(v) {
  v = clamp(v);
  store.set('volume', v);
  vol.value = v;
  for (const e of [mediaA, mediaB, yt]) e.volume = v;
  $('#btnMute').innerHTML = icon(v === 0 ? 'mute' : 'volume');
}
vol.addEventListener('input', () => setVolume(+vol.value));
$('#btnMute').addEventListener('click', () => {
  if (S.volume > 0) { setVolume.prev = S.volume; setVolume(0); } else setVolume(setVolume.prev || 0.8);
});
setVolume(S.volume);

// Перемотка.
const bar = $('#bar');
function seekFromEvent(e) {
  const r = bar.getBoundingClientRect();
  const p = clamp((e.clientX - r.left) / r.width);
  const d = st.engine?.duration || st.duration;
  if (st.engine && d) st.engine.seek(p * d);
}
bar.addEventListener('pointerdown', (e) => {
  bar.setPointerCapture(e.pointerId);
  seekFromEvent(e);
  const move = (ev) => seekFromEvent(ev);
  bar.addEventListener('pointermove', move);
  bar.addEventListener('pointerup', () => bar.removeEventListener('pointermove', move), { once: true });
});

// Захват звука вкладки для YouTube в веб-версии.
$('#btnCapture').addEventListener('click', async () => {
  try {
    toast('Выбери <b>эту вкладку</b> и включи «Поделиться звуком вкладки»', 6000);
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true, audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      preferCurrentTab: true, selfBrowserSurface: 'include', systemAudio: 'include',
    });
    if (!stream.getAudioTracks().length) {
      stream.getTracks().forEach((t) => t.stop());
      toast('Звук не передан — поставь галочку «Поделиться звуком»');
      return;
    }
    analyzer.attachStream(stream);
    analyzer.resume();
    stream.getAudioTracks()[0].addEventListener('ended', () => { analyzer.detachStream(); $('#btnCapture').hidden = false; });
    $('#btnCapture').hidden = true;
    toast('Анимация слышит музыку ✓');
  } catch (e) {
    if (e.name !== 'NotAllowedError') toast('Не удалось захватить звук: ' + escapeHtml(e.message));
  }
});

// ------------------------------------------------------------ panels ---
function togglePanel(sel) {
  const p = $(sel);
  const open = !p.classList.contains('open');
  closePanels();
  p.classList.toggle('open', open);
  if (open && sel === '#queuePanel') renderQueue();
}
function closePanels() { $$('.panel').forEach((p) => p.classList.remove('open')); }
$$('.panel [data-close]').forEach((b) => b.addEventListener('click', closePanels));

function renderStyleOptions() {
  const vo = $('#visualOpts');
  vo.innerHTML = '';
  for (const v of VISUALS) {
    vo.append(el('button', { class: 'opt' + (S.visual === v.id ? ' on' : ''), onclick: () => setVisual(v.id) },
      el('span', { class: 'sw', style: { background: v.preview } }), el('span', {}, v.name)));
  }
  const to = $('#textOpts');
  to.innerHTML = '';
  for (const t of TEXT_STYLES) {
    to.append(el('button', { class: 'opt' + (S.text === t.id ? ' on' : ''), onclick: () => setText(t.id) },
      el('span', { class: 'sw txt', style: { fontFamily: t.font }, 'data-style': t.id }, t.sample), el('span', {}, t.name)));
  }
  const po = $('#palOpts');
  po.innerHTML = '';
  const chip = (id, name, p) => {
    const b = el('button', { class: 'chip' + (S.palette === id ? ' on' : ''), onclick: () => { store.set('palette', id); applyPalette(); renderStyleOptions(); } });
    const dots = el('span', { class: 'dots' });
    if (p) for (const c of [p.a, p.b, p.c]) dots.append(el('i', { style: { background: `rgb(${c.map((x) => (x * 255) | 0).join(',')})` } }));
    else dots.append(el('i', { class: 'auto' }));
    b.append(dots, name);
    return b;
  };
  po.append(chip('auto', 'Из обложки', null));
  for (const [id, p] of Object.entries(PALETTES)) po.append(chip(id, p.name, p));
  $('#optReact').value = S.reactivity;
  $('#optSize').value = S.textScale;
}
function setVisual(id) { store.set('visual', id); visuals.setStyle(id); renderStyleOptions(); }
function setText(id) { store.set('text', id); lyricsView.setStyle(id); renderStyleOptions(); }
$('#optReact').addEventListener('input', (e) => store.set('reactivity', +e.target.value));
$('#optSize').addEventListener('input', (e) => { store.set('textScale', +e.target.value); applyTextScale(); });
renderStyleOptions();

// ------------------------------------------------------------ add dialog ---
const dlgAdd = $('#dlgAdd');
function openAdd() {
  $('#addResults').innerHTML = '';
  $('#addInput').value = '';
  $('#addHint').innerHTML = backend.available
    ? 'Подойдёт ссылка почти с любого сайта с музыкой или видео: YouTube, SoundCloud, VK, Bandcamp, Vimeo… Можно просто написать название — найду на YouTube.'
    : 'В веб-версии работают ссылки YouTube и прямые ссылки на аудиофайлы. Другие сайты и поиск по названию — в приложении для компьютера.';
  dlgAdd.showModal();
  setTimeout(() => $('#addInput').focus(), 50);
}
$('#addGo').addEventListener('click', addGo);
$('#addInput').addEventListener('keydown', (e) => e.key === 'Enter' && addGo());

function busy(box, msg) { box.innerHTML = `<div class="busy"><span class="spin"></span>${msg}</div>`; }

async function addGo() {
  const v = $('#addInput').value.trim();
  const box = $('#addResults');
  if (!v) return;
  if (isUrl(v)) return addFromUrl(v, box);
  if (!backend.available) {
    box.innerHTML = '<p class="warn">Поиск по названию доступен в приложении для компьютера. Здесь вставь ссылку на YouTube: открой песню на youtube.com и скопируй адрес.</p>';
    return;
  }
  busy(box, 'Ищу на YouTube…');
  try {
    const res = await backend.search(v);
    box.innerHTML = '';
    if (!res.length) { box.innerHTML = '<p class="warn">Ничего не нашлось</p>'; return; }
    const list = el('div', { class: 'results' });
    for (const r of res) {
      list.append(el('button', { class: 'res', onclick: () => addFromUrl(r.url, box, r) },
        el('img', { src: r.thumbnail, alt: '' }),
        el('span', { class: 'rt' }, el('b', {}, r.title), el('small', {}, `${r.uploader || ''} · ${fmtTime(r.duration)}`))));
    }
    box.append(list);
  } catch (e) {
    box.innerHTML = `<p class="warn">${escapeHtml(e.message)}</p>`;
  }
}

async function addFromUrl(url, box, known) {
  const src = classify(url);
  busy(box, 'Смотрю, что за песня…');
  try {
    let info;
    if (backend.available) {
      info = known && known.duration ? known : await backend.resolve(src.url);
      if (info.type === 'playlist') return addPlaylist(info, box);
    } else if (src.kind === 'youtube') {
      const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(src.url)}`);
      if (!r.ok) throw new Error('Видео недоступно или запрещено для встраивания');
      const j = await r.json();
      info = { title: j.title, uploader: j.author_name, thumbnail: ytThumb(src.ytId) };
    } else if (src.kind === 'direct') {
      const name = decodeURIComponent(url.split(/[?#]/)[0].split('/').pop()).replace(/\.\w+$/, '').replace(/[_+]/g, ' ');
      info = { title: name };
    } else {
      box.innerHTML = '<p class="warn">Ссылки на этот сайт открываются только в приложении для компьютера (там встроен универсальный загрузчик). В веб-версии используй YouTube или прямую ссылку на аудиофайл.</p>';
      return;
    }
    const guess = guessArtistTitle(info);
    showPreview(box, {
      source: src.kind === 'youtube' ? src : { kind: src.kind, url: info.url || src.url },
      title: guess.title || cleanTitle(info.title) || 'Без названия',
      artist: guess.artist,
      duration: info.duration ? Math.round(info.duration) : null,
      cover: src.kind === 'youtube' ? ytThumb(src.ytId) : info.thumbnail || '',
    });
  } catch (e) {
    box.innerHTML = `<p class="warn">Не удалось: ${escapeHtml(e.message)}</p>`;
  }
}

function showPreview(box, draft) {
  box.innerHTML = '';
  const card = el('div', { class: 'preview' });
  const ti = el('input', { type: 'text', value: draft.title });
  const ar = el('input', { type: 'text', value: draft.artist || '', placeholder: 'Исполнитель' });
  const status = el('div', { class: 'lstatus' });
  let lyr = null, seq = 0;
  const look = async () => {
    const my = ++seq;
    status.innerHTML = '<span class="spin"></span> Ищу текст…';
    try {
      const r = await findLyrics({ artist: ar.value.trim(), title: ti.value.trim(), duration: draft.duration });
      if (my !== seq) return;
      lyr = { ...r, checkedFor: draft.duration || null };
      const diff = r.matchDuration && draft.duration ? Math.round(draft.duration - r.matchDuration) : 0;
      const warn = Math.abs(diff) > 6 ? `<br><small class="mid">Эта запись ${diff > 0 ? 'длиннее' : 'короче'} альбомной на ${Math.abs(diff)} с — если текст будет опаздывать, нажми «подогнать» во время песни.</small>` : '';
      status.innerHTML = r.status === 'synced' ? `<span class="ok">✓ Синхронизированный текст: ${escapeHtml(r.name)}</span>${warn}`
        : r.status === 'approx' ? `<span class="mid">≈ Текст без таймингов: ${escapeHtml(r.name)} — строки расставлю примерно</span>`
          : '<span class="no">Текст не найден — проверь исполнителя и название</span>';
    } catch { if (my === seq) status.innerHTML = '<span class="no">База текстов недоступна</span>'; }
  };
  let tmr;
  const relook = () => { clearTimeout(tmr); tmr = setTimeout(look, 600); };
  ti.addEventListener('input', relook);
  ar.addEventListener('input', relook);
  const save = (play) => {
    const t = store.add({ ...draft, title: ti.value.trim() || draft.title, artist: ar.value.trim(), lyrics: lyr });
    dlgAdd.close();
    toast(`Добавлено: <b>${escapeHtml(t.title)}</b>`);
    if (play) startTrack(t);
    else if (!lyr) lyricsInBackground(t);
  };
  card.append(
    draft.cover ? el('img', { src: draft.cover, alt: '' }) : el('div', { class: 'ph', html: icon('music', 40) }),
    el('div', { class: 'pf' },
      el('label', {}, 'Название', ti),
      el('label', {}, 'Исполнитель', ar),
      status,
      el('div', { class: 'row-end left' },
        el('button', { class: 'btn primary', onclick: () => save(true), html: icon('play', 18) + 'Добавить и включить' }),
        el('button', { class: 'btn', onclick: () => save(false) }, 'Просто добавить'))));
  box.append(card);
  look();
}

function addPlaylist(info, box) {
  box.innerHTML = '';
  const n = info.entries.length;
  box.append(el('div', { class: 'preview pl' },
    el('div', { class: 'pf' },
      el('b', {}, `Плейлист «${info.title}»: ${n} песен`),
      el('div', { class: 'row-end left' }, el('button', {
        class: 'btn primary', onclick: () => {
          const added = [];
          for (const e of info.entries.slice().reverse()) {
            const src = classify(e.url);
            const g = guessArtistTitle(e);
            added.push(store.add({ source: src.kind === 'youtube' ? src : { kind: 'remote', url: e.url }, title: g.title || e.title, artist: g.artist, duration: e.duration ? Math.round(e.duration) : null, cover: src.kind === 'youtube' ? ytThumb(src.ytId) : e.thumbnail }));
          }
          added.reverse().forEach(lyricsInBackground);
          dlgAdd.close();
          toast(`Добавлено песен: ${n}`);
        },
      }, 'Добавить все')))));
}

// Файлы с компьютера.
$('#fileInput').addEventListener('change', (e) => { addFiles([...e.target.files]); e.target.value = ''; });
const dz = $('#dropZone');
dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
dz.addEventListener('dragleave', () => dz.classList.remove('over'));
dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('over'); addFiles([...e.dataTransfer.files]); });
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  e.preventDefault();
  const fs = [...(e.dataTransfer?.files || [])].filter((f) => /^(audio|video)\//.test(f.type) || /\.(mp3|m4a|flac|ogg|opus|wav|webm)$/i.test(f.name));
  if (fs.length) addFiles(fs);
});

function fileDuration(file) {
  return new Promise((res) => {
    const a = new Audio();
    const u = URL.createObjectURL(file);
    a.preload = 'metadata';
    a.onloadedmetadata = () => { res(isFinite(a.duration) ? Math.round(a.duration) : null); URL.revokeObjectURL(u); };
    a.onerror = () => { res(null); URL.revokeObjectURL(u); };
    a.src = u;
  });
}

async function addFiles(list) {
  if (!list.length) return;
  let first = null;
  for (const f of list) {
    const key = uid('file');
    await files.put(key, f);
    const base = f.name.replace(/\.\w+$/, '').replace(/_/g, ' ');
    const g = guessArtistTitle({ title: base });
    const t = store.add({ source: { kind: 'file', fileKey: key, name: f.name }, title: g.title || base, artist: g.artist, duration: await fileDuration(f), cover: '' });
    lyricsInBackground(t);
    first ??= t;
  }
  if (dlgAdd.open) dlgAdd.close();
  toast(list.length === 1 ? `Добавлено: <b>${escapeHtml(first.title)}</b>` : `Добавлено файлов: ${list.length}`);
  if (list.length === 1) startTrack(first);
}

// ------------------------------------------------------------ lyrics dialog ---
const dlgL = $('#dlgLyrics');
let lyrTrack = null;
function openLyricsDialog(track) {
  lyrTrack = track;
  $('#lyrArtist').value = track.artist || '';
  $('#lyrTitle').value = track.title || '';
  $('#lyrText').value = '';
  $('#lyrResults').innerHTML = '';
  const L = track.lyrics;
  $('#lyrCurrent').innerHTML = !L ? 'Текст ещё не искали.' : L.status === 'none' ? 'Текст не найден автоматически — поправь исполнителя и название и поищи снова.'
    : `Сейчас: ${escapeHtml(L.name || '')} ${L.status === 'synced' ? '(синхронизированный)' : L.status === 'manual' ? '(свой)' : '(без таймингов)'}`;
  dlgL.showModal();
}
$('#lyrSearch').addEventListener('click', async () => {
  const box = $('#lyrResults');
  busy(box, 'Ищу…');
  try {
    const dur = st.track === lyrTrack ? st.duration || lyrTrack.duration : lyrTrack.duration;
    const list = (await searchCandidates({ artist: $('#lyrArtist').value.trim(), title: $('#lyrTitle').value.trim(), duration: dur })).filter((c) => c.syncedLyrics || c.plainLyrics).slice(0, 10);
    box.innerHTML = list.length ? '' : '<p class="warn">Ничего не найдено</p>';
    for (const c of list) {
      const dd = dur && c.duration ? Math.round(c.duration - dur) : null;
      box.append(el('button', {
        class: 'res', onclick: () => {
          store.update(lyrTrack.id, { lyrics: { ...lyricsFromCandidate(c, dur), checkedFor: dur ? Math.round(dur) : null }, artist: $('#lyrArtist').value.trim(), title: $('#lyrTitle').value.trim() });
          afterLyricsChange();
        },
      }, el('span', { class: 'rt' },
        el('b', {}, `${c.artistName} — ${c.trackName}`),
        el('small', {}, `${c.albumName || ''} · ${fmtTime(c.duration)}${dd != null ? ` (${dd > 0 ? '+' : ''}${dd} с)` : ''} · ${c.syncedLyrics ? 'с таймингами ✓' : 'без таймингов'}`))));
    }
  } catch (e) { box.innerHTML = `<p class="warn">${escapeHtml(e.message)}</p>`; }
});
$('#lyrApply').addEventListener('click', () => {
  const txt = $('#lyrText').value.trim();
  if (!txt) return;
  store.update(lyrTrack.id, { lyrics: lyricsFromUserText(txt, st.duration || lyrTrack.duration) });
  afterLyricsChange();
});
$('#lyrClear').addEventListener('click', () => {
  store.update(lyrTrack.id, { lyrics: { status: 'manual', lines: [], name: 'без текста' } });
  afterLyricsChange();
});
function afterLyricsChange() {
  dlgL.close();
  if (st.track?.id === lyrTrack.id) { updateNow(); lyricsView.setMeta(st.track); refreshTimeline(); }
  toast('Текст обновлён');
}

// ------------------------------------------------------------ share ---
const dlgS = $('#dlgShare');
function openShare(prefill) {
  const url = webUrl();
  $('#shareLink').hidden = !url;
  $('#importText').value = typeof prefill === 'string' ? prefill : '';
  $('#shareAppHint').innerHTML = (backend.available
    ? 'Отправь друзьям файл <b>LyricWave.exe</b> — он работает без установки.'
    : 'Друзья могут открыть эту же страницу по ссылке или скачать версию для компьютера.')
    + (url ? `<br>Веб-версия: <a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(url)}</a>` : '');
  dlgS.showModal();
}
async function copy(text, msg) {
  try { await navigator.clipboard.writeText(text); toast(msg); } catch { prompt('Скопируй:', text); }
}
$('#shareCode').addEventListener('click', () => copy(encodePlaylist(store.tracks), 'Код плейлиста скопирован — отправь его другу'));
$('#shareLink').addEventListener('click', () => copy(webUrl() + '#import=' + encodePlaylist(store.tracks), 'Ссылка скопирована'));
$('#importGo').addEventListener('click', () => {
  try {
    const items = decodePlaylist($('#importText').value);
    const have = new Set(store.tracks.map((t) => t.source.url));
    let n = 0;
    for (const it of items.reverse()) {
      if (!it.url || have.has(it.url)) continue;
      const src = classify(it.url);
      const t = store.add({ source: src, title: it.title, artist: it.artist, offset: it.offset || 0, cover: src.kind === 'youtube' ? ytThumb(src.ytId) : '' });
      lyricsInBackground(t);
      n++;
    }
    dlgS.close();
    history.replaceState(null, '', location.pathname);
    toast(n ? `Добавлено песен: ${n}` : 'Все эти песни у тебя уже есть');
  } catch { toast('Не получилось прочитать код плейлиста'); }
});

// ------------------------------------------------------------ keyboard ---
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea') || document.querySelector('dialog[open]')) return;
  const k = e.key;
  if (k === ' ') { e.preventDefault(); if (st.mode === 'player' || st.track) togglePlay(); }
  else if (k === 'ArrowRight' && e.shiftKey) next();
  else if (k === 'ArrowLeft' && e.shiftKey) prev();
  else if (k === 'ArrowRight' && st.engine) st.engine.seek(st.engine.time + 5);
  else if (k === 'ArrowLeft' && st.engine) st.engine.seek(st.engine.time - 5);
  else if (k === 'ArrowUp') { e.preventDefault(); setVolume(S.volume + 0.05); }
  else if (k === 'ArrowDown') { e.preventDefault(); setVolume(S.volume - 0.05); }
  else if (k === 'n' || k === 'т') next();
  else if (k === 'p' || k === 'з') prev();
  else if (k === 'f' || k === 'а') toggleFull();
  else if (k === 'l' || k === 'д') togglePanel('#queuePanel');
  else if (k === 's' || k === 'ы') togglePanel('#stylePanel');
  else if (k === '[' || k === 'х') shiftSync(0.25);
  else if (k === ']' || k === 'ъ') shiftSync(-0.25);
  else if (k === 'v' || k === 'м') setVisual(VISUALS[(VISUALS.findIndex((v) => v.id === S.visual) + 1) % VISUALS.length].id);
  else if (k === 't' || k === 'е') setText(TEXT_STYLES[(TEXT_STYLES.findIndex((v) => v.id === S.text) + 1) % TEXT_STYLES.length].id);
  else if (k === 'Enter' && tap) tapSync();
  else if (k === 'Escape' && tap) endTap();
  else if (k === 'Escape') { if ($('.panel.open')) closePanels(); else if (st.mode === 'player' && !document.fullscreenElement) showMode('home'); }
});

// Автоскрытие интерфейса во время песни.
let idleT;
function wake() {
  document.body.classList.remove('idle');
  clearTimeout(idleT);
  idleT = setTimeout(() => {
    if (st.mode === 'player' && st.engine && !st.engine.paused && !tap && !$('.panel.open') && !document.querySelector('dialog[open]')) document.body.classList.add('idle');
  }, 3200);
}
['mousemove', 'pointerdown', 'keydown', 'wheel'].forEach((ev) => addEventListener(ev, wake, { passive: true }));

// ------------------------------------------------------------ render loop ---
const root = document.documentElement.style;
let lastT = performance.now();
let lastUi = 0;
function frame(now) {
  const dt = clamp((now - lastT) / 1000, 0.001, 0.1);
  lastT = now;
  const eng = st.engine;
  const playing = !!eng && !eng.paused;
  const time = eng ? eng.time : 0;
  const lt = time + (st.track?.offset || 0);
  const useReal = st.mode === 'player' && eng && (eng.analyzable || analyzer.capturing);
  const F = useReal
    ? analyzer.sample(dt, S.reactivity)
    : synth.sample(dt, { time: lt, playing: playing && st.mode === 'player', timeline: st.timeline }, S.reactivity);
  visuals.frame(F, dt);
  if (st.mode === 'player') {
    lyricsView.update(lt, F);
    root.setProperty('--pulse', F.pulse.toFixed(3));
    root.setProperty('--energy', F.energy.toFixed(3));
    root.setProperty('--int', F.intensity.toFixed(3));
    if (now - lastUi > 120) {
      lastUi = now;
      const d = (eng && eng.duration) || st.duration || 0;
      $('#tCur').textContent = fmtTime(time);
      $('#tDur').textContent = fmtTime(d);
      const p = d ? clamp(time / d) : 0;
      bar.style.setProperty('--p', p);
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.LW = { st, analyzer, store };

// ------------------------------------------------------------ boot ---
(async () => {
  await backend.detect();
  document.body.classList.toggle('desktop', backend.available);
  $('#modeHint').innerHTML = backend.available
    ? 'Добавляй песни ссылкой почти с любого сайта или просто названием. Анимация слушает музыку.'
    : 'Веб-версия: песни с YouTube, прямые ссылки и файлы. Для любых сайтов — версия для компьютера.';
  renderGrid();
  if (backend.available && backend.ytdlp?.state !== 'ready') {
    const poll = setInterval(async () => {
      const h = await backend.health().catch(() => null);
      if (h?.ytdlp?.state === 'ready' || h?.ytdlp?.state === 'error') {
        clearInterval(poll);
        if (h.ytdlp.state === 'error') toast(escapeHtml(h.ytdlp.message), 8000);
      }
    }, 1500);
  }
  const m = location.hash.match(/import=([A-Za-z0-9_-]+)/);
  if (m) openShare(m[1]);
  // Тексты для песен библиотеки ищем заранее, по одному, чтобы не дёргать базу пачкой.
  store.tracks.filter((t) => !t.lyrics).forEach(lyricsInBackground);
})();
