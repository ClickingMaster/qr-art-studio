// Minimal QR Code encoder (byte mode, versions 1-40, ECC L/M/Q/H).
// Written from the ISO/IEC 18004 spec. Exposes a global `QR.encode(text, eccLevel)`.
(function (root) {
  'use strict';

  // Per-version tables, index = version (0 unused). Rows: L, M, Q, H.
  const ECC_PER_BLOCK = {
    L: [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    M: [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    Q: [0, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    H: [0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  };
  const NUM_BLOCKS = {
    L: [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    M: [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    Q: [0, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    H: [0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
  };
  const FORMAT_BITS = { L: 1, M: 0, Q: 3, H: 2 };

  // ---- Reed-Solomon over GF(256), primitive polynomial 0x11D ----
  const EXP = new Uint8Array(512);
  const LOG = new Uint8Array(256);
  (function () {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();

  function gfMul(a, b) {
    return a && b ? EXP[LOG[a] + LOG[b]] : 0;
  }

  function rsGenerator(degree) {
    // Product of (x - α^i) for i in 0..degree-1; coefficients high -> low, leading 1 omitted.
    const g = new Array(degree).fill(0);
    g[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i++) {
      for (let j = 0; j < degree; j++) {
        g[j] = gfMul(g[j], root);
        if (j + 1 < degree) g[j] ^= g[j + 1];
      }
      root = gfMul(root, 2);
    }
    return g;
  }

  function rsRemainder(data, gen) {
    const rem = new Array(gen.length).fill(0);
    for (const b of data) {
      const factor = b ^ rem.shift();
      rem.push(0);
      for (let i = 0; i < gen.length; i++) rem[i] ^= gfMul(gen[i], factor);
    }
    return rem;
  }

  // ---- Capacity helpers ----
  function rawModules(ver) {
    let r = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      const n = Math.floor(ver / 7) + 2;
      r -= (25 * n - 10) * n - 55;
      if (ver >= 7) r -= 36;
    }
    return r;
  }

  function dataCodewords(ver, ecc) {
    return Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[ecc][ver] * NUM_BLOCKS[ecc][ver];
  }

  function alignmentPositions(ver) {
    if (ver === 1) return [];
    const n = Math.floor(ver / 7) + 2;
    const size = ver * 4 + 17;
    const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
    const pos = [6];
    for (let p = size - 7, k = 1; pos.length < n; p -= step) pos.splice(k, 0, p);
    return pos;
  }

  // ---- Bit stream ----
  function buildCodewords(bytes, ver, ecc) {
    const bits = [];
    const push = (val, len) => {
      for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
    };
    push(0b0100, 4);
    push(bytes.length, ver < 10 ? 8 : 16);
    for (const b of bytes) push(b, 8);

    const capBits = dataCodewords(ver, ecc) * 8;
    push(0, Math.min(4, capBits - bits.length));
    while (bits.length % 8) bits.push(0);
    for (let pad = 0xec; bits.length < capBits; pad ^= 0xec ^ 0x11) push(pad, 8);

    const data = [];
    for (let i = 0; i < bits.length; i += 8) {
      let v = 0;
      for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
      data.push(v);
    }

    // Split into blocks, add ECC, interleave.
    const nBlocks = NUM_BLOCKS[ecc][ver];
    const eccLen = ECC_PER_BLOCK[ecc][ver];
    const rawCw = Math.floor(rawModules(ver) / 8);
    const nShort = nBlocks - (rawCw % nBlocks);
    const shortLen = Math.floor(rawCw / nBlocks);
    const gen = rsGenerator(eccLen);
    const blocks = [];
    for (let i = 0, k = 0; i < nBlocks; i++) {
      const len = shortLen - eccLen + (i < nShort ? 0 : 1);
      const d = data.slice(k, k + len);
      k += len;
      blocks.push({ d, e: rsRemainder(d, gen) });
    }
    const out = [];
    const maxData = shortLen - eccLen + 1;
    for (let i = 0; i < maxData; i++) for (const b of blocks) if (i < b.d.length) out.push(b.d[i]);
    for (let i = 0; i < eccLen; i++) for (const b of blocks) out.push(b.e[i]);
    return out;
  }

  // ---- Matrix construction ----
  function makeGrid(size, fill) {
    return Array.from({ length: size }, () => new Array(size).fill(fill));
  }

  function bchRemainder(value, poly, degree) {
    let r = value << degree;
    const top = 31 - Math.clz32(poly);
    for (let i = 31 - Math.clz32(r); i >= top; i--) if ((r >>> i) & 1) r ^= poly << (i - top);
    return r;
  }

  function drawFunctionPatterns(m, fn, ver) {
    const size = m.length;
    const set = (x, y, v) => {
      m[y][x] = v;
      fn[y][x] = 1;
    };
    // Timing
    for (let i = 0; i < size; i++) {
      set(6, i, i % 2 === 0);
      set(i, 6, i % 2 === 0);
    }
    // Finders + separators (kind 2 = finder region)
    const finder = (cx, cy) => {
      for (let dy = -4; dy <= 4; dy++)
        for (let dx = -4; dx <= 4; dx++) {
          const x = cx + dx, y = cy + dy;
          if (x < 0 || y < 0 || x >= size || y >= size) continue;
          const d = Math.max(Math.abs(dx), Math.abs(dy));
          set(x, y, d !== 2 && d !== 4);
          fn[y][x] = 2;
        }
    };
    finder(3, 3);
    finder(size - 4, 3);
    finder(3, size - 4);
    // Alignment (kind 3)
    const ap = alignmentPositions(ver);
    for (const cy of ap)
      for (const cx of ap) {
        if ((cx === 6 && cy === 6) || (cx === 6 && cy === size - 7) || (cx === size - 7 && cy === 6)) continue;
        for (let dy = -2; dy <= 2; dy++)
          for (let dx = -2; dx <= 2; dx++) {
            set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
            fn[cy + dy][cx + dx] = 3;
          }
      }
    // Reserve format + version areas (values filled later)
    drawFormat(m, fn, 'L', 0);
    if (ver >= 7) {
      const rem = bchRemainder(ver, 0x1f25, 12);
      const bits = (ver << 12) | rem;
      for (let i = 0; i < 18; i++) {
        const bit = ((bits >>> i) & 1) === 1;
        const a = size - 11 + (i % 3), b = Math.floor(i / 3);
        set(a, b, bit);
        set(b, a, bit);
      }
    }
  }

  function drawFormat(m, fn, ecc, mask) {
    const size = m.length;
    const data = (FORMAT_BITS[ecc] << 3) | mask;
    const bits = ((data << 10) | bchRemainder(data, 0x537, 10)) ^ 0x5412;
    const set = (x, y, v) => {
      m[y][x] = v;
      fn[y][x] = 1;
    };
    const bit = (i) => ((bits >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6));
    set(8, 8, bit(7));
    set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true); // always-dark module
  }

  function placeData(m, fn, codewords) {
    const size = m.length;
    let i = 0;
    const total = codewords.length * 8;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let v = 0; v < size; v++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const up = ((right + 1) & 2) === 0;
          const y = up ? size - 1 - v : v;
          if (fn[y][x]) continue;
          if (i < total) {
            m[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
            i++;
          } else m[y][x] = false;
        }
      }
    }
  }

  const MASKS = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x, y) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];

  function applyMask(m, fn, mask) {
    const size = m.length;
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) if (!fn[y][x] && MASKS[mask](x, y)) m[y][x] = !m[y][x];
  }

  function penalty(m) {
    const size = m.length;
    let score = 0;
    const lineScore = (get) => {
      for (let a = 0; a < size; a++) {
        let run = 1;
        const hist = [];
        for (let b = 1; b <= size; b++) {
          if (b < size && get(a, b) === get(a, b - 1)) run++;
          else {
            if (run >= 5) score += 3 + (run - 5);
            hist.push(run);
            run = 1;
          }
        }
        // finder-like 1:1:3:1:1 patterns (runs with 4+ light on a side)
        let pos = 0;
        for (let k = 0; k < hist.length; k++) {
          if (k >= 1 && k + 3 < hist.length) {
            const dark = get(a, pos) ;
            const r = hist.slice(k, k + 5);
            if (dark && r[0] === r[1] * 1 && r[1] === r[3] && r[3] === r[4] && r[2] === 3 * r[1]) {
              const before = k > 0 ? hist[k - 1] : 0;
              const after = k + 5 < hist.length ? hist[k + 5] : 0;
              if (before >= 4 * r[1] || after >= 4 * r[1]) score += 40;
            }
          }
          pos += hist[k];
        }
      }
    };
    lineScore((a, b) => m[a][b]);
    lineScore((a, b) => m[b][a]);
    for (let y = 0; y < size - 1; y++)
      for (let x = 0; x < size - 1; x++) {
        const c = m[y][x];
        if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3;
      }
    let dark = 0;
    for (const row of m) for (const c of row) if (c) dark++;
    const pct = (dark * 100) / (size * size);
    score += Math.floor(Math.abs(pct - 50) / 5) * 10;
    return score;
  }

  /**
   * Encode text (UTF-8, byte mode).
   * @returns {{version:number, size:number, modules:boolean[][], kind:number[][], ecc:string, mask:number}}
   *   kind: 0 data, 1 format/timing/version, 2 finder+separator, 3 alignment
   */
  function encode(text, ecc = 'M', minVersion = 1) {
    if (!ECC_PER_BLOCK[ecc]) throw new Error('Bad ECC level');
    const bytes = Array.from(new TextEncoder().encode(text));
    let ver = Math.max(1, minVersion);
    for (;; ver++) {
      if (ver > 40) throw new Error('Text is too long for a QR code at this error-correction level');
      const lenBits = ver < 10 ? 8 : 16;
      if (bytes.length >= 1 << lenBits) continue;
      if (4 + lenBits + bytes.length * 8 <= dataCodewords(ver, ecc) * 8) break;
    }
    const size = ver * 4 + 17;
    const codewords = buildCodewords(bytes, ver, ecc);

    const base = makeGrid(size, false);
    const fn = makeGrid(size, 0);
    drawFunctionPatterns(base, fn, ver);
    placeData(base, fn, codewords);

    let best = null;
    for (let mask = 0; mask < 8; mask++) {
      const m = base.map((r) => r.slice());
      applyMask(m, fn, mask);
      drawFormat(m, makeGrid(size, 0), ecc, mask);
      const p = penalty(m);
      if (!best || p < best.p) best = { p, m, mask };
    }
    return { version: ver, size, modules: best.m, kind: fn, ecc, mask: best.mask };
  }

  root.QR = { encode };
})(typeof window !== 'undefined' ? window : globalThis);
