// Photo handling: find the face in a photo, sample 9 stickers, classify colors.
(function (root) {
  'use strict';

  const DEFAULT_RGB = { W: [235, 235, 230], Y: [235, 225, 40], G: [40, 200, 80], B: [30, 110, 235], R: [215, 30, 45], O: [250, 110, 30] };
  const COLORS = ['W', 'Y', 'G', 'B', 'R', 'O'];

  async function loadImage(src, maxSide) {
    maxSide = maxSide || 900;
    const img = new Image();
    img.decoding = 'async';
    const url = typeof src === 'string' ? src : URL.createObjectURL(src);
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('This photo could not be opened. Try a JPEG or PNG.')); img.src = url; });
    const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const cv = document.createElement('canvas');
    cv.width = Math.round(img.naturalWidth * k); cv.height = Math.round(img.naturalHeight * k);
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
    if (typeof src !== 'string') URL.revokeObjectURL(url);
    return cv;
  }

  // Face outline for a photo: the sticker-lattice detector, else the largest bright blob.
  function autoQuad(cv) {
    const det = detectFace(cv);
    return det ? det.quad : blobQuad(cv);
  }
  function blobQuad(cv) {
    const W = 160, H = Math.round(cv.height * W / cv.width);
    const sm = document.createElement('canvas'); sm.width = W; sm.height = H;
    const sx = sm.getContext('2d'); sx.drawImage(cv, 0, 0, W, H);
    const d = sx.getImageData(0, 0, W, H).data;
    const mask = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) {
      const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const s = mx ? (mx - mn) / mx : 0, v = mx / 255;
      mask[i] = (s > 0.38 && v > 0.32) || (v > 0.72 && s < 0.25) ? 1 : 0;
    }
    // close small gaps between stickers
    const dil = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let on = 0;
      for (let dy = -2; dy <= 2 && !on; dy++) for (let dx = -2; dx <= 2 && !on; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < W && yy < H && mask[yy * W + xx]) on = 1;
      }
      dil[y * W + x] = on;
    }
    const lab = new Int32Array(W * H).fill(-1);
    let best = null;
    for (let s0 = 0; s0 < W * H; s0++) {
      if (!dil[s0] || lab[s0] >= 0) continue;
      const stack = [s0], pts = [];
      lab[s0] = s0;
      while (stack.length) {
        const p = stack.pop(); pts.push(p);
        const x = p % W, y = (p - x) / W;
        for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const q = ny * W + nx;
          if (dil[q] && lab[q] < 0) { lab[q] = s0; stack.push(q); }
        }
      }
      let cx = 0, cy = 0; pts.forEach(p => { cx += p % W; cy += Math.floor(p / W); });
      cx /= pts.length; cy /= pts.length;
      const dc = Math.hypot(cx / W - 0.5, cy / H - 0.5);
      const score = pts.length * (1 - Math.min(0.9, dc * 1.4));
      if (!best || score > best.score) best = { score, pts };
    }
    if (!best || best.pts.length < W * H * 0.03) return defaultQuad(cv);
    // extreme points along diagonals give the four corners (handles slight tilt)
    let tl, tr, br, bl;
    let a = Infinity, b = -Infinity, c = -Infinity, e = Infinity;
    for (const p of best.pts) {
      const x = p % W, y = Math.floor(p / W);
      if (x + y < a) { a = x + y; tl = [x, y]; }
      if (x - y > b) { b = x - y; tr = [x, y]; }
      if (x + y > c) { c = x + y; br = [x, y]; }
      if (x - y < e) { e = x - y; bl = [x, y]; }
    }
    const k = cv.width / W;
    // pull in by the dilation radius
    const q = [tl, tr, br, bl].map(([x, y]) => [x * k, y * k]);
    const ctr = q.reduce((s, p) => [s[0] + p[0] / 4, s[1] + p[1] / 4], [0, 0]);
    return q.map(p => [ctr[0] + (p[0] - ctr[0]) * 0.97, ctr[1] + (p[1] - ctr[1]) * 0.97]);
  }
  function defaultQuad(cv) {
    const s = Math.min(cv.width, cv.height) * 0.5, cx = cv.width / 2, cy = cv.height / 2;
    return [[cx - s / 2, cy - s / 2], [cx + s / 2, cy - s / 2], [cx + s / 2, cy + s / 2], [cx - s / 2, cy + s / 2]];
  }
  // Perspective mapping of the unit square onto quad (tl, tr, br, bl).
  function solve(A, b) {
    const n = b.length;
    for (let i = 0; i < n; i++) {
      let p = i;
      for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
      [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]];
      if (Math.abs(A[i][i]) < 1e-12) return null;
      for (let r = 0; r < n; r++) if (r !== i) {
        const f = A[r][i] / A[i][i];
        for (let c = i; c < n; c++) A[r][c] -= f * A[i][c];
        b[r] -= f * b[i];
      }
    }
    return b.map((v, i) => v / A[i][i]);
  }
  // Least-squares homography from point pairs (>= 4) src -> dst.
  function homography(src, dst) {
    const A = [], b = [];
    src.forEach(([x, y], i) => {
      const [u, v] = dst[i];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    });
    if (A.length === 8) return solve(A, b);
    const AtA = Array.from({ length: 8 }, () => new Array(8).fill(0)), Atb = new Array(8).fill(0);
    A.forEach((row, r) => { for (let i = 0; i < 8; i++) { Atb[i] += row[i] * b[r]; for (let j = 0; j < 8; j++) AtA[i][j] += row[i] * row[j]; } });
    return solve(AtA, Atb);
  }
  function applyH(h, x, y) {
    const w = h[6] * x + h[7] * y + 1;
    return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
  }
  const UNIT = [[0, 0], [1, 0], [1, 1], [0, 1]];
  function quadPoint(q, u, v) {
    const h = homography(UNIT, q);
    if (!h) {
      const top = [q[0][0] + (q[1][0] - q[0][0]) * u, q[0][1] + (q[1][1] - q[0][1]) * u];
      const bot = [q[3][0] + (q[2][0] - q[3][0]) * u, q[3][1] + (q[2][1] - q[3][1]) * u];
      return [top[0] + (bot[0] - top[0]) * v, top[1] + (bot[1] - top[1]) * v];
    }
    return applyH(h, u, v);
  }

  // Find one cube face anywhere in an image: segment sticker-coloured regions, then fit
  // a 3x3 lattice to them (perspective-corrected). Prefers the face that looks most
  // square-on, biggest and most central. Returns {quad, score} in image pixels, or null.
  function detectFace(src, dbg) {
    const S = 220;
    const k = S / Math.max(src.width, src.height);
    const W = Math.max(16, Math.round(src.width * k)), H = Math.max(16, Math.round(src.height * k));
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(src, 0, 0, W, H);
    const d = cx.getImageData(0, 0, W, H).data;
    const N = W * H;
    // 1) every pixel gets a coarse cube-colour class by hue (or white), or none
    const cls = new Uint8Array(N).fill(255), mask = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const s = mx ? (mx - mn) / mx : 0, v = mx / 255;
      if (v > 0.5 && s < 0.2) { cls[i] = 0; continue; }
      if (s < 0.33 || v < 0.25) continue;
      let h;
      if (mx === r) h = ((g - b) / (mx - mn) + 6) % 6; else if (mx === g) h = (b - r) / (mx - mn) + 2; else h = (r - g) / (mx - mn) + 4;
      h *= 60;
      cls[i] = h < 11 || h >= 320 ? 1 : h < 40 ? 2 : h < 72 ? 3 : h < 170 ? 4 : h < 265 ? 5 : 255;
    }
    // 2) erode once so thin seams between same-coloured tiles split them apart
    const ero = new Uint8Array(N).fill(255);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x, c = cls[i];
      if (c !== 255 && cls[i - 1] === c && cls[i + 1] === c && cls[i - W] === c && cls[i + W] === c) ero[i] = c;
    }
    for (let i = 0; i < N; i++) mask[i] = ero[i] !== 255 ? 1 : 0;
    // 3) connected regions of one class
    const label = new Int32Array(N).fill(-1), comps = [];
    const queue = new Int32Array(N);
    for (let s0 = 0; s0 < N; s0++) {
      if (ero[s0] === 255 || label[s0] >= 0) continue;
      const id = comps.length, c = ero[s0];
      let qh = 0, qt = 0, n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, x0 = W, x1 = 0, y0 = H, y1 = 0;
      queue[qt++] = s0; label[s0] = id;
      while (qh < qt) {
        const p = queue[qh++];
        const x = p % W, y = (p - x) / W;
        n++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (x > 0 && ero[p - 1] === c && label[p - 1] < 0) { label[p - 1] = id; queue[qt++] = p - 1; }
        if (x < W - 1 && ero[p + 1] === c && label[p + 1] < 0) { label[p + 1] = id; queue[qt++] = p + 1; }
        if (y > 0 && ero[p - W] === c && label[p - W] < 0) { label[p - W] = id; queue[qt++] = p - W; }
        if (y < H - 1 && ero[p + W] === c && label[p + W] < 0) { label[p + W] = id; queue[qt++] = p + W; }
      }
      // shape from second moments (rotation-proof): a solid square has compact ~1, elong 1
      const mx = sx / n, my = sy / n;
      const va = sxx / n - mx * mx + 1 / 12, vb = syy / n - my * my + 1 / 12, vc = sxy / n - mx * my;
      const tr = va + vb, det = Math.max(1e-6, va * vb - vc * vc), disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
      const l1 = tr / 2 + disc, l2 = Math.max(1e-6, tr / 2 - disc);
      comps.push({ id, n, x: mx, y: my, w: x1 - x0 + 1, h: y1 - y0 + 1, compact: n / (12 * Math.sqrt(det)), elong: Math.sqrt(l1 / l2) });
    }
    const minA = N * 0.0012, maxA = N * 0.12;
    const good = new Uint8Array(comps.length);
    const cands = comps.filter(c => {
      const ok = c.n >= minA && c.n <= maxA && c.compact > 0.55 && c.elong < 3.2;
      if (ok) good[c.id] = 1;
      return ok;
    });
    if (dbg) Object.assign(dbg, { W, H, label, comps, good, mask });
    if (cands.length < 4) return null;
    const at = (x, y) => { const xi = Math.round(x), yi = Math.round(y); return xi < 0 || yi < 0 || xi >= W || yi >= H ? -2 : yi * W + xi; };
    const diag = Math.hypot(W, H);
    const lab = (x, y) => { const p = at(x, y); return p < 0 ? -2 : label[p]; };
    // Score a 3x3 lattice centered at c with steps u, v: every point should sit inside a
    // solid patch of one region; points just outside the face should mostly not.
    function score(c, u, v) {
      let s = 0;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const x = c[0] + i * u[0] + j * v[0], y = c[1] + i * u[1] + j * v[1];
        const l = lab(x, y);
        if (l === -2) return -Infinity;
        if (l < 0) { s -= 1.2; continue; }
        let same = 0;
        for (const [a, b] of [[0.22, 0], [-0.22, 0], [0, 0.22], [0, -0.22]]) if (lab(x + a * u[0] + b * v[0], y + a * u[1] + b * v[1]) === l) same++;
        s += 0.5 + 0.25 * same;
      }
      for (let t = -1; t <= 1; t++) for (const [i, j] of [[2, t], [-2, t], [t, 2], [t, -2]]) {
        const l = lab(c[0] + i * u[0] + j * v[0], c[1] + i * u[1] + j * v[1]);
        if (l >= 0 && good[l]) s -= 0.2;
      }
      const lu = Math.hypot(u[0], u[1]), lv = Math.hypot(v[0], v[1]);
      const cos = Math.abs(u[0] * v[0] + u[1] * v[1]) / (lu * lv);
      s += 1.0 * Math.min(lu, lv) / Math.max(lu, lv) + 1.0 * (1 - cos);        // square-on
      s += 0.8 * Math.min(1, Math.sqrt(lu * lv) * 4 / Math.min(W, H));         // bigger
      s += 0.8 * (1 - Math.hypot(c[0] - W / 2, c[1] - H / 2) / (diag / 2));   // central
      return s;
    }
    // Single stickers (compact, not merged with a same-coloured neighbour) give the spacing.
    const singles = cands.filter(c => c.compact > 0.7 && c.elong < 2.1)
      .sort((a, b) => b.n - a.n).slice(0, 40);
    let best = null;
    for (const a of singles) {
      const ra = Math.sqrt(a.n);
      // neighbours one step away, or two steps away (halved) when the tile between them merged
      const nbs = [];
      for (const b of singles) {
        if (b === a || b.n / a.n > 2.2 || a.n / b.n > 2.2) continue;
        const dd = Math.hypot(b.x - a.x, b.y - a.y);
        if (dd > 0.75 * ra && dd < 2.1 * ra) nbs.push({ x: b.x, y: b.y });
        else if (dd > 1.9 * ra && dd < 4.0 * ra) nbs.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      }
      // also allow steps measured across one sticker (two apart) when the neighbour merged away
      for (const b1 of nbs) for (const b2 of nbs) {
        if (b1 === b2) continue;
        const u = [b1.x - a.x, b1.y - a.y], v = [b2.x - a.x, b2.y - a.y];
        if (u[0] * v[1] - u[1] * v[0] <= 0) continue;   // keep the grid un-mirrored
        const lu = Math.hypot(u[0], u[1]), lv = Math.hypot(v[0], v[1]);
        if (Math.abs(u[0] * v[0] + u[1] * v[1]) / (lu * lv) > 0.6 || Math.min(lu, lv) / Math.max(lu, lv) < 0.45) continue;
        for (let oj = -1; oj <= 1; oj++) for (let oi = -1; oi <= 1; oi++) {
          const c = [a.x - oi * u[0] - oj * v[0], a.y - oi * u[1] - oj * v[1]];
          const sc = score(c, u, v);
          if (!best || sc > best.score) best = { score: sc, c, u, v };
        }
      }
    }
    if (dbg) dbg.best = best;
    if (!best || best.score < 10) return null;
    // refine: fit a homography to the centroids of the stickers the lattice landed on
    let h = null;
    const grid = (i, j) => h ? applyH(h, i, j) : [best.c[0] + i * best.u[0] + j * best.v[0], best.c[1] + i * best.u[1] + j * best.v[1]];
    const pitchA = Math.hypot(best.u[0], best.u[1]) * Math.hypot(best.v[0], best.v[1]);
    for (let it = 0; it < 2; it++) {
      const srcP = [], dstP = [];
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const [x, y] = grid(i, j);
        const p = at(x, y);
        if (p < 0) continue;
        const l = label[p];
        if (l < 0 || !good[l]) continue;
        const cp = comps[l];
        if (cp.n > pitchA * 1.3 || cp.n < pitchA * 0.2) continue;  // merged or partial region
        if (Math.hypot(cp.x - x, cp.y - y) > Math.sqrt(pitchA) * 0.45) continue;
        srcP.push([i, j]); dstP.push([cp.x, cp.y]);
      }
      if (srcP.length < 5) break;
      const hh = homography(srcP, dstP);
      if (!hh) break;
      h = hh;
    }
    let quad = [[-1.5, -1.5], [1.5, -1.5], [1.5, 1.5], [-1.5, 1.5]].map(([i, j]) => grid(i, j)).map(([x, y]) => [x / k, y / k]);
    // start the grid at the picture's top-left corner so it reads the way the picture looks
    let first = 0;
    quad.forEach((p, i) => { if (p[0] + p[1] < quad[first][0] + quad[first][1]) first = i; });
    quad = quad.slice(first).concat(quad.slice(0, first));
    return { quad, score: best.score };
  }

  // Robust average color of each of the 9 cells: four small patches per cell, placed
  // off-center so logos and center caps don't count, trimmed of glare and shadow.
  function sampleFace(cv, quad) {
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    const side = Math.hypot(quad[1][0] - quad[0][0], quad[1][1] - quad[0][1]) / 3;
    const rad = Math.max(1, Math.round(side * 0.09));
    const out = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
      // one trimmed average per patch, then keep the patches that agree with the most typical one
      const patches = [];
      for (const [du, dv] of [[-0.24, -0.24], [0.24, -0.24], [-0.24, 0.24], [0.24, 0.24], [0, 0]]) {
        const [x, y] = quadPoint(quad, (c + 0.5 + du) / 3, (r + 0.5 + dv) / 3);
        const x0 = Math.max(0, Math.round(x - rad)), y0 = Math.max(0, Math.round(y - rad));
        const w = Math.max(1, Math.min(cv.width - x0, rad * 2)), h = Math.max(1, Math.min(cv.height - y0, rad * 2));
        const d = ctx.getImageData(x0, y0, w, h).data;
        const px = [];
        for (let i = 0; i < d.length; i += 4) px.push([d[i], d[i + 1], d[i + 2]]);
        px.sort((p, q) => (p[0] + p[1] + p[2]) - (q[0] + q[1] + q[2]));
        const lo = Math.floor(px.length * 0.2), hi = Math.max(lo + 1, Math.ceil(px.length * 0.8));
        const acc = [0, 0, 0];
        for (let i = lo; i < hi; i++) for (let k = 0; k < 3; k++) acc[k] += px[i][k];
        const rgb = acc.map(v => v / (hi - lo));
        patches.push({ rgb, lab: rgb2lab(rgb) });
      }
      let med = patches[0], bestSum = Infinity;
      for (const p of patches) { const sum = patches.reduce((t, q) => t + dist(p.lab, q.lab), 0); if (sum < bestSum) { bestSum = sum; med = p; } }
      const agree = patches.filter(p => dist(p.lab, med.lab) < 18);
      out.push([0, 1, 2].map(k => agree.reduce((t, p) => t + p.rgb[k], 0) / agree.length));
    }
    return out;
  }

  function rgb2lab([r, g, b]) {
    const f = v => { v /= 255; return v > 0.04045 ? Math.pow((v + 0.055) / 1.055, 2.4) : v / 12.92; };
    const R = f(r), G = f(g), B = f(b);
    let x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
    let y = R * 0.2126 + G * 0.7152 + B * 0.0722;
    let z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
    const h = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
    x = h(x); y = h(y); z = h(z);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  }
  // Lightness matters less than hue under uneven lighting.
  function dist(a, b) { return Math.sqrt(0.35 * (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2); }

  // Hungarian algorithm, square cost matrix -> assignment row -> col.
  function hungarian(cost) {
    const n = cost.length, INF = 1e18;
    const u = new Array(n + 1).fill(0), v = new Array(n + 1).fill(0), p = new Array(n + 1).fill(0), way = new Array(n + 1).fill(0);
    for (let i = 1; i <= n; i++) {
      p[0] = i; let j0 = 0;
      const minv = new Array(n + 1).fill(INF), used = new Array(n + 1).fill(false);
      do {
        used[j0] = true;
        const i0 = p[j0]; let delta = INF, j1 = 0;
        for (let j = 1; j <= n; j++) if (!used[j]) {
          const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
          if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
          if (minv[j] < delta) { delta = minv[j]; j1 = j; }
        }
        for (let j = 0; j <= n; j++) if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
        j0 = j1;
      } while (p[j0] !== 0);
      do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
    }
    const ans = new Array(n);
    for (let j = 1; j <= n; j++) ans[p[j] - 1] = j - 1;
    return ans;
  }

  // Which color is each photo's center? samplesList: array of 9-sample arrays.
  function guessCenters(samplesList) {
    const labs = samplesList.map(s => rgb2lab(s[4]));
    const n = labs.length;
    if (n > 6) return labs.map(l => nearestDefault(l));
    const cost = [];
    for (let i = 0; i < 6; i++) cost.push(COLORS.map(c => i < n ? dist(labs[i], rgb2lab(DEFAULT_RGB[c])) : 0));
    const a = hungarian(cost);
    return labs.map((_, i) => COLORS[a[i]]);
  }
  function nearestDefault(l) {
    let best = null, bd = Infinity;
    for (const c of COLORS) { const d = dist(l, rgb2lab(DEFAULT_RGB[c])); if (d < bd) { bd = d; best = c; } }
    return best;
  }

  // faces: {color: samples[9]}. Uses each photo's own center as that color's reference,
  // then assigns exactly 9 stickers per color.
  function classify(faces) {
    const present = COLORS.filter(c => faces[c]);
    const refs = {};
    COLORS.forEach(c => {
      const own = faces[c] ? rgb2lab(faces[c][4]) : null;
      const def = rgb2lab(DEFAULT_RGB[c]);
      // white center often carries a logo: lean on the default for it
      refs[c] = own ? (c === 'W' ? own.map((v, k) => (v + def[k]) / 2) : own) : def;
    });
    const items = [];
    present.forEach(c => faces[c].forEach((s, i) => { if (i !== 4) items.push({ c, i, lab: rgb2lab(s) }); }));
    // at most 8 more stickers of each color; with a face missing, dummy rows soak up the slack
    const cols = [];
    COLORS.forEach(c => { for (let k = 0; k < 8; k++) cols.push(c); });
    const cost = items.map(it => cols.map(c => dist(it.lab, refs[c])));
    while (cost.length < cols.length) cost.push(cols.map(() => 0));
    const a = hungarian(cost);
    const out = {};
    present.forEach(c => { out[c] = new Array(9); out[c][4] = c; });
    items.forEach((it, k) => { out[it.c][it.i] = cols[a[k]]; });
    const doubt = {};
    items.forEach((it, k) => {
      const ds = COLORS.map(c => dist(it.lab, refs[c])).sort((x, y) => x - y);
      if (cols[a[k]] !== nearest(it.lab, refs) || ds[1] - ds[0] < 8) (doubt[it.c] = doubt[it.c] || []).push(it.i);
    });
    return { grids: out, doubt };
  }
  function nearest(l, refs) {
    let best = null, bd = Infinity;
    for (const c in refs) { const d = dist(l, refs[c]); if (d < bd) { bd = d; best = c; } }
    return best;
  }

  // Closest default color for an RGB sample, optionally limited to `allowed`.
  const DEFAULT_LAB = {};
  COLORS.forEach(c => { DEFAULT_LAB[c] = rgb2lab(DEFAULT_RGB[c]); });
  function nearestColor(rgb, allowed) {
    const l = rgb2lab(rgb);
    let best = null, bd = Infinity;
    for (const c of allowed || COLORS) { const d = dist(l, DEFAULT_LAB[c]); if (d < bd) { bd = d; best = c; } }
    return best;
  }
  function labDist(a, b) { return dist(rgb2lab(a), rgb2lab(b)); }

  root.Vision = { loadImage, autoQuad, detectFace, quadPoint, sampleFace, nearest: nearestColor, labDist, toLab: rgb2lab, labDistLab: dist, COLORS, DEFAULT_RGB };
})(typeof self !== 'undefined' ? self : this);
