// 92.4 小收音机 — Symphony 92.4 with one knob.
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
  `https://np.tritondigital.com/public/nowplaying?mountName=${MOUNT}&numberToFetch=1&eventType=track`;
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
};

// ---------- radio noise ----------
// The online stream is clean digital audio; the static is ours. A burst of
// crackle while it tunes in, then a very faint hiss under the music.

let ctx, hissGain, popBuf, crackleTimer;

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
    band.frequency.value = 2400;
    band.Q.value = 0.45;
    hissGain = ctx.createGain();
    hissGain.gain.value = 0;
    noise.connect(band).connect(hissGain).connect(ctx.destination);
    noise.start();

    popBuf = ctx.createBuffer(1, ctx.sampleRate * 0.03, ctx.sampleRate);
    const p = popBuf.getChannelData(0);
    for (let i = 0; i < p.length; i++) p[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.002));
  }
  if (ctx.state === 'suspended') ctx.resume();
}

function setHiss(level, seconds) {
  if (ctx) hissGain.gain.setTargetAtTime(level, ctx.currentTime, seconds);
}

function pop(gain, rate = 1) {
  if (!ctx) return;
  const src = ctx.createBufferSource();
  const g = ctx.createGain();
  src.buffer = popBuf;
  src.playbackRate.value = rate;
  g.gain.value = gain;
  src.connect(g).connect(ctx.destination);
  src.start();
}

function crackle(on) {
  clearInterval(crackleTimer);
  if (on) crackleTimer = setInterval(() => Math.random() < 0.3 && pop(0.04 + Math.random() * 0.12, 0.6 + Math.random()), 110);
}

// ---------- power & stream ----------

function setState(key, value) {
  app.dataset[key] = value;
  radio.dataset[key] = value;
}

function setPower(on) {
  if (on === s.on) return;
  initAudio();
  pop(0.5, 0.35); // the switch
  s.on = on;
  setState('power', on ? 'on' : 'off');
  $('power').setAttribute('aria-pressed', on);
  if (on) startStream();
  else stopStream();
  renderNow();
}

$('power').addEventListener('click', (e) => {
  e.stopPropagation(); // the knob is not "tap the radio"
  setPower(!s.on);
});

let stallTimer;

function setStream(state) {
  s.stream = state;
  setState('stream', state);
  if (state === 'loading') {
    setHiss(0.07, 0.08);
    crackle(true);
  } else {
    crackle(false);
    // Live: the static recedes to a faint bed under the music.
    setHiss(state === 'live' ? 0.009 : 0, state === 'live' ? 1.2 : 0.25);
  }
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

// Lock-screen / media-key controls do the same as the knob.
if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('play', () => setPower(true));
  navigator.mediaSession.setActionHandler('pause', () => setPower(false));
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') return closeCard();
  if (e.key !== ' ' || e.target.closest?.('button') || e.metaKey || e.ctrlKey || e.altKey) return;
  e.preventDefault();
  setPower(!s.on);
});

// ---------- tap the radio: a small window on the desktop, or full screen ----------

const canFloat = 'documentPictureInPicture' in window;
const canFullscreen = Boolean(document.documentElement.requestFullscreen);

if (canFloat || canFullscreen) {
  radio.classList.add('can-float');
  radio.title = canFloat ? '缩成桌面小窗' : '全屏';
  radio.addEventListener('click', () => {
    if (canFloat) {
      const pip = window.documentPictureInPicture.window;
      if (pip) pip.close();
      else floatRadio();
    } else if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      app.requestFullscreen().catch(() => {});
    }
  });
}

async function floatRadio() {
  const pip = await window.documentPictureInPicture.requestWindow({ width: 330, height: 200 });

  // Copy the page's styles into the floating window.
  for (const sheet of document.styleSheets) {
    try {
      const style = pip.document.createElement('style');
      style.textContent = [...sheet.cssRules].map((r) => r.cssText).join('\n');
      pip.document.head.append(style);
    } catch {
      // Cross-origin sheets (the web fonts) can't be read; link them instead.
      const link = pip.document.createElement('link');
      link.rel = 'stylesheet';
      link.href = sheet.href;
      pip.document.head.append(link);
    }
  }
  pip.document.title = '92.4';
  pip.document.body.className = 'pip';
  pip.document.body.append(radio);
  radio.title = '放回网页';
  app.classList.add('floating');

  // Shrink the radio if the window is made smaller than it.
  const fit = () => pip.document.body.style.setProperty(
    '--pip-scale', Math.min(1, (pip.innerWidth - 20) / 300, (pip.innerHeight - 20) / 172));
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
    radio.title = '缩成桌面小窗';
    app.classList.remove('floating');
  });
}

