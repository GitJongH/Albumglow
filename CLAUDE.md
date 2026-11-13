# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Albumglow: a Chrome MV3 extension that restyles music.youtube.com in an Apple Music style (album-colored gradient background + glass UI). Plain JS/CSS, no build step, no package.json, no tests or linter. README and UI strings are in Korean.

## Commands

- Run/test: load the repo folder unpacked at `chrome://extensions` (Developer mode). After edits, click the extension's reload button and refresh the YouTube Music tab. Verification is manual, in a real YouTube Music tab.
- Package: `powershell -ExecutionPolicy Bypass -File scripts/package.ps1` → `dist/albumglow-v<manifest version>.zip` (`dist/` is gitignored). The script's file list is hardcoded (`manifest.json background.js LICENSE content popup icons`); add new top-level files there.
- Release: bump `version` in `manifest.json`, package, then `gh release create v<version> dist/albumglow-v<version>.zip --repo GitJongH/Albumglow`.

## Architecture

Settings flow through `chrome.storage.sync` as the single shared state; no messaging between parts.

- `popup/popup.js` writes settings (`enabled`, `preset`, `blur`, `intensity`, `accent`) to storage.
- `background.js` (service worker) only handles the `toggle-theme` command (Alt+Shift+Y) by flipping `enabled` in storage.
- `content/content.js` listens to `storage.onChanged`, and `apply()` translates settings into CSS custom properties on `<html>` (`--ym-blur`, `--ym-intensity`, `--ym-accent`, `--ym-base`, `--ym-c1`, `--ym-c2`) and toggles the `ym-theme-on` class. It also extracts two colors from the player-bar album thumbnail (24×24 canvas, HSL hue bins) via a MutationObserver and sets `--ym-c1/--ym-c2`. `PRESETS` decides whether the gradient follows the album (`dynamic`) or is fixed. Synced lyrics (`lyrics` setting): on song change it fetches timed lyrics from `lrclib.net/api/search` (CORS-open, so no host permission; sent with no cookies/referrer), appends its own `.ym-lyrics` box into the player page's `ytmusic-description-shelf-renderer`, and a 250ms interval highlights/scrolls the current line from `video.currentTime`. Search results are kept per song and `pickLyrics()` re-picks by song length (±2s) whenever the progress bar's length changes, so an ad's length doesn't lose the match. Clicking a line seeks; wheel/touch pauses auto-scroll for 3s. The −/+ buttons in the lyrics footer shift timing by 0.5s per song; the offset lives in `chrome.storage.local` as `off:<title|artist>` (local, not sync: sync's quota is too small for per-song data), removed when back to 0. LRCLIB hits that are romanized Korean (`isRomanizedKorean`) are dropped, and only the first artist link is used for the search. No match → YouTube's own lyrics stay. When YouTube has no lyrics (lyrics tab `[disabled]`) and the player page is not in `video-mode`, `lyricsHost()` revives the tab (`.ym-tab-live`) and a click shows our own `.ym-lyrics-panel` in place of `#tab-renderer` (`.ym-tab-on` fakes the selected look; YouTube ignores clicks on a disabled tab, so we cannot reuse its tab switching). In that case plain (untimed) LRCLIB lyrics are shown too, without highlighting.
- `content/theme.css` does all visuals, every rule scoped under `html.ym-theme-on`. `--ym-c1/--ym-c2` are registered with `@property` as `<color>` so album changes transition smoothly.

## YouTube Music gotchas (learned the hard way)

- The extension depends on YouTube Music's internal element names. DOM selectors live in `SEL` at the top of `content.js` and in `theme.css`; fix them there when the site changes.
- Do not override `--ytmusic-general-background-*` variables to transparent: that made the search suggestions dropdown (and other popups) see-through (fixed in v1.0.1). Only the nav-bar, player-bar and search background variables are overridden.
- The stepped/banded home background came from two YouTube elements: `ytmusic-fullbleed-thumbnail-renderer` (hidden) and `ytmusic-browse-response .background-gradient` (only its `background-image` is cleared; `display:none` breaks the layout).
- `ytmusic-player-page` is `position:fixed` and slides up from the bottom, so it needs its own opaque copy of the gradient; a transparent background shows the home page through it.
- YouTube Music web lyrics carry no timing data, and InnerTube `browse` with mobile clients (ANDROID_MUSIC/IOS_MUSIC) from the page returns "lyrics unavailable" (tested 2026-11); that is why timing comes from LRCLIB.
- Never use `video.currentTime`/`video.duration` as the song's position/length. ~10s before a song ends YouTube appends the next track to the same buffer: `duration` grows (217s → 233s → 267s seen), and after the automatic switch `currentTime` keeps counting on the old timeline (bar shows 0:15, `currentTime` is 211). The player API's `getDuration()` is wrong then too. Position = `video.currentTime` minus `<html data-ym-time-base>`, which `content/page.js` (MAIN world, the only place that can call `movie_player.getCurrentTime()`) keeps up to date; length = `aria-valuemax` of `ytmusic-player-bar #progress-bar`. Pressing "next" reloads the video, so the bug only shows on automatic transitions: test those.
- The ~1s delay when opening the player page is YouTube's own, not the extension's.
- Chrome rejects some shortcuts that clash with built-ins (Alt+Shift+T did); users can reassign at `chrome://extensions/shortcuts`.

## Windows tooling notes

- Keep `.ps1` files ASCII-only: Windows PowerShell 5.1 misreads non-ASCII in BOM-less files.
- Zip with `System32\tar.exe`, not Git Bash's GNU tar (fails on `C:\` paths) and not `Compress-Archive` 5.1 (writes backslash entry paths that Chrome rejects).
