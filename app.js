// 92.4 小收音机 — Symphony 92.4 with one button.
// You can't tune it or pick a song: turn it on and listen.

const MOUNT = 'SYMPHONY924AAC';
// MP3_SYMPHONY924 isn't geo-blocked, so it gets a few tries (slow links often
// time out once) before the AAC mount, which only plays inside Singapore.
const GLOBAL_MP3 = 'https://playerservices.streamtheworld.com/api/livestream-redirect/MP3_SYMPHONY924.mp3';
const STREAMS = [
  GLOBAL_MP3,
  GLOBAL_MP3,
  GLOBAL_MP3,
  `https://playerservices.streamtheworld.com/api/livestream-redirect/${MOUNT}.aac`,
];
const NOW_PLAYING_URL =
  `https://np.tritondigital.com/public/nowplaying?mountName=${MOUNT}&numberToFetch=6&eventType=track`;
const POLL_MS = 15000;

const $ = (id) => document.getElementById(id);
const app = $('app');
const radio = $('radio'); // kept as a reference: it may move into the floating window
const audio = $('audio');

const s = {
  on: false,
  stream: 'off', // off | loading | live | blocked | error
  streamIndex: 0,
  track: null,
  history: [],
};

// ---------- a little static while it tunes in ----------

let ctx, hissGain;

function initAudio() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let brown = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      brown = (brown + 0.02 * white) / 1.02;
      data[i] = white * 0.5 + brown * 2.5;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 2200;
    band.Q.value = 0.5;
    hissGain = ctx.createGain();
    hissGain.gain.value = 0;
    noise.connect(band).connect(hissGain).connect(ctx.destination);
    noise.start();
  }
  if (ctx.state === 'suspended') ctx.resume();
}

function setHiss(level) {
  if (ctx) hissGain.gain.setTargetAtTime(level, ctx.currentTime, level ? 0.08 : 0.4);
}

// ---------- power & stream ----------

function setState(key, value) {
  app.dataset[key] = value;
  radio.dataset[key] = value;
}

function setPower(on) {
  if (on === s.on) return;
  initAudio();
  s.on = on;
  setState('power', on ? 'on' : 'off');
  $('power').setAttribute('aria-pressed', on);
  if (on) startStream();
  else stopStream();
  renderNow();
}

$('power').addEventListener('click', () => setPower(!s.on));

let stallTimer;

function setStream(state) {
  s.stream = state;
  setState('stream', state);
  setHiss(state === 'loading' ? 0.06 : 0);
  renderStatus();
}

function startStream() {
  s.streamIndex = 0;
  loadStream();
}

function loadStream() {
  setStream('loading');
  audio.src = STREAMS[s.streamIndex] + `?t=${Date.now()}`;
  audio.play().catch(() => {});
  armStall();
}

function releaseAudio() {
  clearTimeout(stallTimer);
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
}

function stopStream() {
  releaseAudio();
  setStream('off');
}

function armStall() {
  clearTimeout(stallTimer);
  // Generous: slow links (satellite, in-flight WiFi) can take 15s+ for the first byte.
  stallTimer = setTimeout(() => s.stream === 'loading' && failStream(), 25000);
}

function failStream() {
  if (!s.on) return;
  if (s.streamIndex < STREAMS.length - 1) {
    s.streamIndex++;
    loadStream();
  } else {
    releaseAudio();
    setStream('error');
  }
}

// Outside Singapore the AAC mount redirects to a short "geoblock" clip instead of
// the live stream. A live stream has no finite duration, so a short one means blocked.
function checkGeoblock() {
  if (s.stream === 'off' || !audio.getAttribute('src')) return false;
  if (Number.isFinite(audio.duration) && audio.duration > 0 && audio.duration < 300) {
    releaseAudio();
    setStream('blocked');
    return true;
  }
  return false;
}

audio.addEventListener('durationchange', checkGeoblock);
audio.addEventListener('playing', () => {
  clearTimeout(stallTimer);
  if (!checkGeoblock()) setStream('live');
});
audio.addEventListener('waiting', () => {
  if (s.stream === 'live') {
    setStream('loading');
    armStall();
  }
});
audio.addEventListener('ended', () => s.on && s.stream === 'live' && loadStream());
audio.addEventListener('error', () => {
  if (audio.getAttribute('src')) failStream();
});

