(() => {
  // 유튜브 뮤직 DOM 이 바뀌면 여기만 고치면 된다.
  const SEL = {
    playerBar: 'ytmusic-player-bar',
    thumb: 'ytmusic-player-bar img.image',
    title: 'ytmusic-player-bar .title',
    byline: 'ytmusic-player-bar .byline',
    lyricsShelf: 'ytmusic-player-page ytmusic-description-shelf-renderer',
    playerPage: 'ytmusic-player-page', // 동영상 탭이면 video-mode 속성이 붙는다
    sidePanel: 'ytmusic-player-page #side-panel',
    sideTabs: 'ytmusic-player-page tp-yt-paper-tab', // 다음 트랙, 가사, 댓글, 관련 항목 순. 가사가 없으면 [1] 이 disabled
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
  let lyricHits = []; // 현재 곡의 LRCLIB 검색 결과 (가사가 있는 것만)
  let lyricHit = null;
  let activeIdx = -1;
  let pauseScrollUntil = 0;
  // 싱크 보정(초). 양수면 가사가 그만큼 늦게 넘어간다. 곡별로 chrome.storage.local 의 `off:<곡 키>` 에 저장.
  let lyricOffset = 0;
  const offsetLabel = document.createElement('span');
  const showOffset = () => { offsetLabel.textContent = ` ${lyricOffset > 0 ? '+' : ''}${lyricOffset.toFixed(1)}초 `; };
  const lyricBox = document.createElement('div');
  lyricBox.className = 'ym-lyrics';
  // 유튜브에 가사가 없는 곡(가사 탭 회색)에서 탭 내용 자리를 대신 덮는 우리 패널
  let panelOpen = false;
  const lyricPanel = document.createElement('div');
  lyricPanel.className = 'ym-lyrics-panel';

  // 직접 가사를 넘겨 보는 동안은 현재 줄로 끌어가지 않는다.
  // shortcut: 휠과 터치만 감지한다. 스크롤바를 끌 때도 멈추게 하려면 스크롤 컨테이너의 scroll 이벤트로 바꿀 것.
  const pauseScroll = () => { pauseScrollUntil = Date.now() + 3000; };
  lyricBox.addEventListener('wheel', pauseScroll, { passive: true });
  lyricBox.addEventListener('touchmove', pauseScroll, { passive: true });

  // 줄을 누르면 그 위치로 이동
  lyricBox.addEventListener('click', (e) => {
    const step = Number(e.target.dataset?.step);
    if (step) return nudgeOffset(step);
    const line = lyricLines?.[[...lyricBox.children].indexOf(e.target)];
    const video = document.querySelector(SEL.video);
    if (!video || !isFinite(line?.t)) return; // 시간 정보 없는 가사는 이동할 곳이 없다
    pauseScrollUntil = 0;
    video.currentTime = Math.max(0, line.t + lyricOffset);
  });

  function nudgeOffset(step) {
    lyricOffset = Math.round((lyricOffset + step) * 10) / 10;
    showOffset();
    const store = `off:${lyricKey}`;
    if (lyricOffset) chrome.storage.local.set({ [store]: lyricOffset });
    else chrome.storage.local.remove(store); // 0 으로 되돌린 곡은 남기지 않는다
    tickLyrics();
  }

  function parseLrc(lrc) {
    const out = [];
    for (const row of lrc.split('\n')) {
      const m = row.match(/^\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)$/);
      if (m) out.push({ t: m[1] * 60 + Number(m[2]), text: m[3].trim() || '♪' });
    }
    return out;
  }
  console.assert(parseLrc('[01:02.50] a\nx\n[01:03.00]').map((l) => l.t + l.text).join() === '62.5a,63♪');

  // 곡 길이가 2초 넘게 다르면 다른 버전으로 본다. 길이를 아직 모르면 통과.
  function fitsDuration(x) {
    const duration = document.querySelector(SEL.video)?.duration;
    return !duration || Math.abs(x.duration - duration) <= 2;
  }

  // 한글 가사를 로마자로 옮겨 적은 것("eoryeosseul ttae ...")은 쓰지 않는다. 로마자 표기는 'eo' 가 든 낱말이
  // 넷 중 하나꼴(측정 0.28)이고 영어·스페인어·프랑스어·독일어 가사는 0.04 이하라 0.12 로 가른다.
  // shortcut: 한국어 로마자만 거른다. 일본어 로마자 가사가 문제 되면 기준을 따로 추가할 것.
  function isRomanizedKorean(text) {
    const words = text.toLowerCase().match(/[a-z']+/g) || [];
    return words.length >= 10 && words.filter((w) => w.includes('eo')).length / words.length > 0.12;
  }
  console.assert(isRomanizedKorean('neo eodi geoul meoreo seoro neomu gieok eopseo deo keojyeo')
    && !isRomanizedKorean('people say the video of someone is on the radio every single night'));

  async function searchLrclib(params) {
    // 곡 제목·가수만 보낸다. 쿠키와 현재 페이지 주소(referrer)는 보내지 않는다.
    const res = await fetch(`https://lrclib.net/api/search?${new URLSearchParams(params)}`, {
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
    if (!res.ok) return [];
    return (await res.json()).filter((x) => {
      const text = x.syncedLyrics || x.plainLyrics;
      return text && !isRomanizedKorean(text);
    });
  }

  // 받아 둔 결과에서 지금 곡 길이에 맞는 가사를 고른다. 광고가 끝나 길이가 바뀌면 다시 고른다.
  function pickLyrics() {
    // 한번 고른 가사는 곡이 바뀔 때까지 유지한다: 곡 끝 무렵 유튜브가 다음 곡을 미리 이어 붙여
    // video.duration 이 늘어나므로, 그때 다시 고르면 가사가 사라진다.
    // 시간 정보가 있는 가사를 먼저 쓰고, 없으면 일반 가사(가사 탭이 회색인 곡에서만 보여 준다)로 물러난다.
    const kept = lyricHits.includes(lyricHit) ? lyricHit : null;
    const fits = lyricHits.filter(fitsDuration);
    const hit = kept?.syncedLyrics ? kept : fits.find((x) => x.syncedLyrics) || kept || fits[0] || null;
    if (hit === lyricHit) return;
    lyricHit = hit;
    lyricLines = hit && (hit.syncedLyrics
      ? parseLrc(hit.syncedLyrics)
      : hit.plainLyrics.split('\n').map((text) => ({ t: Infinity, text: text.trim() || ' ' }))); // t=Infinity: 강조·이동 없음
    renderLyrics();
    tickLyrics(); // 다음 주기를 기다리지 않고 바로 붙인다
  }
  document.addEventListener('durationchange', pickLyrics, true); // 미디어 이벤트는 버블링이 없어 캡처로 받는다

  function renderLyrics() {
    activeIdx = -1;
    if (!lyricLines) return lyricBox.remove();
    const els = lyricLines.map((l) => Object.assign(document.createElement('p'), { textContent: l.text }));
    const synced = !!lyricHit.syncedLyrics;
    lyricBox.classList.toggle('plain', !synced);
    const foot = Object.assign(document.createElement('small'), { textContent: synced ? '가사 싱크: LRCLIB' : '가사: LRCLIB' });
    if (synced) {
      const button = (step, text, label) => {
        const b = Object.assign(document.createElement('button'), { type: 'button', textContent: text, ariaLabel: label, title: label });
        b.dataset.step = step;
        return b;
      };
      showOffset();
      foot.append(' · ', button(-0.5, '−', '가사를 0.5초 빠르게'), offsetLabel, button(0.5, '+', '가사를 0.5초 늦게'));
    }
    lyricBox.replaceChildren(...els, foot);
  }

  async function refreshLyrics() {
    const title = document.querySelector(SEL.title)?.textContent.trim();
    // 가수가 여럿이면 "A 및 B" 로 나와 검색이 안 되므로 첫 가수(링크)만 쓴다. 링크가 없으면 글자 그대로.
    const byline = document.querySelector(SEL.byline);
    const artists = byline?.textContent.split('•')[0].trim() || '';
    const first = byline?.querySelector('a')?.textContent.trim();
    const artist = first && artists.startsWith(first) ? first : artists;
    const key = settings.enabled && settings.lyrics && title ? `${title}|${artist}` : '';
    if (key === lyricKey) return;
    lyricKey = key;
    lyricHits = [];
    lyricOffset = 0;
    pickLyrics();
    if (!key) return;
    const store = `off:${key}`;
    chrome.storage.local.get(store).then((saved) => {
      if (key !== lyricKey || !saved[store]) return;
      lyricOffset = saved[store];
      showOffset();
    });
    // 바로 조회하고, 첫 조회에서 맞는 가사가 나오면 곧장 띄운다. 없을 때만 넓은 검색을 한 번 더 한다.
    for (const params of [{ track_name: title, artist_name: artist }, { q: `${title} ${artist}` }]) {
      const hits = await searchLrclib(params).catch(() => []);
      if (key !== lyricKey) return;
      lyricHits = lyricHits.concat(hits);
      pickLyrics();
      if (lyricHit?.syncedLyrics) return;
    }
  }

  // 가사를 붙일 자리를 정한다. 유튜브 가사가 있으면 그 가사 화면, 없으면(가사 탭 회색) 우리 패널.
  function lyricsHost() {
    const tab = document.querySelectorAll(SEL.sideTabs)[1];
    const grey = !!tab?.hasAttribute('disabled');
    const songMode = !document.querySelector(SEL.playerPage)?.hasAttribute('video-mode');
    // 회색 탭은 노래 탭일 때만 살린다: 동영상은 길이·타이밍이 음원과 달라 가사가 어긋난다.
    const live = !!lyricLines && grey && songMode;
    panelOpen &&= live;
    tab?.classList.toggle('ym-tab-live', live);
    tab?.classList.toggle('ym-tab-on', panelOpen);
    if (!panelOpen) lyricPanel.remove();
    else if (!lyricPanel.isConnected) document.querySelector(SEL.sidePanel)?.append(lyricPanel);
    if (live) return panelOpen ? lyricPanel : null;
    // 가사 탭은 열 때 만들어지므로 매번 확인. 이전 곡의 가사 화면이 남아 있을 수 있어 회색이면 쓰지 않는다.
    return lyricHit?.syncedLyrics && !grey ? document.querySelector(SEL.lyricsShelf) : null;
  }

  // 살려 둔 가사 탭을 누르면 패널을 열고, 다른 탭을 누르면 닫는다.
  document.addEventListener('click', (e) => {
    const tab = e.target.closest?.(SEL.sideTabs);
    if (!tab) return;
    panelOpen = tab.classList.contains('ym-tab-live');
    tickLyrics();
  }, true);

  function tickLyrics() {
    const host = lyricsHost();
    if (!host) return lyricBox.remove(); // 보여 줄 자리가 없으면 이전 곡 가사 화면에 남지 않게 뗀다
    if (lyricBox.parentNode !== host) {
      host.append(lyricBox);
      lyricBox.children[activeIdx]?.classList.remove('active');
      activeIdx = -1; // 새로 붙였으니 현재 줄을 다시 잡아 그 위치로 스크롤한다
    }
    lyricBox.classList.toggle('browsing', Date.now() < pauseScrollUntil); // 넘겨 보는 동안은 블러를 푼다
    const t = (document.querySelector(SEL.video)?.currentTime ?? 0) - lyricOffset;
    const i = lyricLines.findLastIndex((l) => l.t <= t);
    if (i === activeIdx) return;
    lyricBox.children[activeIdx]?.classList.remove('active');
    activeIdx = i;
    const el = i >= 0 && lyricBox.children[i];
    if (!el) return;
    el.classList.add('active');
    if (lyricBox.offsetParent && Date.now() > pauseScrollUntil) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
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