// ---------- the line under the radio ----------

function renderStatus() {
  const text = {
    loading: s.streamIndex ? `信号有点弱，再试一次…（第 ${s.streamIndex + 1} 次）` : '',
    blocked: '收不到：这个直播流只对新加坡开放。',
    error: '收不到信号，网络太慢或不稳定。关上再开试试。',
  }[s.stream];
  $('status').textContent = text ?? '';
  $('status').hidden = !text;
}

async function renderNow() {
  const t = s.on ? s.track : null;
  const composer = t ? t.composer : 'Symphony 92.4';
  const title = t ? t.title : '新加坡的古典音乐电台';
  const now = $('now');
  now.disabled = !t;
  if (!t) closeCard();
  if ($('composer').textContent === composer && $('title').textContent === title) return;
  now.classList.add('fading');
  await wait(450);
  $('composer').textContent = composer;
  $('title').textContent = title;
  now.setAttribute('aria-label', t ? `${composer}，${title}。查看介绍` : '');
  now.classList.remove('fading');
}

$('now').addEventListener('click', () => (cardOpen() ? closeCard() : openCard()));

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
    const [now] = parseNowPlaying(await res.text());
    if (!now || s.track?.start === now.start) return;
    s.track = now;
    getNotes(now); // prefetch so the card opens instantly
    if (cardOpen()) renderCard(now);
    renderNow();
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: now.title,
        artist: [now.composer, now.performer].filter(Boolean).join(' · '),
        album: 'Symphony 92.4',
      });
    }
  } catch {
    // Metadata is best-effort; the radio keeps working without it.
  }
}

// ---------- the programme card ----------

function cardOpen() {
  return $('cardWrap').classList.contains('open');
}

function openCard() {
  if (!s.track) return;
  renderCard(s.track);
  $('cardWrap').classList.add('open');
  $('card').inert = false;
  $('now').setAttribute('aria-expanded', 'true');
}

function closeCard() {
  $('cardWrap').classList.remove('open');
  $('card').inert = true;
  $('now').setAttribute('aria-expanded', 'false');
}

let cardLang = localGet('notesLang', 'zh');
let cardTrack = null;

async function renderCard(t) {
  cardTrack = t;
  const card = $('card');
  if (!card.innerHTML || card.dataset.key !== keyOf(t)) {
    card.innerHTML = `<h2>${esc(t.title)}</h2><p class="by"><b>${esc(t.composer)}</b></p><p class="loading">正在翻节目单…</p>`;
  }
  card.dataset.key = keyOf(t);
  const notes = await getNotes(t);
  if (cardTrack === t) card.innerHTML = cardHTML(t, notes, cardLang);
}

$('card').addEventListener('click', (e) => {
  if (!e.target.closest('.lang')) return;
  cardLang = cardLang === 'zh' ? 'en' : 'zh';
  localSet('notesLang', cardLang);
  if (cardTrack) renderCard(cardTrack);
});

// Builds the card from whatever we found. Something is always there: the
// piece's own article, else its musical form, plus the tempo marking and the composer.
function cardHTML(t, n, lang) {
  const zh = lang === 'zh';
  const pick = (note) => note && (zh && note.zhExtract ? { title: note.zhTitle, text: note.zhExtract, url: note.zhUrl } : { title: note.title, text: note.extract, url: note.url });
  const piece = pick(n?.piece);
  const form = pick(n?.form);
  const comp = pick(n?.composer);

  const years = n?.composer ? lifeYears(n.composer.extract) : '';
  const name = comp && zh && n.composer.zhExtract ? comp.title : t.composer;

  let about = '';
  if (piece) about = firstSentences(piece.text, 2, zh && n.piece.zhExtract);
  else if (form) about = firstSentences(form.text, 2, zh && n.form.zhExtract);
  else about = zh ? `${t.composer} 的作品。` : `A work by ${t.composer}.`;

  const tempo = tempoNote(t.title, zh);
  const bio = comp ? firstSentences(comp.text, 2, zh && n.composer.zhExtract) : '';

  const links = [piece && `<a href="${esc(piece.url)}" target="_blank" rel="noopener">${zh ? '作品' : 'Work'} ↗</a>`,
    !piece && form && `<a href="${esc(form.url)}" target="_blank" rel="noopener">${esc(form.title)} ↗</a>`,
    comp && `<a href="${esc(comp.url)}" target="_blank" rel="noopener">${zh ? '作曲家' : 'Composer'} ↗</a>`]
    .filter(Boolean).join(' · ');

  return `
    <h2>${esc(piece && zh && n.piece.zhExtract ? piece.title : t.title)}</h2>
    <p class="by"><b>${esc(name)}</b>${years ? ` · ${years}` : ''}</p>
    <p class="txt">${esc(about)}</p>
    ${tempo ? `<p class="move"><b>${esc(tempo.word)}</b>${esc(tempo.text)}</p>` : ''}
    ${bio ? `<p class="txt">${esc(bio)}</p>` : ''}
    ${t.performer ? `<p class="who">${zh ? '演奏' : 'Performed by'}：${esc(t.performer)}</p>` : ''}
    <div class="meta"><span>${links}</span><button class="lang">${zh ? 'EN' : '中文'}</button></div>`;
}