// Lock-screen / media-key controls do the same as the button.
if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('play', () => setPower(true));
  navigator.mediaSession.setActionHandler('pause', () => setPower(false));
}

document.addEventListener('keydown', (e) => {
  if (e.target.closest?.('button, .notes') || e.metaKey || e.ctrlKey || e.altKey) {
    if (e.key === 'Escape') closeNotes();
    return;
  }
  if (e.key === ' ') {
    e.preventDefault();
    setPower(!s.on);
  }
});

// ---------- the one line beneath the radio ----------

function renderStatus() {
  const text = {
    loading: s.streamIndex ? `信号有点弱，再试一次…（第 ${s.streamIndex + 1} 次）` : '正在接收…',
    blocked: '收不到：这个直播流只对新加坡开放。',
    error: '收不到信号，网络太慢或不稳定。再按一下试试。',
  }[s.stream];
  $('status').textContent = text ?? '';
  $('status').hidden = !text;
}

async function renderNow() {
  const t = s.on ? s.track : null;
  const composer = t ? t.composer : 'Symphony 92.4';
  const title = t ? t.title : '新加坡的古典音乐电台';
  const now = $('now');
  if ($('composer').textContent === composer && $('title').textContent === title) return;
  now.classList.add('fading');
  await wait(450);
  $('composer').textContent = composer;
  $('title').textContent = title;
  now.disabled = !t;
  now.setAttribute('aria-label', t ? `${composer}，${title}。查看介绍` : '');
  now.classList.remove('fading');
}

$('now').addEventListener('click', () => s.track && openNotes(s.track));

// ---------- now playing ----------

// "BACH, JOHANN SEBASTIAN" -> "Johann Sebastian Bach"; "VAN BEETHOVEN" keeps "van" lowercase.
const NAME_PARTICLES = new Set(['van', 'von', 'de', 'der', 'da', 'di', 'du', 'del', 'la', 'le']);
function formatComposer(raw) {
  if (!raw) return '';
  const titleCase = (str) => str.toLowerCase().replace(/(^|[\s\-'])\p{L}/gu, (m) => m.toUpperCase());
  const [last, first] = raw.split(',').map((x) => x.trim());
  return titleCase(first ? `${first} ${last}` : last)
    .split(' ')
    .map((w, i) => (i > 0 && NAME_PARTICLES.has(w.toLowerCase()) ? w.toLowerCase() : w))
    .join(' ');
}

function parseNowPlaying(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  return [...doc.querySelectorAll('nowplaying-info')].map((node) => {
    const prop = (name) => node.querySelector(`property[name="${name}"]`)?.textContent ?? '';
    return {
      title: prop('cue_title'),
      composer: formatComposer(prop('track_album_publisher')),
      performer: prop('track_artist_name'),
      start: Number(prop('cue_time_start')),
    };
  });
}

async function refreshNowPlaying() {
  try {
    const res = await fetch(NOW_PLAYING_URL, { cache: 'no-store' });
    const [now, ...earlier] = parseNowPlaying(await res.text());
    if (!now) return;
    if (s.track?.start !== now.start) {
      // If the notes were following the current track, follow the new one too.
      const following = notesTrack === s.track;
      s.track = now;
      getNotes(now); // prefetch so the notes open instantly
      if (following && notesOpen()) showNotes(now);
      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: now.title,
          artist: [now.composer, now.performer].filter(Boolean).join(' · '),
          album: 'Symphony 92.4',
        });
      }
    }
    s.history = earlier;
    renderHistory(earlier);
    renderNow();
  } catch {
    // Metadata is best-effort; the radio keeps working without it.
  }
}

