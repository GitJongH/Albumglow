(() => {
  // 유튜브 뮤직 DOM 이 바뀌면 여기만 고치면 된다.
  const SEL = {
    playerBar: 'ytmusic-player-bar',
    thumb: 'ytmusic-player-bar img.image',
    title: 'ytmusic-player-bar .title',
    byline: 'ytmusic-player-bar .byline',
    lyricsShelf: 'ytmusic-player-page ytmusic-description-shelf-renderer',
    video: 'video',
  };

  const DEFAULTS = { enabled: true, preset: 'apple', blur: 30, intensity: 70, accent: '#fa233b', lyrics: true };

  // dynamic: 앨범 색을 배경에 쓸지 여부. static 프리셋은 c1/c2 고정.
  const PRESETS = {
    apple: { accent: '#fa233b', dynamic: true, base: '#0d0d10' },
    deep: { accent: '#fa233b', dynamic: false, base: '#000000', c1: '#3a0d18', c2: '#0b1020' },
    custom: { accent: null, dynamic: true, base: '#0d0d10' },
  };

  const FALLBACK_COLORS = { c1: '#5b1a2a', c2: '#14213d' };

  const root = document.documentElement;
  let settings = { ...DEFAULTS };
  let albumColors = null;
  let lastSrc = '';

  function apply() {
    const preset = PRESETS[settings.preset] || PRESETS.apple;
    root.classList.toggle('ym-theme-on', !!settings.enabled);

    const accent = preset.accent || settings.accent;
    const colors = preset.dynamic ? albumColors || FALLBACK_COLORS : preset;
    root.style.setProperty('--ym-blur', `${settings.blur}px`);
    root.style.setProperty('--ym-intensity', String(settings.intensity / 100));
    root.style.setProperty('--ym-accent', accent);
    root.style.setProperty('--ym-base', preset.base);
    root.style.setProperty('--ym-c1', colors.c1);
    root.style.setProperty('--ym-c2', colors.c2);
    refreshLyrics();
  }

  // ---- 가사 따라가기 (시간 정보는 LRCLIB 에서 받는다) ----

  let lyricLines = null; // [{ t: 초, text }], 없으면 유튜브 원래 가사를 그대로 둔다
  let lyricKey = '';
  let activeIdx = -1;
  const lyricBox = document.createElement('div');
  lyricBox.className = 'ym-lyrics';

  function parseLrc(lrc) {
    const out = [];
    for (const row of lrc.split('\n')) {
      const m = row.match(/^\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)$/);
      if (m) out.push({ t: m[1] * 60 + Number(m[2]), text: m[3].trim() || '♪' });
    }
    return out;
  }
  console.assert(parseLrc('[01:02.50] a\nx\n[01:03.00]').map((l) => l.t + l.text).join() === '62.5a,63♪');

  async function fetchLyrics(title, artist, duration) {
    const pick = (list) => list.find((x) => x.syncedLyrics && (!duration || Math.abs(x.duration - duration) <= 2));
    for (const params of [{ track_name: title, artist_name: artist }, { q: `${title} ${artist}` }]) {
      // 곡 제목·가수만 보낸다. 쿠키와 현재 페이지 주소(referrer)는 보내지 않는다.
      const res = await fetch(`https://lrclib.net/api/search?${new URLSearchParams(params)}`, {
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      });
      const hit = res.ok && pick(await res.json());
      if (hit) return parseLrc(hit.syncedLyrics);
    }
    return null;
  }

  function renderLyrics() {
    activeIdx = -1;
    if (!lyricLines) return lyricBox.remove();
    const els = lyricLines.map((l) => Object.assign(document.createElement('p'), { textContent: l.text }));
    lyricBox.replaceChildren(...els, Object.assign(document.createElement('small'), { textContent: '가사 싱크: LRCLIB' }));
  }

  async function refreshLyrics() {
    const title = document.querySelector(SEL.title)?.textContent.trim();
    const artist = document.querySelector(SEL.byline)?.textContent.split('•')[0].trim() || '';
    const key = settings.enabled && settings.lyrics && title ? `${title}|${artist}` : '';
    if (key === lyricKey) return;
    lyricKey = key;
    lyricLines = null;
    renderLyrics();
    if (!key) return;
    // shortcut: 곡 길이를 1초 뒤 video 에서 읽는다. 광고 중이거나 아직 이전 곡 길이면 매칭에 실패해
    // 원래 가사가 보인다. 자주 겪으면 durationchange 를 기다렸다가 다시 조회하도록 바꿀 것.
    await new Promise((r) => setTimeout(r, 1000));
    if (key !== lyricKey) return;
    const duration = document.querySelector(SEL.video)?.duration;
    const lines = await fetchLyrics(title, artist, duration).catch(() => null);
    if (key !== lyricKey) return;
    lyricLines = lines;
    renderLyrics();
  }

  function tickLyrics() {
    const shelf = lyricLines && document.querySelector(SEL.lyricsShelf);
    if (!shelf) return;
    if (lyricBox.parentNode !== shelf) shelf.append(lyricBox); // 가사 탭은 열 때 만들어지므로 매번 확인
    const t = document.querySelector(SEL.video)?.currentTime ?? 0;
    const i = lyricLines.findLastIndex((l) => l.t <= t);
    if (i === activeIdx) return;
    lyricBox.children[activeIdx]?.classList.remove('active');
    activeIdx = i;
    const el = i >= 0 && lyricBox.children[i];
    if (!el) return;
    el.classList.add('active');
    if (lyricBox.offsetParent) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  setInterval(tickLyrics, 250);

  // ---- 앨범 아트에서 대표색 추출 ----

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return [h * 60, s, l];
  }

  function hsl(h, s, l) {
    return `hsl(${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
  }

  const BINS = 12;

  function paletteFromPixels(data) {
    const bins = Array.from({ length: BINS }, () => ({ w: 0, h: 0, s: 0 }));
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue;
      const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
      if (l < 0.08 || l > 0.94) continue;
      const w = s * (1 - Math.abs(2 * l - 1)) + 0.03;
      const b = bins[Math.floor(h / (360 / BINS)) % BINS];
      b.w += w;
      b.h += h * w;
      b.s += s * w;
    }
    const ranked = bins
      .map((b, i) => ({ i, w: b.w, h: b.w ? b.h / b.w : 0, s: b.w ? b.s / b.w : 0 }))
      .filter((b) => b.w > 0)
      .sort((a, b) => b.w - a.w);
    if (!ranked.length) return null; // 흑백 이미지 등

    const first = ranked[0];
    const gap = (a, b) => Math.min(Math.abs(a - b), BINS - Math.abs(a - b));
    const second = ranked.find((b) => gap(b.i, first.i) >= 2) || { h: (first.h + 40) % 360, s: first.s };

    // 어두운 배경 위에서 잘 보이도록 채도/명도를 눌러 준다.
    return {
      c1: hsl(first.h, Math.min(0.85, Math.max(0.4, first.s)), 0.42),
      c2: hsl(second.h, Math.min(0.8, Math.max(0.35, second.s)), 0.3),
    };
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  async function extractColors(src) {
    // 플레이어 바 썸네일은 60px 짜리라 조금 키운 걸 쓴다.
    const bigger = src.replace(/=w\d+-h\d+.*$/, '=w96-h96');
    const img = await loadImage(bigger).catch(() => loadImage(src));
    const size = 24;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, size, size);
    return paletteFromPixels(ctx.getImageData(0, 0, size, size).data);
  }

  async function refreshColors() {
    const img = document.querySelector(SEL.thumb);
    const src = img && img.src;
    if (!src || !/^https?:/.test(src) || src === lastSrc) return;
    lastSrc = src;
    try {
      albumColors = await extractColors(src);
    } catch {
      albumColors = null; // CORS 등으로 실패하면 기본 그라데이션
    }
    apply();
  }

  // ---- 곡 변경 감시 ----

  function watchPlayerBar() {
    const bar = document.querySelector(SEL.playerBar);
    if (!bar) return false;
    new MutationObserver(() => { refreshColors(); refreshLyrics(); }).observe(bar, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['src'],
    });
    refreshColors();
    return true;
  }

  function init() {
    if (watchPlayerBar()) return;
    const timer = setInterval(() => watchPlayerBar() && clearInterval(timer), 500);
  }

  chrome.storage.sync.get(DEFAULTS).then((stored) => {
    settings = { ...DEFAULTS, ...stored };
    apply();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    for (const [key, { newValue }] of Object.entries(changes)) settings[key] = newValue;
    apply();
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
