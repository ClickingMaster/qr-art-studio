(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const QUIET = 2; // quiet-zone width in modules

  let image = null; // HTMLImageElement | HTMLCanvasElement | null

  // Style presets: each one just sets a handful of controls.
  const PRESETS = [
    { id: 'blueprint', name: 'Blueprint', layer: 'smooth', style: 'circle', dot: 0.8, idot: 0.5, ink: 1, fshape: 'circle' },
    { id: 'bold', name: 'Bold', layer: 'smooth', style: 'square', dot: 0.7, idot: 0.55, ink: 0.65, fshape: 'square' },
    { id: 'poster', name: 'Poster', layer: 'smooth', style: 'circle', dot: 0.95, idot: 0.6, ink: 0.85, fshape: 'square' },
    { id: 'etch', name: 'Etch', layer: 'smooth', style: 'square', dot: 0.75, idot: 0.4, ink: 0.7, fshape: 'square' },
    { id: 'halftone', name: 'Halftone', layer: 'dots', style: 'circle', dot: 0.35, idot: 0.8, ink: 1, fshape: 'circle' },
    { id: 'classic', name: 'Classic', layer: 'blocks', style: 'square', dot: 0.92, idot: 0.5, ink: 1, fshape: 'square' },
  ];
  const PRESET_KEYS = ['layer', 'style', 'dot', 'idot', 'ink', 'fshape'];

  // ---------- helpers ----------
  const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const css = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
  const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

  function hexToRgb(h) {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function lightenTo(c, min) {
    const l = luma(c);
    return l < min ? mix(c, [255, 255, 255], (min - l) / (255 - l)) : c;
  }

  function limitLuma(c, max) {
    const l = luma(c);
    return l > max ? c.map((v) => Math.round((v * max) / l)) : c;
  }

  function shape(c, style, x, y, s) {
    if (style === 'circle') {
      c.beginPath();
      c.arc(x + s / 2, y + s / 2, s / 2, 0, Math.PI * 2);
      c.fill();
    } else if (style === 'rounded') {
      c.beginPath();
      c.roundRect(x, y, s, s, s * 0.3);
      c.fill();
    } else c.fillRect(x, y, s, s);
  }

  // ---------- sample artwork (original) ----------
  function makeSample() {
    const c = document.createElement('canvas');
    c.width = c.height = 800;
    const g = c.getContext('2d');
    const cols = ['#e4572e', '#17bebb', '#7b2d8e', '#f2a900'];
    g.translate(400, 400);
    for (let i = 0; i < 8; i++) {
      g.fillStyle = cols[i % 4];
      g.beginPath();
      g.ellipse(0, -215, 85, 175, 0, 0, Math.PI * 2);
      g.fill();
      g.rotate(Math.PI / 4);
    }
    g.fillStyle = '#1f3a5f';
    g.beginPath();
    g.arc(0, 0, 105, 0, Math.PI * 2);
    g.fill();
    return c;
  }

  // ---------- caches (thumbnails redraw often) ----------
  let qrKey = '', qrVal = null;
  function getQR(text, ecc, ver) {
    const k = `${text}\n${ecc}\n${ver}`;
    if (k !== qrKey) {
      qrVal = QR.encode(text, ecc, ver);
      qrKey = k;
    }
    return qrVal;
  }

  let smpKey = null, smpVal = null;
  // Per-module coverage and average color of the image's foreground.
  function embedSamples(n, zoom, thr) {
    if (smpKey && smpKey.image === image && smpKey.n === n && smpKey.zoom === zoom && smpKey.thr === thr) return smpVal;
    const S = 4, N = n * S;
    const t = document.createElement('canvas');
    t.width = t.height = N;
    const g = t.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingQuality = 'high';
    const sc = Math.min(N / image.width, N / image.height) * zoom;
    const w = image.width * sc, h = image.height * sc;
    g.drawImage(image, (N - w) / 2, (N - h) / 2, w, h);
    const d = g.getImageData(0, 0, N, N).data;
    const out = [];
    for (let y = 0; y < n; y++) {
      const row = [];
      for (let x = 0; x < n; x++) {
        let cnt = 0, r = 0, gg = 0, b = 0;
        for (let sy = 0; sy < S; sy++)
          for (let sx = 0; sx < S; sx++) {
            const i = ((y * S + sy) * N + x * S + sx) * 4;
            if (d[i + 3] > 128 && luma([d[i], d[i + 1], d[i + 2]]) < thr) {
              cnt++; r += d[i]; gg += d[i + 1]; b += d[i + 2];
            }
          }
        row.push({ cover: cnt / (S * S), color: cnt ? [r / cnt, gg / cnt, b / cnt].map(Math.round) : null });
      }
      out.push(row);
    }
    smpKey = { image, n, zoom, thr };
    smpVal = out;
    return out;
  }

  function dominantColor(smp) {
    const buckets = new Map();
    for (const row of smp) for (const s of row) {
      if (!s.color || s.cover < 0.5) continue;
      const k = s.color.map((v) => v >> 6).join();
      const e = buckets.get(k) || { c: 0, sum: [0, 0, 0] };
      e.c++;
      for (let i = 0; i < 3; i++) e.sum[i] += s.color[i];
      buckets.set(k, e);
    }
    let best = null;
    for (const e of buckets.values()) if (!best || e.c > best.c) best = e;
    return best ? best.sum.map((v) => Math.round(v / best.c)) : null;
  }

  // Full-resolution image with background pixels removed.
  function maskedImage(P, zoom, thr) {
    const t = document.createElement('canvas');
    t.width = t.height = P;
    const g = t.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingQuality = 'high';
    const sc = Math.min(P / image.width, P / image.height) * zoom;
    const w = image.width * sc, h = image.height * sc;
    g.drawImage(image, (P - w) / 2, (P - h) / 2, w, h);
    const im = g.getImageData(0, 0, P, P);
    const d = im.data;
    for (let i = 0; i < d.length; i += 4)
      d[i + 3] = d[i + 3] < 128 || luma([d[i], d[i + 1], d[i + 2]]) >= thr ? 0 : 255;
    g.putImageData(im, 0, 0);
    return t;
  }

  // ---------- drawing ----------
  // S: settings. Throws if the text can't be encoded.
  function draw(cv, S) {
    const ctx = cv.getContext('2d');
    const qr = getQR(S.text, S.ecc, S.ver);
    const n = qr.size;
    const W = cv.width;
    const cell = W / (n + QUIET * 2);
    const off = QUIET * cell;
    const dark = hexToRgb(S.dark), light = hexToRgb(S.light);
    const smp = image ? embedSamples(n, S.zoom, S.thr) : null;

    ctx.globalAlpha = 1;
    ctx.fillStyle = css(light);
    ctx.fillRect(0, 0, W, W);

    let finder = dark;
    if (smp && S.fcol) {
      const dc = dominantColor(smp);
      if (dc) finder = limitLuma(dc, 110);
    }

    if (smp && S.layer === 'smooth') {
      ctx.drawImage(maskedImage(Math.round(n * cell), S.zoom, S.thr), off, off);
      // Clear image under function patterns (separate pass so cells don't overpaint neighbours).
      ctx.fillStyle = css(light);
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++)
          if (qr.kind[y][x] !== 0) ctx.fillRect(off + x * cell - 0.5, off + y * cell - 0.5, cell + 1, cell + 1);
    }

    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const kind = qr.kind[y][x];
        const isDark = qr.modules[y][x];
        const px = off + x * cell, py = off + y * cell;
        const s = smp && smp[y][x];
        const inside = kind === 0 && s && s.cover > 0.35;

        if (inside && S.layer === 'blocks') {
          const sz = cell * 0.94;
          ctx.fillStyle = css(isDark ? limitLuma(s.color, 110) : lightenTo(mix(s.color, light, 0.65), 195));
          shape(ctx, S.style === 'circle' ? 'rounded' : S.style, px + (cell - sz) / 2, py + (cell - sz) / 2, sz);
        } else if (inside && S.layer === 'dots') {
          if (isDark) {
            const sz = cell * S.idot;
            ctx.fillStyle = css(limitLuma(s.color, 110));
            shape(ctx, S.style, px + (cell - sz) / 2, py + (cell - sz) / 2, sz);
          }
        } else if (inside) { // smooth: dot in the middle of each module over the image
          const sz = cell * S.idot;
          ctx.fillStyle = css(isDark ? mix(s.color, [0, 0, 0], 0.78) : mix(s.color, [255, 255, 255], 0.85));
          shape(ctx, S.style, px + (cell - sz) / 2, py + (cell - sz) / 2, sz);
        } else if (isDark) {
          ctx.fillStyle = css(kind === 2 ? finder : dark);
          const fsolid = kind === 2 && S.fshape === 'square';
          const sz = fsolid ? cell + 0.6 : cell * (kind === 0 ? S.dot : 0.92);
          ctx.globalAlpha = kind === 0 ? S.ink : 1;
          shape(ctx, kind === 0 ? S.style : fsolid ? 'square' : 'circle', fsolid ? px - 0.3 : px + (cell - sz) / 2, fsolid ? py - 0.3 : py + (cell - sz) / 2, sz);
          ctx.globalAlpha = 1;
        }
      }
    }
    return qr;
  }

  // ---------- UI ----------
  const cv = $('cv');
  const DEFAULTS = { ecc: 'H', ver: 14, zoom: 1, thr: 245, dark: '#101218', light: '#ffffff', fcol: true };
  const SELECTS = ['ecc', 'style', 'layer', 'fshape'];
  const RANGES = ['ver', 'zoom', 'thr', 'dot', 'idot', 'ink'];

  function settings(over) {
    return Object.assign({
      text: $('text').value,
      ecc: $('ecc').value, ver: +$('ver').value, zoom: +$('zoom').value, thr: +$('thr').value,
      style: $('style').value, layer: $('layer').value, fshape: $('fshape').value,
      dot: +$('dot').value, idot: +$('idot').value, ink: +$('ink').value,
      dark: $('dark').value, light: $('light').value, fcol: $('fcol').checked,
    }, over);
  }

  function render() {
    const meta = $('meta');
    for (const id of RANGES) {
      const r = $(id);
      r.style.setProperty('--p', ((r.value - r.min) / (r.max - r.min)) * 100 + '%');
    }
    $('verV').textContent = `${$('ver').value} (${+$('ver').value * 4 + 17}² min)`;
    $('zoomV').textContent = (+$('zoom').value).toFixed(2) + '×';
    $('thrV').textContent = $('thr').value;
    $('dotV').textContent = Math.round($('dot').value * 100) + '%';
    $('idotV').textContent = Math.round($('idot').value * 100) + '%';
    $('inkV').textContent = Math.round($('ink').value * 100) + '%';
    try {
      if (!$('text').value) throw new Error('Enter some content to encode');
      const qr = draw(cv, settings());
      meta.textContent = `Version ${qr.version} · ${qr.size}×${qr.size} modules · ECC ${qr.ecc} · mask ${qr.mask}`;
    } catch (e) {
      meta.innerHTML = '<span class="err"></span>';
      meta.firstChild.textContent = e.message;
      return;
    }
    scheduleThumbs();
  }

  // Style gallery
  const gallery = $('styles');
  const thumbs = {};
  let activePreset = null;
  for (const p of PRESETS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'style';
    b.dataset.id = p.id;
    const c = document.createElement('canvas');
    c.width = c.height = 260;
    const label = document.createElement('span');
    label.textContent = p.name;
    b.append(c, label);
    b.onclick = () => applyPreset(p);
    gallery.append(b);
    thumbs[p.id] = c;
  }

  function markActive() {
    for (const b of gallery.children) b.classList.toggle('active', b.dataset.id === activePreset);
  }

  function applyPreset(p) {
    for (const k of PRESET_KEYS) $(k).value = p[k];
    activePreset = p.id;
    markActive();
    render();
  }

  let thumbTimer = 0;
  function scheduleThumbs() {
    clearTimeout(thumbTimer);
    thumbTimer = setTimeout(() => {
      if (!$('text').value) return;
      for (const p of PRESETS) {
        try {
          const o = {};
          for (const k of PRESET_KEYS) o[k] = p[k];
          draw(thumbs[p.id], settings(o));
        } catch (e) { /* main canvas reports the error */ }
      }
    }, 120);
  }

  // ---------- image input ----------
  function loadFile(f) {
    if (!f || !f.type.startsWith('image/')) return;
    const img = new Image();
    img.onload = () => { image = img; render(); };
    img.src = URL.createObjectURL(f);
  }

  const drop = $('drop'), file = $('file');
  drop.onclick = () => file.click();
  file.onchange = () => loadFile(file.files[0]);
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    loadFile(e.dataTransfer.files[0]);
  };
  window.addEventListener('paste', (e) => {
    for (const it of e.clipboardData.items) if (it.type.startsWith('image/')) loadFile(it.getAsFile());
  });

  $('sample').onclick = () => { image = makeSample(); render(); };
  $('clear').onclick = () => { image = null; render(); };

  $('download').onclick = () => {
    cv.toBlob((b) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = 'qr-art.png';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
  };

  for (const id of ['text', 'fcol', 'dark', 'light', ...SELECTS, ...RANGES])
    $(id).addEventListener('input', () => {
      if (PRESET_KEYS.includes(id)) { activePreset = null; markActive(); }
      render();
    });

  // Don't trust values a browser may have restored from an older version of the page.
  for (const [k, v] of Object.entries(DEFAULTS)) {
    if (typeof v === 'boolean') $(k).checked = v;
    else $(k).value = v;
  }
  image = makeSample();
  applyPreset(PRESETS[PRESETS.length - 1]);
})();