function renderHistory(items) {
  $('history').innerHTML = items
    .map((t, i) => {
      const time = new Date(t.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
      return `<li data-i="${i}" tabindex="0" role="button"><time>${time}</time><span class="p-composer">${esc(t.composer)}</span><span class="p-title">${esc(t.title)}</span></li>`;
    })
    .join('');
}

function openHistoryNotes(e) {
  const li = e.target.closest('li[data-i]');
  const t = li && s.history[li.dataset.i];
  if (!t || (e.type === 'keydown' && e.key !== 'Enter')) return;
  showNotes(t);
  $('notes').scrollTo({ top: 0, behavior: 'smooth' });
}
$('history').addEventListener('click', openHistoryNotes);
$('history').addEventListener('keydown', openHistoryNotes);

// ---------- notes (Wikipedia) ----------

const PAGE_PROPS = {
  prop: 'extracts|pageimages|langlinks|info',
  exintro: '1',
  explaintext: '1',
  exchars: '600',
  lllang: 'zh',
  piprop: 'thumbnail',
  pithumbsize: '240',
  inprop: 'url',
};
const notesCache = new Map();
let notesTrack = null; // the track the notes sheet is showing
let notesLang = localGet('notesLang', 'zh');

async function wikiQuery(lang, params) {
  const url = new URL(`https://${lang}.wikipedia.org/w/api.php`);
  const all = { action: 'query', format: 'json', formatversion: '2', origin: '*', redirects: '1', ...params };
  for (const [k, v] of Object.entries(all)) url.searchParams.set(k, v);
  const res = await fetch(url);
  const pages = (await res.json()).query?.pages ?? [];
  return pages.filter((p) => !p.missing).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
}

async function findComposer(name) {
  // Exact title first: search ranking sometimes prefers a relative ("… the Elder").
  const [exact] = await wikiQuery('en', { titles: name, ...PAGE_PROPS });
  if (exact && /compos/i.test(exact.extract ?? '')) return exact;
  const pages = await wikiQuery('en', { generator: 'search', gsrsearch: name, gsrlimit: '5', ...PAGE_PROPS });
  return pages.find((p) => /compos/i.test(p.extract ?? '')) ?? null;
}

// Search for the work (movement stripped) and only accept an article that
// is about a single piece and actually mentions the composer.
async function findPiece(title, composer, composerPage) {
  const work = title.split(' - ')[0];
  const surname = composer.split(' ').pop();
  const pages = await wikiQuery('en', { generator: 'search', gsrsearch: `${work} ${surname}`, gsrlimit: '5', ...PAGE_PROPS });
  return pages.find((p) =>
    !/^(list|lists) of/i.test(p.title) &&
    p.pageid !== composerPage?.pageid &&
    fold(p.extract ?? '').includes(fold(surname))) ?? null;
}

async function withChinese(page) {
  if (!page) return null;
  const note = { title: page.title, extract: page.extract, url: page.fullurl, thumb: page.thumbnail?.source };
  const zhTitle = page.langlinks?.[0]?.title;
  if (zhTitle) {
    const [zh] = await wikiQuery('zh', {
      titles: zhTitle, prop: 'extracts|info', inprop: 'url|varianttitles',
      exintro: '1', explaintext: '1', exchars: '400', variant: 'zh-cn',
    });
    const title = zh?.varianttitles?.['zh-cn'] ?? zh?.title;
    if (zh?.extract) Object.assign(note, { zhTitle: title, zhExtract: zh.extract, zhUrl: zh.fullurl });
  }
  return note;
}

async function loadNotes(t) {
  const composer = t.composer ? await findComposer(t.composer) : null;
  const piece = t.title && t.composer ? await findPiece(t.title, t.composer, composer) : null;
  const [c, p] = await Promise.all([withChinese(composer), withChinese(piece)]);
  return { composer: c, piece: p };
}

function getNotes(t) {
  const key = `${t.composer}|${t.title}`;
  if (!notesCache.has(key)) {
    notesCache.set(key, loadNotes(t).catch(() => {
      notesCache.delete(key); // let a later attempt retry
      return null;
    }));
  }
  return notesCache.get(key);
}

async function showNotes(t) {
  notesTrack = t;
  const performer = t.performer ? `<br><span>${esc(t.performer)}</span>` : '';
  $('notesFor').innerHTML = `<b>${esc(t.composer)}</b>${esc(t.title)}${performer}`;
  $('notesBody').innerHTML = '<div class="skeleton"><i></i><i></i><i></i><i></i></div>';
  const notes = await getNotes(t);
  if (notesTrack === t) renderNotes(notes);
}

function renderNotes(notes) {
  const zh = notesLang === 'zh';
  const section = (label, n, portrait, missing) => {
    if (!n) return `<section class="note empty"><p class="note-label">${label}</p><p>${missing}</p></section>`;
    const useZh = zh && n.zhExtract;
    const img = portrait && n.thumb
      ? `<img class="portrait" src="${esc(n.thumb)}" alt="" onload="this.classList.add('loaded')">` : '';
    return `<section class="note">
      <p class="note-label">${label}</p>
      ${img}
      <h3>${esc(useZh ? n.zhTitle : n.title)}</h3>
      ${zh && !n.zhExtract ? '<p class="no-zh">暂无中文条目，显示英文</p>' : ''}
      <p class="extract">${esc(useZh ? n.zhExtract : n.extract)}</p>
      <a href="${esc(useZh ? n.zhUrl : n.url)}" target="_blank" rel="noopener">${zh ? '在维基百科阅读全文' : 'Read on Wikipedia'} ↗</a>
    </section>`;
  };
  if (!notes) {
    $('notesBody').innerHTML = `<section class="note empty"><p>${zh ? '暂时连不上维基百科，稍后再试。' : 'Couldn’t reach Wikipedia. Try again later.'}</p></section>`;
    return;
  }
  $('notesBody').innerHTML =
    section(zh ? '作品' : 'The work', notes.piece, false, zh ? '维基百科上没有这首曲子的专门条目。' : 'Wikipedia has no dedicated article for this piece.') +
    section(zh ? '作曲家' : 'Composer', notes.composer, true, zh ? '没有找到这位作曲家的条目。' : 'No article found for this composer.');
}

function notesOpen() {
  return $('notes').classList.contains('open');
}

function openNotes(t) {
  showNotes(t);
  $('notes').classList.add('open');
  $('scrim').classList.add('open');
  $('notes').inert = false;
  $('notesClose').focus({ preventScroll: true });
}

function closeNotes() {
  if (!notesOpen()) return;
  $('notes').classList.remove('open');
  $('scrim').classList.remove('open');
  $('notes').inert = true;
  notesTrack = null;
}

function setNotesLang(lang) {
  notesLang = lang;
  localSet('notesLang', lang);
  document.querySelectorAll('.lang button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.lang === lang));
  if (notesTrack) getNotes(notesTrack).then((n) => renderNotes(n));
}

$('notesClose').addEventListener('click', closeNotes);
$('scrim').addEventListener('click', closeNotes);
document.querySelectorAll('.lang button').forEach((b) => b.addEventListener('click', () => setNotesLang(b.dataset.lang)));

// ---------- float on the desktop (Chrome / Edge: Document Picture-in-Picture) ----------

if ('documentPictureInPicture' in window) {
  $('float').hidden = false;
  $('float').addEventListener('click', floatRadio);
}

async function floatRadio() {
  if (window.documentPictureInPicture.window) return;
  const pip = await window.documentPictureInPicture.requestWindow({ width: 260, height: 170 });

  // Copy the page's styles into the floating window.
  for (const sheet of document.styleSheets) {
    try {
      const style = pip.document.createElement('style');
      style.textContent = [...sheet.cssRules].map((r) => r.cssText).join('\n');
      pip.document.head.append(style);
    } catch {
      // Cross-origin sheets (the web font) can't be read; link them instead.
      const link = pip.document.createElement('link');
      link.rel = 'stylesheet';
      link.href = sheet.href;
      pip.document.head.append(link);
    }
  }
  pip.document.title = '92.4';
  pip.document.body.className = 'pip';
  pip.document.body.append(radio);
  app.classList.add('floating');

  // Shrink the radio if the window is made smaller than it.
  const fit = () => pip.document.body.style.setProperty('--pip-scale', Math.min(1, (pip.innerWidth - 16) / 232, (pip.innerHeight - 16) / 148));
  fit();
  pip.addEventListener('resize', fit);
  pip.addEventListener('keydown', (e) => {
    if (e.key === ' ' && !e.target.closest?.('button')) {
      e.preventDefault();
      setPower(!s.on);
    }
  });

  pip.addEventListener('pagehide', () => {
    $('radioSlot').append(radio);
    app.classList.remove('floating');
  });
}

// ---------- utils ----------

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// Case- and accent-insensitive form for comparing names ("Dvořák" ~ "dvorak").
function fold(str) {
  return str.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}
function esc(str) {
  return str.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}
function localGet(k, fallback) {
  try { return localStorage.getItem(k) ?? fallback; } catch { return fallback; }
}
function localSet(k, v) {
  try { localStorage.setItem(k, v); } catch {}
}

setNotesLang(notesLang);
refreshNowPlaying();
setInterval(refreshNowPlaying, POLL_MS);
