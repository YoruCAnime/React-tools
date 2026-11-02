// ==UserScript==
// @name         Konosuba Reaction Reframer (Google Drive)
// @namespace    konosuba-drive-reframer
// @version      1.0.0
// @description  For the "konosuba s2-movie-s3-s3ova1-2" Google Drive folder: the anime window enlarged on the left with its subtitles whole, the streamers on the right (Wes and Steph; FreshestAnime on the two S3 OVAs). R or the small button switches the framing.
// @homepageURL  https://github.com/YoruCAnime/React-tools
// @updateURL    https://raw.githubusercontent.com/YoruCAnime/React-tools/main/konosuba-drive/konosuba-drive-reframer.user.js
// @downloadURL  https://raw.githubusercontent.com/YoruCAnime/React-tools/main/konosuba-drive/konosuba-drive-reframer.user.js
// @match        https://drive.google.com/*
// @match        https://youtube.googleapis.com/embed/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

/*
 * How it works
 * Google Drive plays videos in YouTube's player, inside a frame. This script
 * runs in that frame, takes the player's video and draws it again on a
 * canvas: the anime window on the left (big), the streamers' heads stacked on
 * the right, the same height. The real video keeps playing underneath (sound,
 * the seek bar and every player control work as usual); only the picture is
 * rearranged. The Drive page tells the frame which file is playing, so each
 * video gets its own framing.
 *
 * Framing (fractions of the 1920x1080 frame), measured on the first episode
 * of each part of the folder (Nov 2026): S2, the Megumin spinoff (Explosion),
 * the movie and S3 all have Wes and Steph's window in the same place - its
 * full 960 x 538 area kept (1 px inside its blended edge), so the subtitles
 * at its bottom are never cut. The two S3 OVAs are FreshestAnime's layout.
 *
 * Use
 * - Just play a video: it opens reframed.
 * - R (click the video first) or the small button at the top left of the
 *   player: Wes and Steph framing -> Freshest framing -> off (the plain
 *   video) -> ... Your choice is remembered for that file.
 */