// Strip pronunciations and bracketed asides, then keep the first sentences.
function firstSentences(text, count, isChinese) {
  const clean = text
    .replace(/\s*[（(][^（）()]*[）)]/g, '')
    .replace(/\s*[（(][^（）()]*[）)]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const parts = isChinese ? clean.split(/(?<=[。！？])/) : clean.split(/(?<=[.!?])\s+(?=[A-Z])/);
  return parts.slice(0, count).join(isChinese ? '' : ' ').replace(/…$/, '');
}

function lifeYears(extract = '') {
  const m = extract.slice(0, 260).match(/\b(1[0-9]{3}|20[0-2][0-9])\b[^()]{0,40}?\b(1[0-9]{3}|20[0-2][0-9])\b/);
  return m && Number(m[2]) > Number(m[1]) ? `${m[1]}–${m[2]}` : '';
}

// Tempo and movement words: explained locally, so this part never depends on the network.
const TEMPO = [
  ['prestissimo', '最急板：尽可能地快。', 'As fast as possible.'],
  ['larghetto', '小广板：比广板稍稍流动一些。', 'A little less broad than largo.'],
  ['adagietto', '小柔板：比柔板稍流动一些。', 'A little more flowing than adagio.'],
  ['andantino', '小行板：比行板轻快一点。', 'A little lighter than andante.'],
  ['allegretto', '小快板：稍快，轻盈。', 'Moderately fast and light.'],
  ['moderato', '中板：不快不慢的适中速度。', 'At a moderate pace.'],
  ['andante', '行板：像散步一样，不快不慢。', 'At a walking pace.'],
  ['allegro', '快板：快而明亮。', 'Fast and bright.'],
  ['adagio', '柔板：从容、舒缓。', 'Slow and at ease.'],
  ['vivace', '活板：活泼、有生气。', 'Lively.'],
  ['presto', '急板：非常快。', 'Very fast.'],
  ['largo', '广板：宽广而缓慢，像一次深呼吸。', 'Broad and slow, like a long breath.'],
  ['lento', '慢板：缓慢。', 'Slow.'],
  ['grave', '庄板：非常缓慢而庄重。', 'Very slow and solemn.'],
  ['scherzo', '谐谑曲：轻快，带一点玩笑的意味。', 'Light and playful, a musical joke.'],
  ['rondo', '回旋曲：主旋律一次次回来，中间穿插新的段落。', 'A main tune that keeps coming back between new episodes.'],
  ['menuetto|minuet|menuet', '小步舞曲：三拍子的宫廷舞曲，端庄优雅。', 'A stately courtly dance in three.'],
];

function tempoNote(title, zh) {
  // Prefer the movement part ("… - II. Andante") over the work's name.
  const part = title.includes(' - ') ? title.slice(title.lastIndexOf(' - ')) : title;
  for (const [word, zhText, enText] of TEMPO) {
    const m = part.match(new RegExp(`\\b(${word})\\b`, 'i'));
    if (m) return { word: m[1][0].toUpperCase() + m[1].slice(1).toLowerCase(), text: zh ? zhText : enText };
  }
  return null;
}

// ---------- notes (Wikipedia) ----------

const PAGE_PROPS = {
  prop: 'extracts|langlinks|info',
  exintro: '1',
  explaintext: '1',
  exchars: '600',
  lllang: 'zh',
  inprop: 'url',
};
const notesCache = new Map();
const keyOf = (t) => `${t.composer}|${t.title}`;

// Musical forms, most specific first, mapped to their Wikipedia article.
const FORMS = [
  [/piano concerto/i, 'Piano concerto'], [/violin concerto/i, 'Violin concerto'],
  [/cello concerto/i, 'Cello concerto'], [/clarinet concerto/i, 'Clarinet concerto'],
  [/flute concerto/i, 'Flute concerto'], [/trumpet concerto/i, 'Trumpet concerto'],
  [/horn concerto/i, 'Horn concerto'], [/oboe concerto/i, 'Oboe concerto'],
  [/concerto grosso/i, 'Concerto grosso'], [/concerto/i, 'Concerto'],
  [/symphonic poem|tone poem/i, 'Symphonic poem'], [/sinfonia/i, 'Sinfonia'], [/symphon/i, 'Symphony'],
  [/string quartet/i, 'String quartet'], [/piano quartet/i, 'Piano quartet'],
  [/piano quintet/i, 'Piano quintet'], [/string quintet/i, 'String quintet'],
  [/piano trio/i, 'Piano trio'], [/quintet/i, 'Quintet'], [/quartet/i, 'Quartet'], [/trio/i, 'Trio'],
  [/piano sonata/i, 'Piano sonata'], [/violin sonata/i, 'Violin sonata'], [/cello sonata/i, 'Cello sonata'],
  [/sonatina/i, 'Sonatina'], [/sonata/i, 'Sonata'],
  [/overture/i, 'Overture'], [/suite/i, 'Suite (music)'], [/serenade/i, 'Serenade'],
  [/divertimento/i, 'Divertimento'], [/nocturne/i, 'Nocturne'], [/waltz|valse/i, 'Waltz'],
  [/mazurka/i, 'Mazurka'], [/polonaise/i, 'Polonaise'], [/minuet|menuet/i, 'Minuet'],
  [/march\b|marche/i, 'March (music)'], [/rhapsod/i, 'Rhapsody (music)'],
  [/fantasia|fantasy|fantaisie/i, 'Fantasia (music)'], [/prelude|prélude/i, 'Prelude (music)'],
  [/fugue/i, 'Fugue'], [/toccata/i, 'Toccata'], [/etude|étude/i, 'Étude'],
  [/variations/i, 'Variation (music)'], [/requiem/i, 'Requiem'], [/\bmass\b|missa/i, 'Mass (music)'],
  [/cantata/i, 'Cantata'], [/oratorio/i, 'Oratorio'], [/aria/i, 'Aria'], [/ballet/i, 'Ballet'],
  [/opera/i, 'Opera'], [/romance/i, 'Romance (music)'], [/impromptu/i, 'Impromptu'],
  [/scherzo/i, 'Scherzo'], [/barcarolle/i, 'Barcarolle'], [/ballade/i, 'Ballade (classical music)'],
  [/partita/i, 'Partita'], [/chaconne|ciaccona/i, 'Chaconne'], [/passacaglia/i, 'Passacaglia'],
  [/berceuse|lullaby/i, 'Lullaby'], [/canon\b/i, 'Canon (music)'], [/dance|danse|tanz/i, 'Dance music'],
];

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

async function findForm(title) {
  const hit = FORMS.find(([re]) => re.test(title.split(' - ')[0])) ?? FORMS.find(([re]) => re.test(title));
  if (!hit) return null;
  const [page] = await wikiQuery('en', { titles: hit[1], ...PAGE_PROPS });
  return page ?? null;
}

async function withChinese(page) {
  if (!page) return null;
  const note = { title: page.title, extract: page.extract ?? '', url: page.fullurl };
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
  const form = piece ? null : await findForm(t.title);
  const [c, p, f] = await Promise.all([withChinese(composer), withChinese(piece), withChinese(form)]);
  return { composer: c, piece: p, form: f };
}

function getNotes(t) {
  const key = keyOf(t);
  if (!notesCache.has(key)) {
    notesCache.set(key, loadNotes(t).catch(() => {
      notesCache.delete(key); // let a later attempt retry
      return null;
    }));
  }
  return notesCache.get(key);
}

// ---------- utils ----------

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// Case- and accent-insensitive form for comparing names ("Dvořák" ~ "dvorak").
function fold(str) {
  return str.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}
function esc(str) {
  return String(str).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}
function localGet(k, fallback) {
  try { return localStorage.getItem(k) ?? fallback; } catch { return fallback; }
}
function localSet(k, v) {
  try { localStorage.setItem(k, v); } catch {}
}

refreshNowPlaying();
setInterval(refreshNowPlaying, POLL_MS);
