// Cube model, moves, photo orientation and F2L / cross solvers.
// Facelet order: U R F D L B, 9 stickers each, row-major as seen from outside
// (U: back edge on top; D: front edge on top; side faces: U on top).
(function (root) {
  'use strict';

  const FACES = ['U', 'R', 'F', 'D', 'L', 'B'];
  const NORMALS = { U: [0, 1, 0], R: [1, 0, 0], F: [0, 0, 1], D: [0, -1, 0], L: [-1, 0, 0], B: [0, 0, -1] };
  const OPPOSITE = { U: 'D', D: 'U', R: 'L', L: 'R', F: 'B', B: 'F' };

  function stickerPos(face, r, c) {
    switch (face) {
      case 'U': return [c - 1, 1, r - 1];
      case 'D': return [c - 1, -1, 1 - r];
      case 'F': return [c - 1, 1 - r, 1];
      case 'B': return [1 - c, 1 - r, -1];
      case 'R': return [1, 1 - r, 1 - c];
      case 'L': return [-1, 1 - r, c - 1];
    }
  }

  const STICKERS = [];
  const KEY = {};
  const key = (p, n) => p.join(',') + '|' + n.join(',');
  FACES.forEach((f, fi) => {
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
      const p = stickerPos(f, r, c), n = NORMALS[f];
      const i = fi * 9 + r * 3 + c;
      STICKERS.push({ i, face: f, r, c, pos: p, n });
      KEY[key(p, n)] = i;
    }
  });

  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  // Clockwise quarter turn seen from the tip of axis a: rotate -90 degrees.
  function rotCW(v, a) {
    const c = cross(a, v), d = dot(a, v);
    return [-c[0] + a[0] * d, -c[1] + a[1] * d, -c[2] + a[2] * d];
  }

  // Base quarter-turn definitions: axis + which layers turn.
  const BASE = {};
  FACES.forEach(f => { BASE[f] = { axis: NORMALS[f], layer: d => d === 1 }; });
  BASE.M = { axis: NORMALS.L, layer: d => d === 0 };
  BASE.E = { axis: NORMALS.D, layer: d => d === 0 };
  BASE.S = { axis: NORMALS.F, layer: d => d === 0 };
  FACES.forEach(f => { BASE[f.toLowerCase()] = { axis: NORMALS[f], layer: d => d >= 0 }; });
  BASE.x = { axis: NORMALS.R, layer: () => true };
  BASE.y = { axis: NORMALS.U, layer: () => true };
  BASE.z = { axis: NORMALS.F, layer: () => true };

  // to[i] = where sticker i travels; from[j] = which old sticker lands on j.
  function quarterPerm(def) {
    const to = new Array(54);
    for (const s of STICKERS) {
      if (def.layer(dot(s.pos, def.axis))) to[s.i] = KEY[key(rotCW(s.pos, def.axis), rotCW(s.n, def.axis))];
      else to[s.i] = s.i;
    }
    return to;
  }
  function composeTo(a, b) { return a.map(j => b[j]); } // a then b
  const MOVES = {};
  for (const name in BASE) {
    const q = quarterPerm(BASE[name]);
    const q2 = composeTo(q, q), q3 = composeTo(q2, q);
    for (const [suffix, to] of [['', q], ['2', q2], ["'", q3]]) {
      const from = new Array(54);
      to.forEach((j, i) => { from[j] = i; });
      MOVES[name + suffix] = { name: name + suffix, base: name, amount: suffix === '' ? 1 : suffix === '2' ? 2 : -1, to, from, axis: BASE[name].axis, layer: BASE[name].layer };
    }
  }

  function applyMove(state, m) {
    const mv = typeof m === 'string' ? MOVES[m] : m;
    if (!mv) throw new Error('Unknown move ' + m);
    const out = new Array(54);
    for (let j = 0; j < 54; j++) out[j] = state[mv.from[j]];
    return out;
  }
  function parseAlg(s) {
    return (s || '').replace(/[()\[\]]/g, ' ').replace(/’/g, "'").split(/\s+/).filter(Boolean).map(t => {
      const m = t.replace(/2'|'2/, '2');
      if (!MOVES[m]) throw new Error('Unknown move "' + t + '"');
      return m;
    });
  }
  function applyAlg(state, alg) {
    const list = Array.isArray(alg) ? alg : parseAlg(alg);
    return list.reduce(applyMove, state);
  }
  function invertMove(m) {
    const mv = MOVES[m];
    return mv.base + (mv.amount === 2 ? '2' : mv.amount === 1 ? "'" : '');
  }
  function invertAlg(list) { return list.slice().reverse().map(invertMove); }

  // Cubies: groups of stickers sharing a position.
  const CUBIES = {};
  for (const s of STICKERS) {
    const k = s.pos.join(',');
    (CUBIES[k] = CUBIES[k] || { pos: s.pos, stickers: [] }).stickers.push(s.i);
  }
  const CUBIE_LIST = Object.values(CUBIES);
  const CORNERS = CUBIE_LIST.filter(c => c.stickers.length === 3);
  const EDGES = CUBIE_LIST.filter(c => c.stickers.length === 2);
  const CENTERS = CUBIE_LIST.filter(c => c.stickers.length === 1);
  const STICKER_CUBIE = new Array(54);
  CUBIE_LIST.forEach(c => c.stickers.forEach(i => { STICKER_CUBIE[i] = c; }));
  // Corner stickers in clockwise order when looking at the corner from outside.
  CORNERS.forEach(c => {
    const p = c.pos;
    const s = c.stickers.slice();
    // order by the right-handed cycle around the corner diagonal
    const [a, b, d] = s;
    const na = STICKERS[a].n, nb = STICKERS[b].n;
    const clockwise = dot(cross(na, nb), p) < 0; // a -> b is clockwise viewed from outside
    c.cw = clockwise ? [a, b, d] : [a, d, b];
  });
  const centerIndex = f => FACES.indexOf(f) * 9 + 4;
  const nameOfCubie = c => c.stickers.map(i => STICKERS[i].face).join('');

  // ---- Validation ----------------------------------------------------------
  // Returns {valid, bad:[sticker idx...], reason}. With `partial`, pieces holding an
  // unknown sticker ('?') are skipped and only the fully known pieces are checked.
  function validate(state, partial) {
    const centers = FACES.map(f => state[centerIndex(f)]);
    const result = { valid: false, bad: [], reason: '' };
    if (new Set(centers).size !== 6) { result.reason = 'Two faces have the same center color.'; return result; }
    const counts = {};
    state.forEach(c => { counts[c] = (counts[c] || 0) + 1; });
    const solved = solvedFromCenters(centers);
    const cornerIds = {}; CORNERS.forEach((c, k) => {
      const seq = c.cw.map(i => solved[i]);
      for (let t = 0; t < 3; t++) cornerIds[seq.slice(t).concat(seq.slice(0, t)).join('')] = { id: k, twist: t };
    });
    const edgeIds = {}; EDGES.forEach((e, k) => {
      const [a, b] = e.stickers.map(i => solved[i]);
      edgeIds[a + b] = { id: k, flip: 0 }; edgeIds[b + a] = { id: k, flip: 1 };
    });
    const cp = [], ep = []; let twist = 0, flip = 0;
    const seenC = {}, seenE = {};
    CORNERS.forEach(c => {
      if (partial && c.stickers.some(i => state[i] === '?')) return;
      const hit = cornerIds[c.cw.map(i => state[i]).join('')];
      if (!hit || seenC[hit.id]) { result.bad.push(...c.stickers); return; }
      seenC[hit.id] = 1; cp.push(hit.id); twist += hit.twist;
    });
    EDGES.forEach(e => {
      if (partial && e.stickers.some(i => state[i] === '?')) return;
      const hit = edgeIds[e.stickers.map(i => state[i]).join('')];
      if (!hit || seenE[hit.id]) { result.bad.push(...e.stickers); return; }
      seenE[hit.id] = 1; ep.push(hit.id); flip += hit.flip;
    });
    if (result.bad.length) { result.reason = 'Some pieces have impossible color combinations.'; return result; }
    if (partial) { result.valid = true; return result; }
    if (twist % 3) { result.reason = 'One corner is twisted.'; return result; }
    if (flip % 2) { result.reason = 'One edge is flipped.'; return result; }
    if (parity(cp) !== parity(ep)) { result.reason = 'Two pieces are swapped.'; return result; }
    result.valid = true;
    return result;
  }
  function parity(p) {
    let n = 0; const seen = [];
    for (let i = 0; i < p.length; i++) {
      if (seen[i]) continue;
      let j = i, len = 0;
      while (!seen[j]) { seen[j] = 1; j = p[j]; len++; }
      n += len - 1;
    }
    return n % 2;
  }
  function solvedFromCenters(centers) {
    const out = new Array(54);
    FACES.forEach((f, fi) => { for (let k = 0; k < 9; k++) out[fi * 9 + k] = centers[fi]; });
    return out;
  }

  // ---- Orientation from 6 photos ------------------------------------------
  // grids: {color: [9 colors as photographed]} keyed by center color.
  // Returns best {state, valid, rotations} trying every face layout and in-plane rotation.
  function rotateGrid(g, k) {
    let out = g.slice();
    for (let t = 0; t < k; t++) out = [6, 3, 0, 7, 4, 1, 8, 5, 2].map(i => out[i]);
    return out;
  }
  function permutations(arr) {
    if (arr.length <= 1) return [arr];
    const out = [];
    arr.forEach((x, i) => permutations(arr.slice(0, i).concat(arr.slice(i + 1))).forEach(p => out.push([x].concat(p))));
    return out;
  }
  // With five grids, the sixth face is deduced: every sticker on it belongs to a corner
  // or edge whose other stickers are visible. Returns {valid, state, ambiguous}.
  function orientFromPhotos(grids, layoutHint) {
    const colors = Object.keys(grids);
    const allColors = layoutHint ? layoutHint.slice() : colors;
    const missing = allColors.filter(c => !grids[c]);
    if (missing.length > 1 || colors.length < 5) return { valid: false, state: null, reason: 'Need at least five faces.' };
    const g = Object.assign({}, grids);
    if (missing.length) { const m = missing[0]; g[m] = ['?', '?', '?', '?', m, '?', '?', '?', '?']; }
    let layouts = [];
    if (layoutHint) layouts.push(layoutHint, mirrorLayout(layoutHint));
    else permutations(colors.slice(1)).forEach(p => layouts.push([colors[0]].concat(p)));
    let best = null;
    const found = [];
    for (const layout of layouts) {
      for (let code = 0; code < 4096; code++) {
        const state = new Array(54);
        let cc = code, skip = false;
        for (let f = 0; f < 6; f++) {
          const k = cc & 3; cc >>= 2;
          if (missing.length && layout[f] === missing[0] && k) { skip = true; break; } // unknown face: rotation is meaningless
          const gr = rotateGrid(g[layout[f]], k);
          for (let i = 0; i < 9; i++) state[f * 9 + i] = gr[i];
        }
        if (skip) continue;
        if (!missing.length) {
          const v = validate(state);
          const score = v.valid ? 1000 : -v.bad.length;
          if (!best || score > best.score) best = { score, state, valid: v.valid, layout, check: v };
          if (v.valid) return best;
          continue;
        }
        const v = validate(state, true);
        if (!best || -v.bad.length > best.score) best = { score: -v.bad.length, state: state.map((x, i) => x === '?' ? state[Math.floor(i / 9) * 9 + 4] : x), partial: state.slice(), valid: false, layout, check: v };
        if (!v.valid) continue;
        for (const full of completeUnknown(state)) {
          const key = full.join('');
          if (!found.some(f => f.key === key)) found.push({ key, state: full, layout });
          if (found.length > 1) return { valid: false, ambiguous: true, state: found[0].state, reason: 'The missing face could be filled in more than one way.' };
        }
      }
    }
    if (found.length === 1) return { valid: true, state: found[0].state, layout: found[0].layout, inferred: missing[0] };
    return best;
  }
  // A scan that almost fits: try recolouring one, then two, of the stickers on the pieces
  // that don't fit. Returns the repaired state only when exactly one repair works.
  function repair(result) {
    if (!result || !result.check) return null;
    const base = result.partial || result.state;
    const colors = Array.from(new Set(FACES.map(f => base[centerIndex(f)])));
    const bad = Array.from(new Set(result.check.bad)).filter(i => i % 9 !== 4 && base[i] !== '?');
    if (!bad.length || bad.length > 12) return null;
    const fits = st => st.includes('?') ? completeUnknown(st) : (validate(st).valid ? [st] : []);
    const found = new Map();
    const note = list => list.forEach(st => found.set(st.join(''), st));
    for (const i of bad) for (const c of colors) {
      if (c === base[i]) continue;
      const st = base.slice(); st[i] = c;
      if (st.includes('?') && !validate(st, true).valid) continue;
      note(fits(st));
    }
    if (!found.size) {
      for (let a = 0; a < bad.length; a++) for (let b = a + 1; b < bad.length; b++) for (const ca of colors) for (const cb of colors) {
        if (ca === base[bad[a]] || cb === base[bad[b]]) continue;
        const st = base.slice(); st[bad[a]] = ca; st[bad[b]] = cb;
        if (!validate(st, true).valid) continue;
        note(fits(st));
        if (found.size > 1) return null;
      }
    }
    return found.size === 1 ? Array.from(found.values())[0] : null;
  }

  // Every valid way to fill the '?' stickers of a state.
  function completeUnknown(state) {
    const centers = FACES.map(f => state[centerIndex(f)]);
    const solved = solvedFromCenters(centers);
    const cornerSeqs = [];
    CORNERS.forEach(c => { const q = c.cw.map(i => solved[i]); for (let t = 0; t < 3; t++) cornerSeqs.push(q.slice(t).concat(q.slice(0, t))); });
    const edgePairs = [];
    EDGES.forEach(e => { const [a, b] = e.stickers.map(i => solved[i]); edgePairs.push([a, b], [b, a]); });
    const out = state.slice();
    const choices = []; // [{idx, options}]
    for (const c of CORNERS) {
      const seq = c.cw.map(i => state[i]);
      if (!seq.includes('?')) continue;
      const hits = cornerSeqs.filter(q => q.every((x, k) => seq[k] === '?' || seq[k] === x));
      if (hits.length !== 1) return [];
      c.cw.forEach((i, k) => { out[i] = hits[0][k]; });
    }
    for (const e of EDGES) {
      const pr = e.stickers.map(i => state[i]);
      if (!pr.includes('?')) continue;
      const k = pr[0] === '?' ? 0 : 1;
      const opts = edgePairs.filter(q => q[1 - k] === pr[1 - k]).map(q => q[k]);
      choices.push({ idx: e.stickers[k], options: opts });
    }
    const results = [];
    (function rec(n) {
      if (results.length > 2) return;
      if (n === choices.length) { if (validate(out).valid) results.push(out.slice()); return; }
      for (const o of choices[n].options) { out[choices[n].idx] = o; rec(n + 1); }
    })(0);
    return results;
  }
  function mirrorLayout(l) { return [l[0], l[4], l[2], l[3], l[1], l[5]]; }

  // Re-orient a whole-cube state so `downColor` is on D and `frontColor` on F.
  function reorient(state, downColor, frontColor) {
    const rots = ['', 'x', 'x2', "x'", 'z', "z'"];
    for (const r of rots) {
      let s = r ? applyMove(state, r) : state;
      if (s[centerIndex('D')] !== downColor) continue;
      for (const y of ['', 'y', 'y2', "y'"]) {
        const t = y ? applyMove(s, y) : s;
        if (!frontColor || t[centerIndex('F')] === frontColor) return t;
      }
    }
    return state;
  }

  // ---- Piece tracking -------------------------------------------------------
  // Locate a piece by its color set; return the sticker index holding refColor.
  function locate(state, colorSet, refColor) {
    const want = colorSet.slice().sort().join('');
    const pool = colorSet.length === 3 ? CORNERS : EDGES;
    for (const c of pool) {
      if (c.stickers.map(i => state[i]).sort().join('') === want) return c.stickers.find(i => state[i] === refColor);
    }
    return -1;
  }
  const S = (f, r, c) => FACES.indexOf(f) * 9 + r * 3 + c;
  // Slots in the canonical frame (cross on D). Reference stickers: D sticker for corner, F/B sticker for edge.
  const SLOTS = {
    FR: { corner: S('D', 0, 2), cornerFaces: ['D', 'F', 'R'], edge: S('F', 1, 2), edgeFaces: ['F', 'R'], toFR: '' },
    FL: { corner: S('D', 0, 0), cornerFaces: ['D', 'F', 'L'], edge: S('F', 1, 0), edgeFaces: ['F', 'L'], toFR: "y'" },
    BR: { corner: S('D', 2, 2), cornerFaces: ['D', 'B', 'R'], edge: S('B', 1, 0), edgeFaces: ['B', 'R'], toFR: 'y' },
    BL: { corner: S('D', 2, 0), cornerFaces: ['D', 'B', 'L'], edge: S('B', 1, 2), edgeFaces: ['B', 'L'], toFR: 'y2' },
  };
  const CROSS = [
    { st: S('D', 0, 1), faces: ['D', 'F'] }, { st: S('D', 1, 2), faces: ['D', 'R'] },
    { st: S('D', 2, 1), faces: ['D', 'B'] }, { st: S('D', 1, 0), faces: ['D', 'L'] },
  ];
  const colorOf = (state, f) => state[centerIndex(f)];
  function trackCross(state) {
    return CROSS.map(e => locate(state, e.faces.map(f => colorOf(state, f)), colorOf(state, 'D')));
  }
  function trackSlot(state, slot) {
    const s = SLOTS[slot];
    return {
      corner: locate(state, s.cornerFaces.map(f => colorOf(state, f)), colorOf(state, 'D')),
      edge: locate(state, s.edgeFaces.map(f => colorOf(state, f)), colorOf(state, s.edgeFaces[0])),
    };
  }
  function crossSolved(state) { return trackCross(state).every((x, k) => x === CROSS[k].st); }
  function slotSolved(state, slot) {
    const t = trackSlot(state, slot);
    return t.corner === SLOTS[slot].corner && t.edge === SLOTS[slot].edge;
  }
  // Which slot does a tapped cubie belong to? Returns {slot} or {kind, message}.
  function slotForSticker(state, idx) {
    const cub = STICKER_CUBIE[idx];
    const cols = cub.stickers.map(i => state[i]);
    const D = colorOf(state, 'D'), U = colorOf(state, 'U');
    if (cub.stickers.length === 1) return { kind: 'center' };
    if (cub.stickers.length === 2 && cols.includes(D)) return { kind: 'cross' };
    if (cols.includes(U)) return { kind: 'last' };
    if (cub.stickers.length === 3 && !cols.includes(D)) return { kind: 'last' };
    const side = cols.filter(c => c !== D);
    for (const name in SLOTS) {
      const want = SLOTS[name].edgeFaces.map(f => colorOf(state, f)).sort().join('');
      if (side.slice().sort().join('') === want) return { slot: name };
    }
    return { kind: 'unknown' };
  }

  // ---- Search tables --------------------------------------------------------
  const EDGE_ST = [], CORNER_ST = [];
  EDGES.forEach(e => EDGE_ST.push(...e.stickers));
  CORNERS.forEach(c => CORNER_ST.push(...c.stickers));
  const EIDX = new Int16Array(54).fill(-1), CIDX = new Int16Array(54).fill(-1);
  EDGE_ST.forEach((s, k) => { EIDX[s] = k; });
  CORNER_ST.forEach((s, k) => { CIDX[s] = k; });

  const F2L_MOVES = ['U', "U'", 'U2', 'R', "R'", 'R2', 'F', "F'", 'F2', 'L', "L'", 'L2', 'B', "B'", 'B2'];
  const CROSS_MOVES = F2L_MOVES.concat(['D', "D'", 'D2']);
  function moveTables(names) {
    return names.map(n => {
      const to = MOVES[n].to;
      return { name: n, face: MOVES[n].base, e: Uint8Array.from(EDGE_ST, s => EIDX[to[s]]), c: Uint8Array.from(CORNER_ST, s => CIDX[to[s]]) };
    });
  }
  const MT_F2L = moveTables(F2L_MOVES);
  const MT_CROSS = moveTables(CROSS_MOVES);

  // Generic BFS over tuples of tracked indices (each 0..23). kinds: 'e' or 'c'.
  function buildTable(kinds, goal, mt) {
    const n = kinds.length, size = Math.pow(24, n);
    const table = new Int8Array(size).fill(-1);
    const enc = t => t.reduce((a, v) => a * 24 + v, 0);
    let frontier = new Uint32Array(1); frontier[0] = enc(goal);
    table[frontier[0]] = 0;
    const tup = new Array(n);
    let depth = 0;
    while (frontier.length) {
      const next = [];
      for (let q = 0; q < frontier.length; q++) {
        let x = frontier[q];
        for (let k = n - 1; k >= 0; k--) { tup[k] = x % 24; x = (x - tup[k]) / 24; }
        for (const m of mt) {
          let code = 0;
          for (let k = 0; k < n; k++) code = code * 24 + (kinds[k] === 'e' ? m.e[tup[k]] : m.c[tup[k]]);
          if (table[code] === -1) { table[code] = depth + 1; next.push(code); }
        }
      }
      frontier = Uint32Array.from(next);
      depth++;
    }
    return table;
  }

  let TABLES = null;
  function tables() {
    if (TABLES) return TABLES;
    const crossGoal = CROSS.map(e => EIDX[e.st]);
    const fr = SLOTS.FR;
    TABLES = {
      cross18: buildTable(['e', 'e', 'e', 'e'], crossGoal, MT_CROSS),
      // lower bounds counted over all 18 face turns, so they are valid for both the learner
      // search (no bottom turns) and the fewest-moves search (every face)
      crossC: buildTable(['e', 'e', 'e', 'e', 'c'], crossGoal.concat(CIDX[fr.corner]), MT_CROSS),
      crossE: buildTable(['e', 'e', 'e', 'e', 'e'], crossGoal.concat(EIDX[fr.edge]), MT_CROSS),
      pair: {},
    };
    for (const name in SLOTS) {
      TABLES.pair[name] = buildTable(['c', 'e'], [CIDX[SLOTS[name].corner], EIDX[SLOTS[name].edge]], MT_CROSS);
    }
    return TABLES;
  }

  // Ergonomic cost of a move in the FR frame (lower is friendlier).
  const COST = { U: 0.8, R: 1, F: 1.6, L: 2, B: 3.2, D: 2 };
  function algCost(list) {
    let c = 0;
    list.forEach((m, k) => {
      const mv = MOVES[m];
      c += COST[mv.base] + (mv.amount === 2 ? 0.3 : 0);
      if (k && MOVES[list[k - 1]].base !== mv.base && mv.base !== 'U' && MOVES[list[k - 1]].base !== 'U') c += 0.4; // regrip
    });
    // "side, top, side back" triggers are the shapes learners drill: favour solutions made of them
    for (let i = 0; i + 2 < list.length; i++) {
      const b = MOVES[list[i]].base;
      if (b === 'U' || 'xyz'.includes(b)) continue;
      if (MOVES[list[i + 1]].base === 'U' && list[i + 2] === invertMove(list[i])) { c -= TRIGGER_BONUS; i += 2; }
    }
    return c;
  }
  const TRIGGER_BONUS = 1.1;

  // IDA* collecting all solutions of the minimal length (and +extra).
  function idaSearch(start, mt, h, isGoal, apply, opts) {
    const maxDepth = opts.maxDepth || 14, extra = opts.extra == null ? 1 : opts.extra, limit = opts.limit || 400;
    const sols = [];
    let found = -1;
    const path = [];
    let nodes = 0;
    function dfs(st, g, bound, lastFace) {
      nodes++;
      const hv = h(st);
      if (g + hv > bound) return;
      if (hv === 0 && isGoal(st)) { if (g === bound) sols.push(path.slice()); return; }
      if (g === bound || sols.length >= limit) return;
      for (const m of mt) {
        if (m.face === lastFace) continue;
        path.push(m.name);
        dfs(apply(st, m), g + 1, bound, m.face);
        path.pop();
      }
    }
    for (let bound = h(start); bound <= maxDepth; bound++) {
      dfs(start, 0, bound, null);
      if (sols.length && found < 0) found = bound;
      if (found >= 0 && bound >= found + extra) break;
      if (nodes > (opts.nodeCap || 4e7)) break;
    }
    // drop redundant orders of commuting opposite moves (keep canonical: R before L, F before B)
    const seen = new Set();
    return { sols: sols.filter(s => { const k = s.join(' '); if (seen.has(k)) return false; seen.add(k); return !hasNonCanonical(s); }), optimal: found, nodes };
  }
  function hasNonCanonical(s) {
    for (let k = 1; k < s.length; k++) {
      const a = MOVES[s[k - 1]].base, b = MOVES[s[k]].base;
      if ((a === 'L' && b === 'R') || (a === 'B' && b === 'F') || (a === 'D' && b === 'U')) return true;
    }
    return false;
  }

  // Solve the FR pair for a state already in the canonical frame (cross on D).
  // keepSlots: other slots that are solved and must stay solved.
  function solveFRPair(state, opts) {
    opts = opts || {};
    const T = tables();
    const cr = trackCross(state).map(s => EIDX[s]);
    const t = trackSlot(state, 'FR');
    const keep = (opts.keep || []).filter(n => n !== 'FR');
    const keepT = keep.map(n => { const k = trackSlot(state, n); return [CIDX[k.corner], EIDX[k.edge]]; });
    // st layout: [e0,e1,e2,e3, corner, edge, k0c,k0e, k1c,k1e, ...]
    const start = cr.concat([CIDX[t.corner], EIDX[t.edge]]).concat(...keepT);
    const goal = CROSS.map(e => EIDX[e.st]).concat([CIDX[SLOTS.FR.corner], EIDX[SLOTS.FR.edge]]).concat(...keep.map(n => [CIDX[SLOTS[n].corner], EIDX[SLOTS[n].edge]]));
    const h = st => {
      const base = ((st[0] * 24 + st[1]) * 24 + st[2]) * 24 + st[3];
      let v = Math.max(T.crossC[base * 24 + st[4]], T.crossE[base * 24 + st[5]]);
      for (let k = 0; k < keep.length; k++) v = Math.max(v, T.pair[keep[k]][st[6 + 2 * k] * 24 + st[7 + 2 * k]]);
      return v;
    };
    const isGoal = st => st.every((v, i) => v === goal[i]);
    const apply = (st, m) => {
      const o = st.slice();
      for (let i = 0; i < 4; i++) o[i] = m.e[st[i]];
      o[4] = m.c[st[4]]; o[5] = m.e[st[5]];
      for (let k = 0; k < keep.length; k++) { o[6 + 2 * k] = m.c[st[6 + 2 * k]]; o[7 + 2 * k] = m.e[st[7 + 2 * k]]; }
      return o;
    };
    // opts.all: every face turn (true fewest moves); otherwise no bottom turns (the usual F2L hand)
    const r = idaSearch(start, opts.all ? MT_CROSS : MT_F2L, h, isGoal, apply, { extra: opts.extra == null ? 2 : opts.extra, limit: opts.all ? 200 : 600, maxDepth: 16 });
    return rank(r);
  }
  function rank(r) {
    const scored = r.sols.map(s => ({ moves: s, len: s.length, cost: algCost(s) + (s.length - r.optimal) * 0.8 }));
    scored.sort((a, b) => a.cost - b.cost || a.len - b.len);
    return { optimal: r.optimal, nodes: r.nodes, solutions: scored };
  }

  function solveCross(state) {
    const T = tables();
    const start = trackCross(state).map(s => EIDX[s]);
    const h = st => T.cross18[((st[0] * 24 + st[1]) * 24 + st[2]) * 24 + st[3]];
    const apply = (st, m) => st.map(v => m.e[v]);
    const r = idaSearch(start, MT_CROSS, h, st => h(st) === 0, apply, { extra: 1, limit: 300, maxDepth: 10 });
    return rank(r);
  }

  // Solve a pair in any slot. mode 'rotate': rotate the cube so the slot is front-right.
  // mode 'inplace': express the solution without rotating the cube.
  function solvePair(state, slot, mode) {
    const solvedSlots = Object.keys(SLOTS).filter(n => n !== slot && slotSolved(state, n));
    const pre = SLOTS[slot].toFR;
    const framed = pre ? applyMove(state, pre) : state;
    // Slot names of solved pairs in the rotated frame.
    const keep = solvedSlots.map(n => renameSlot(n, pre));
    const res = solveFRPair(framed, { keep });
    // the true minimum over every face turn, bottom turns included
    const fewest = solveFRPair(framed, { keep, all: true, extra: 0 });
    res.fewest = fewest.solutions[0] || null;
    res.fewestLen = fewest.optimal;
    if (mode === 'inplace' && pre) {
      res.solutions.forEach(s => { s.moves = s.moves.map(m => conjugate(m, pre)); s.cost = algCost(s.moves) + (s.len - res.optimal) * 0.8; });
      res.solutions.sort((a, b) => a.cost - b.cost || a.len - b.len);
      if (res.fewest) res.fewest = { ...res.fewest, moves: res.fewest.moves.map(m => conjugate(m, pre)) };
      res.rotation = '';
    } else res.rotation = pre;
    return res;
  }
  // Where does slot n end up after whole-cube rotation r?
  function renameSlot(n, r) {
    if (!r) return n;
    const st = SLOTS[n].corner, to = MOVES[r].to[st];
    for (const k in SLOTS) if (SLOTS[k].corner === to) return k;
    return n;
  }
  // A move written in the rotated frame, rewritten for the unrotated cube.
  function conjugate(m, r) {
    const mv = MOVES[m];
    if (mv.base === 'U' || mv.base === 'D') return m;
    // face in rotated frame -> original face: undo rotation r on the face normal.
    // move the face's center sticker back through the inverse rotation
    const back = MOVES[invertMove(r)].to[centerIndex(mv.base)];
    return STICKERS[back].face + m.slice(mv.base.length);
  }

  function nameMoves(list) { return list.join(' '); }

  const api = {
    FACES, NORMALS, STICKERS, MOVES, CORNERS, EDGES, CENTERS, STICKER_CUBIE, SLOTS, CROSS,
    applyMove, applyAlg, parseAlg, invertAlg, invertMove, validate, solvedFromCenters, orientFromPhotos, rotateGrid,
    reorient, trackCross, trackSlot, crossSolved, slotSolved, slotForSticker, solveCross, solvePair, tables,
    centerIndex, colorOf, algCost, nameMoves, nameOfCubie, locate, repair,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Cube = api;
})(typeof self !== 'undefined' ? self : this);