(function () {
  'use strict';

  // ------------------------------------------------------------- framings
  const WES_AND_STEPH = {
    name: 'Wes and Steph',
    left: [{ x: 0.2505, y: 0.3204, w: 0.4990, h: 0.4963 }],        // the anime window, subtitles included
    right: [
      { x: 0.0156, y: 0.2556, w: 0.2328, h: 0.4519 },               // Steph (left of the window in the video)
      { x: 0.7510, y: 0.1852, w: 0.2188, h: 0.4306 },               // Wes (right of the window)
    ],
  };
  const FRESHEST = {
    name: 'FreshestAnime',
    left: [{ x: 0.0000, y: 0.0000, w: 0.5495, h: 0.5481 }],        // the anime window, top left
    right: [{ x: 0.6078, y: 0.0241, w: 0.2859, h: 0.7400 }],       // his head and beard
  };
  const FRAMINGS = { ws: WES_AND_STEPH, fresh: FRESHEST };
  const ORDER = ['ws', 'fresh', 'off'];

  // Which framing a file gets, from its name (each part measured on its first episode).
  const PARTS = [
    { test: /\bOVA\b/i, framing: 'fresh' },                  // S3 OVA 1, S3 OVA 2 (FreshestAnime)
    { test: /\bS2 Episode\b/i, framing: 'ws' },              // measured on S2 Episode 1
    { test: /\bExplosion Episode\b/i, framing: 'ws' },       // the Megumin spinoff, Explosion Episode 1
    { test: /\bMovie\b/i, framing: 'ws' },                   // Konosuba The Movie Reaction
    { test: /\bS3 Episode\b/i, framing: 'ws' },              // measured on S3 Episode 1
  ];
  const framingFor = (name) => {
    const saved = name ? store.get('choice:' + name, null) : null;
    if (saved && (saved === 'off' || FRAMINGS[saved])) return saved;
    const part = PARTS.find((p) => p.test.test(name || ''));
    return part ? part.framing : 'ws';                       // the folder is mostly Wes and Steph
  };

  const store = {
    get: (k, d) => { try { return GM_getValue(k, d); } catch (e) { return d; } },
    set: (k, v) => { try { GM_setValue(k, v); } catch (e) { /* not kept */ } },
  };

  // Test pages can stand in for Drive and its player (RRFD_TEST).
  const T = window.RRFD_TEST || {};
  const DRIVE_ORIGIN = T.driveOrigin || 'https://drive.google.com';
  const ROLE = T.role || (location.hostname === 'drive.google.com' ? 'drive'
    : location.hostname === 'youtube.googleapis.com' && /[?&]ps=docs\b/.test(location.search) ? 'player' : null);
  const VIDEO_NAME = /\.(mp4|mkv|mov|webm|m4v|avi)$/i;

  // ------------------------------------------------- the Drive page: names
  // The player can't see the file's name, so the page tells it: the title of
  // a file's own page ("S3 Episode 2.mp4 - Google Drive"), or the name shown
  // at the top of a folder's preview. (A folder's preview is its own Drive
  // frame, /viewer/main, holding that name and the player; this runs there
  // too. Seen on the real folder, 2 Nov 2026.)
  if (ROLE === 'drive') {
    const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight; };
    const fileName = () => {
      const t = document.title.replace(/\s*[-–]\s*Google Drive\s*$/i, '').trim();
      if (VIDEO_NAME.test(t)) return t;
      for (const el of document.querySelectorAll('body *')) {
        if (el.children.length || !VIDEO_NAME.test((el.textContent || '').trim())) continue;
        if (el.closest('[role="grid"], [role="row"], [role="gridcell"], [role="listbox"]')) continue;   // the folder's list
        if (visible(el)) return el.textContent.trim();
      }
      return '';
    };
    setInterval(() => {
      // Only while a video player is open (Drive's player frames).
      const frames = [...document.querySelectorAll('iframe')]
        .filter((f) => T.role || /youtube\.googleapis\.com\/embed/.test(f.src || ''));
      if (!frames.length) return;
      const name = fileName();
      for (const f of frames) {
        try { f.contentWindow.postMessage({ rrfdName: name }, '*'); } catch (e) { /* gone */ }
      }
    }, 1000);
    return;
  }
  if (ROLE !== 'player') return;

  // ------------------------------------------------ the player: the picture
  let name = '', choice = null, video = null, canvas = null, ctx = null, chip = null, chipT = null;

  window.addEventListener('message', (e) => {
    if (e.origin !== DRIVE_ORIGIN || !e.data || typeof e.data.rrfdName !== 'string') return;
    setName(e.data.rrfdName);
  });

  // The player's own title, when it shows one (a file opened some other way).
  const playerTitle = () => {
    const el = document.querySelector('.ytp-title-link, .ytp-title-text');
    let t = el ? (el.textContent || '').trim() : '';
    if (!t) {
      try {
        const p = (typeof unsafeWindow !== 'undefined' ? unsafeWindow : window).document.getElementById('movie_player');
        const d = p && p.getVideoData && p.getVideoData();
        t = (d && d.title) || '';
      } catch (e) { /* no player API */ }
    }
    return t;
  };

  function setName(n) {
    if (!n || n === name) return;
    name = n;
    apply(framingFor(name), true);
  }

  function apply(c, quietIfSame) {
    if (quietIfSame && c === choice) return;
    choice = c;
    if (!video) return;
    if (c === 'off') {
      if (canvas) canvas.style.display = 'none';
      video.style.opacity = '';
    }
    showChip();
  }

  function cycle() {
    const next = ORDER[(ORDER.indexOf(choice || 'ws') + 1) % ORDER.length];
    if (name) store.set('choice:' + name, next);
    apply(next);
  }

  // A small, quiet button at the top left of the player: what's on, click to switch.
  function showChip() {
    if (!chip) return;
    chip.textContent = choice === 'off' ? '▭ plain video' : '⧉ ' + FRAMINGS[choice].name;
    chip.style.opacity = '0.85';
    clearTimeout(chipT);
    chipT = setTimeout(() => { chip.style.opacity = '0'; }, 2500);
  }

  function setup(v) {
    video = v;
    const player = v.closest('.html5-video-player') || v.parentElement.parentElement || document.body;
    const box = v.closest('.html5-video-container') || v.parentElement;
    canvas = document.createElement('canvas');
    canvas.className = 'rrfd-canvas';
    // Above the video, below YouTube's controls and seek bar.
    canvas.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;z-index:11;pointer-events:none;' +
      'object-fit:contain;background:#000;display:none';
    box.after(canvas);
    ctx = canvas.getContext('2d', { alpha: false });
    chip = document.createElement('div');
    chip.style.cssText = 'position:absolute;left:10px;top:10px;z-index:70;padding:4px 8px;border-radius:5px;' +
      'background:rgba(0,0,0,.45);color:#fff;font:600 12px/1 system-ui,sans-serif;cursor:pointer;opacity:0;' +
      'transition:opacity .25s;user-select:none';
    chip.title = 'Switch the framing (R)';
    chip.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); cycle(); });
    player.appendChild(chip);
    player.addEventListener('mousemove', () => { if (chip.style.opacity === '0') showChip(); });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'r' && e.key !== 'R') return;
      if (e.ctrlKey || e.altKey || e.metaKey || /input|textarea/i.test((e.target && e.target.tagName) || '')) return;
      cycle();
    }, true);
    if (!choice) apply(framingFor(name || playerTitle()));
    else showChip();
    requestAnimationFrame(draw);
  }

  // Each column: its boxes at one width, stacked; the column scaled to the
  // output height. The canvas is the two columns side by side, fitted into
  // the player (black bars where the shapes differ).
  function draw() {
    requestAnimationFrame(draw);
    frame();
  }
  function frame() {
    if (!video || !canvas) return;
    if (!name) { const t = playerTitle(); if (t) setName(t); }
    const f = FRAMINGS[choice];
    const W = video.videoWidth, H = video.videoHeight;
    if (!f || !W || !H || video.readyState < 2) {
      if (choice === 'off' || !f) return;
      canvas.style.display = 'none';
      video.style.opacity = '';
      return;
    }
    const OUT = 1080, REF = 1000;
    const cols = [f.left, f.right].map((rects) => {
      let colH = 0;
      const parts = rects.map((r) => { const h = REF * (r.h * H) / (r.w * W); colH += h; return { r, h }; });
      return { parts, colH, w: Math.round(REF * OUT / colH) };
    });
    const total = cols[0].w + cols[1].w;
    if (canvas.width !== total || canvas.height !== OUT) { canvas.width = total; canvas.height = OUT; }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    let dx = 0;
    for (const col of cols) {
      let dy = 0;
      col.parts.forEach(({ r, h }, i) => {
        const dh = i === col.parts.length - 1 ? OUT - dy : Math.round(h * OUT / col.colH);
        ctx.drawImage(video, r.x * W, r.y * H, r.w * W, r.h * H, dx, dy, col.w, dh);
        dy += dh;
      });
      dx += col.w;
    }
    if (canvas.style.display === 'none') {
      canvas.style.display = '';
      video.style.opacity = '0';                   // the canvas shows it now
    }
  }

  // The player's video appears a moment after the frame loads.
  const find = () => {
    const v = document.querySelector('video.html5-main-video') || document.querySelector('video');
    if (v && v !== video) setup(v);
  };
  find();
  new MutationObserver(find).observe(document.documentElement, { childList: true, subtree: true });
  if (T.role) window.__rrfd = { frame, cycle, get choice() { return choice; }, get name() { return name; } };
})();
