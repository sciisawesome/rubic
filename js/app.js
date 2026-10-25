// F2L Pair Coach: scanning, 3D cube, pair picker and step-through player.
(function () {
  'use strict';

  const $ = s => document.querySelector(s);
  const HEX = { W: '#f3f3ef', Y: '#ffd60a', G: '#19b24b', B: '#1663e8', R: '#da1f2d', O: '#ff7b14' };
  const NAME = { W: 'white', Y: 'yellow', G: 'green', B: 'blue', R: 'red', O: 'orange' };
  const OPP = { W: 'Y', Y: 'W', G: 'B', B: 'G', R: 'O', O: 'R' };
  const STD_LAYOUT = ['Y', 'O', 'G', 'W', 'R', 'B']; // U R F D L B of a standard-scheme cube
  const FACE_WORD = { U: 'top', D: 'bottom', F: 'front', B: 'back', R: 'right', L: 'left' };
  const ACCENT = 0x4f46e5;
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const chip = c => `<span class="chip" style="background:${HEX[c]}"></span>`;
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ---------- storage (per-device convenience only) ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem('f2lcoach.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('f2lcoach.' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };

  let toastTimer;
  function toast(msg, ms) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, ms || 2600);
  }

  // ---------- solver (web worker with main-thread fallback) ----------
  const Solver = (() => {
    let worker = null, seq = 0;
    const pending = new Map();
    function local(msg) {
      if (msg.op === 'warm') { Cube.tables(); return { ok: true }; }
      const r = msg.op === 'cross' ? Cube.solveCross(msg.state) : Cube.solvePair(msg.state, msg.slot, msg.mode);
      r.solutions = r.solutions.slice(0, 6);
      return r;
    }
    try {
      worker = new Worker(window.SOLVER_WORKER_URL || 'js/solver-worker.js');
      worker.onmessage = e => { const p = pending.get(e.data.id); if (p) { pending.delete(e.data.id); p.resolve(e.data); } };
      worker.onerror = ev => {
        ev.preventDefault && ev.preventDefault();
        worker = null;
        for (const [, p] of pending) p.resolve(local(p.msg));
        pending.clear();
      };
    } catch (e) { worker = null; }
    function call(msg) {
      if (!worker) return new Promise(res => setTimeout(() => res(local(msg)), 0));
      return new Promise(resolve => { const id = ++seq; pending.set(id, { resolve, msg }); worker.postMessage(Object.assign({ id }, msg)); });
    }
    return { call };
  })();

  // ---------- 3D cube ----------
  function roundedRect(w, r) {
    const s = new THREE.Shape(), h = w / 2;
    s.moveTo(-h + r, -h); s.lineTo(h - r, -h); s.quadraticCurveTo(h, -h, h, -h + r);
    s.lineTo(h, h - r); s.quadraticCurveTo(h, h, h - r, h); s.lineTo(-h + r, h);
    s.quadraticCurveTo(-h, h, -h, h - r); s.lineTo(-h, -h + r); s.quadraticCurveTo(-h, -h, -h + r, -h);
    return new THREE.ShapeGeometry(s, 6);
  }
  const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

  class Cube3D {
    constructor(host, onTap) {
      this.host = host; this.onTap = onTap;
      const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      host.prepend(r.domElement);
      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
      this.scene.add(new THREE.AmbientLight(0xffffff, 0.74));
      const d1 = new THREE.DirectionalLight(0xffffff, 0.38); d1.position.set(3, 7, 5); this.scene.add(d1);
      const d2 = new THREE.DirectionalLight(0xffffff, 0.14); d2.position.set(-5, -3, -2); this.scene.add(d2);
      this.root = new THREE.Group(); this.scene.add(this.root);
      this.HOME = { theta: 0.62, phi: 0.98 };
      this.view = { theta: this.HOME.theta, phi: this.HOME.phi };
      this.pad = 0; this.dist = 12;
      this.cubies = []; this.stickers = [];
      this.anims = []; this.dirty = true; this.arrow = null;
      this.buildShadow();
      const bodyMat = new THREE.MeshStandardMaterial({ color: 0x17191f, roughness: 0.55, metalness: 0.05 });
      const bodyGeo = new THREE.BoxGeometry(0.97, 0.97, 0.97);
      const stGeo = roundedRect(0.86, 0.13);
      for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
        if (!x && !y && !z) continue;
        const g = new THREE.Group();
        const home = new THREE.Vector3(x, y, z);
        g.position.copy(home);
        g.add(new THREE.Mesh(bodyGeo, bodyMat));
        Cube.STICKERS.forEach(s => {
          if (s.pos[0] !== x || s.pos[1] !== y || s.pos[2] !== z) return;
          const m = new THREE.Mesh(stGeo, new THREE.MeshLambertMaterial({ color: 0xcccccc }));
          const n = new THREE.Vector3(...s.n);
          m.position.copy(n.clone().multiplyScalar(0.487));
          m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
          m.userData.idx = s.i;
          g.add(m); this.stickers[s.i] = m;
        });
        this.root.add(g);
        this.cubies.push({ obj: g, home });
      }
      this.raycaster = new THREE.Raycaster();
      this.bindPointer();
      new ResizeObserver(() => this.resize()).observe(host);
      this.resize();
      const loop = now => { this.tick(now); requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
    }
    buildShadow() {
      const cv = document.createElement('canvas'); cv.width = cv.height = 128;
      const x = cv.getContext('2d');
      const g = x.createRadialGradient(64, 64, 4, 64, 64, 62);
      g.addColorStop(0, 'rgba(17,19,24,0.22)'); g.addColorStop(1, 'rgba(17,19,24,0)');
      x.fillStyle = g; x.fillRect(0, 0, 128, 128);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 5.2), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.position.y = -2.3;
      this.scene.add(m);
    }
    setPad(px) { this.pad = px; this.resize(); }
    resize() {
      const w = this.host.clientWidth, h = this.host.clientHeight;
      if (!w || !h) return;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      const top = 44, pad = Math.min(this.pad, h * 0.6);
      const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
      const R = 2.6;
      const fitV = tanV * (h - pad - top) / h, fitH = tanV * (w - 16) / h;
      this.dist = R / Math.min(fitV, fitH) + 0.4;
      this.camera.setViewOffset(w, h, 0, (pad - top) / 2, w, h);
      this.camera.updateProjectionMatrix();
      this.dirty = true;
    }
    placeCamera() {
      const { theta, phi } = this.view, d = this.dist;
      this.camera.position.set(d * Math.sin(phi) * Math.sin(theta), d * Math.cos(phi), d * Math.sin(phi) * Math.cos(theta));
      this.camera.lookAt(0, 0, 0);
    }
    tick(now) {
      if (this.anims.length) {
        this.anims = this.anims.filter(a => {
          const t = Math.min(1, (now - (a.start == null ? (a.start = now) : a.start)) / a.ms);
          a.step(ease(t));
          if (t >= 1) { a.done(); return false; }
          return true;
        });
        this.dirty = true;
      }
      if (this.dirty) { this.placeCamera(); this.renderer.render(this.scene, this.camera); this.dirty = false; }
    }
    animate(ms, step) {
      return new Promise(done => {
        if (ms <= 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { step(1); this.dirty = true; done(); return; }
        this.anims.push({ ms, step, done });
      });
    }
    // Paint stickers from a 54-color state; `focus` is a set of sorted color keys to keep bright.
    setState(state, focus) {
      const dimTo = new THREE.Color('#eceef2');
      for (const c of this.cubies) {
        const meshes = c.obj.children.filter(m => m.userData.idx != null);
        const key = meshes.map(m => state[m.userData.idx]).sort().join('');
        const isCenter = meshes.length === 1;
        const dim = focus && !focus.has(key);
        for (const m of meshes) {
          const col = new THREE.Color(HEX[state[m.userData.idx]]);
          if (dim) col.lerp(dimTo, isCenter ? 0.5 : 0.86);
          m.material.color.copy(col);
        }
      }
      this.dirty = true;
    }
    turn(move, ms, after) {
      const mv = Cube.MOVES[move];
      const axis = new THREE.Vector3(...mv.axis);
      const pivot = new THREE.Group(); this.root.add(pivot);
      const moving = this.cubies.filter(c => mv.layer(Math.round(c.home.dot(axis))));
      moving.forEach(c => pivot.attach(c.obj));
      const total = -Math.PI / 2 * (mv.amount === 2 ? 2 : mv.amount);
      return this.animate(mv.amount === 2 ? ms * 1.35 : ms, e => pivot.setRotationFromAxisAngle(axis, total * e)).then(() => {
        moving.forEach(c => { this.root.attach(c.obj); c.obj.position.copy(c.home); c.obj.quaternion.identity(); });
        this.root.remove(pivot);
        if (after) after();
        this.dirty = true;
      });
    }
    lookFrom(theta, phi, ms) {
      const a = { ...this.view };
      let dt = theta - a.theta;
      dt = Math.atan2(Math.sin(dt), Math.cos(dt));
      return this.animate(ms, e => { this.view.theta = a.theta + dt * e; this.view.phi = a.phi + (phi - a.phi) * e; });
    }
    spinIn() {
      const end = { ...this.HOME };
      this.view = { theta: end.theta - Math.PI * 1.25, phi: 0.7 };
      return this.animate(1300, e => { this.view.theta = end.theta - Math.PI * 1.25 * (1 - e); this.view.phi = 0.7 + (end.phi - 0.7) * e; });
    }
    faceVisible(face) {
      const n = new THREE.Vector3(...Cube.NORMALS[face]);
      return n.dot(this.camera.position.clone().normalize()) > 0.25;
    }
    showArrow(move) {
      this.clearArrow();
      if (!move) return;
      const mv = Cube.MOVES[move];
      const isRot = 'xyz'.includes(mv.base);
      const radius = isRot ? 2.3 : 0.92, tube = isRot ? 0.06 : 0.06;
      const arc = mv.amount === 2 ? Math.PI * 1.7 : Math.PI * 1.35;
      const mat = new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.95 });
      const outer = new THREE.Group(), inner = new THREE.Group();
      inner.add(new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 10, 64, arc), mat));
      const cw = mv.amount !== -1;
      const heads = mv.amount === 2 ? [0, arc / 2] : [cw ? 0 : arc];
      if (!cw && mv.amount === 2) heads.length = 0;
      heads.forEach(a => {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(isRot ? 0.2 : 0.17, isRot ? 0.44 : 0.38, 20), mat);
        const dir = cw ? new THREE.Vector3(Math.sin(a), -Math.cos(a), 0) : new THREE.Vector3(-Math.sin(a), Math.cos(a), 0);
        cone.position.set(radius * Math.cos(a), radius * Math.sin(a), 0).add(dir.clone().multiplyScalar(0.12));
        cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        inner.add(cone);
      });
      inner.rotation.z = Math.PI * 0.32;
      outer.add(inner);
      const ax = new THREE.Vector3(...mv.axis);
      outer.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), ax);
      if (!isRot) outer.position.copy(ax.clone().multiplyScalar(1.6));
      this.scene.add(outer);
      this.arrow = outer;
      this.dirty = true;
    }
    clearArrow() {
      if (this.arrow) { this.scene.remove(this.arrow); this.arrow = null; this.dirty = true; }
    }
    bindPointer() {
      const el = this.renderer.domElement;
      let down = null;
      el.addEventListener('pointerdown', e => {
        down = { x: e.clientX, y: e.clientY, t: this.view.theta, p: this.view.phi, moved: false };
        el.setPointerCapture(e.pointerId);
      });
      el.addEventListener('pointermove', e => {
        if (!down) return;
        const dx = e.clientX - down.x, dy = e.clientY - down.y;
        if (Math.hypot(dx, dy) > 6) down.moved = true;
        if (!down.moved) return;
        this.view.theta = down.t - dx * 0.011;
        this.view.phi = Math.min(Math.PI - 0.25, Math.max(0.25, down.p - dy * 0.011));
        this.userMoved = true;
        this.dirty = true;
      });
      const up = e => {
        if (!down) return;
        if (!down.moved && e.type === 'pointerup') this.pick(e);
        down = null;
      };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    }
    pick(e) {
      const rect = this.renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      this.raycaster.setFromCamera(ndc, this.camera);
      const hit = this.raycaster.intersectObjects(this.stickers, false)[0];
      if (hit && this.onTap) this.onTap(hit.object.userData.idx);
    }
  }

  // ---------- app state ----------
  const S = {
    cube: null, crossColor: 'W', mode: 'cube', // white cross on the bottom, yellow on top
    flow: null, busy: false, playing: false, history: [],
    pairs: {}, pairsVersion: 0,
    settings: Object.assign({ rotate: true, follow: true, speed: 450 }, store.get('settings', {})),
  };
  let view3d;

  // One screen: the stage shows the camera while scanning and the cube otherwise.
  function setMode(mode) {
    S.mode = mode;
    const scanning = mode === 'scan';
    $('#stage').classList.toggle('scanning', scanning);
    $('#scanner').hidden = !scanning;
    $('#cube-ui').hidden = scanning;
    $('#scan-panel').hidden = !scanning;
    ['#pairs-card', '#sync-card', '#settings-card'].forEach(id => { $(id).hidden = scanning; });
    $('#btn-newscan').hidden = scanning;
    $('#btn-cancelscan').hidden = !scanning || !S.cube;
    if (scanning) {
      $('#cross-card').hidden = true; $('#flow-card').hidden = true;
      stopPlay();
      Scan.enter();
    } else {
      Scan.stopCamera();
    }
    window.scrollTo(0, 0);
  }

  // ---------- helpers on the cube ----------
  const D_COLOR = st => st[Cube.centerIndex('D')];
  const sameVec = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
  function slotOfPair(st, pair) {
    const want = pair.slice().sort().join('');
    for (const name in Cube.SLOTS) {
      const cols = Cube.SLOTS[name].edgeFaces.map(f => Cube.colorOf(st, f)).sort().join('');
      if (cols === want) return name;
    }
    return null;
  }
  function slotWords(pos) { return (pos[2] > 0 ? 'front' : 'back') + '-' + (pos[0] > 0 ? 'right' : 'left'); }
  const SLOT_WORD = { FR: 'front-right', FL: 'front-left', BR: 'back-right', BL: 'back-left' };
  function pairState(st, pair) {
    const D = D_COLOR(st);
    const ci = Cube.locate(st, [D, pair[0], pair[1]], D), ei = Cube.locate(st, pair, pair[0]);
    if (ci < 0 || ei < 0) return null;
    const cc = Cube.STICKER_CUBIE[ci], ec = Cube.STICKER_CUBIE[ei];
    const d = Math.abs(cc.pos[0] - ec.pos[0]) + Math.abs(cc.pos[1] - ec.pos[1]) + Math.abs(cc.pos[2] - ec.pos[2]);
    const paired = d === 1 && ec.stickers.every(es => {
      const cs = cc.stickers.find(c => sameVec(Cube.STICKERS[c].n, Cube.STICKERS[es].n));
      return cs != null && st[cs] === st[es];
    });
    const slot = slotOfPair(st, pair);
    return { ci, ei, cc, ec, paired, solved: !!slot && Cube.slotSolved(st, slot), slot };
  }
  function describeCase(st, pair) {
    const p = pairState(st, pair);
    if (!p) return [];
    const D = D_COLOR(st), cs = Cube.STICKERS[p.ci];
    const face = cs.face === 'U' ? 'up' : cs.face === 'D' ? 'down' : 'to the ' + FACE_WORD[cs.face];
    const cornerWhere = p.cc.pos[1] === 1 ? 'top layer' : 'bottom layer, in the ' + slotWords(p.cc.pos) + ' slot';
    let edgeWhere;
    if (p.ec.pos[1] === 1) edgeWhere = 'top layer';
    else {
      const own = p.slot && sameVec(p.ec.pos, Cube.STICKER_CUBIE[Cube.SLOTS[p.slot].edge].pos);
      edgeWhere = own ? (p.ei === Cube.SLOTS[p.slot].edge ? 'in its slot, correct' : 'in its slot, flipped') : 'middle layer, in the ' + slotWords(p.ec.pos) + ' slot';
    }
    return [
      `<div><b>Corner</b> · ${cornerWhere}, ${NAME[D]} facing ${face}</div>`,
      `<div><b>Edge</b> · ${edgeWhere}</div>`,
      p.paired ? '<div style="color:var(--good)"><b>Already paired</b> · just insert it</div>' : '',
    ];
  }
  function moveText(m) {
    const mv = Cube.MOVES[m], f = mv.base, a = mv.amount;
    if (f === 'y') return a === 2 ? 'Turn the whole cube around: the back comes to the front' : a === 1 ? 'Turn the whole cube: the right side comes to the front' : 'Turn the whole cube: the left side comes to the front';
    if (f === 'x') return a === 2 ? 'Flip the whole cube forward twice' : a === 1 ? 'Tilt the whole cube: the front goes up' : 'Tilt the whole cube: the top comes to the front';
    if (f === 'z') return a === 2 ? 'Roll the whole cube half a turn' : a === 1 ? 'Roll the whole cube to the right' : 'Roll the whole cube to the left';
    const words = {
      R: ['Right face up', 'Right face down'], L: ['Left face down', 'Left face up'],
      U: ['Top layer to the left', 'Top layer to the right'], D: ['Bottom layer to the right', 'Bottom layer to the left'],
      F: ['Front face clockwise', 'Front face counter-clockwise'], B: ['Back face: top row slides left', 'Back face: top row slides right'],
    };
    if (a === 2) return cap(FACE_WORD[f]) + (f === 'U' || f === 'D' ? ' layer' : ' face') + ', half turn';
    return words[f][a === 1 ? 0 : 1];
  }
  function groupMoves(moves) {
    const out = [];
    let i = 0;
    while (i < moves.length) {
      const a = Cube.MOVES[moves[i]].base;
      if (i + 2 < moves.length && !'Uxyz'.includes(a) && Cube.MOVES[moves[i + 1]].base === 'U' && moves[i + 2] === Cube.invertMove(moves[i])) { out.push([i, i + 1, i + 2]); i += 3; }
      else { out.push([i]); i++; }
    }
    return out;
  }

  function holdLine() {
    const st = S.cube;
    const U = Cube.colorOf(st, 'U'), F = Cube.colorOf(st, 'F');
    $('#hold').innerHTML = `${chip(U)} ${cap(NAME[U])} on top · ${chip(F)} ${NAME[F]} facing you`;
  }
  function focusFor(flow) {
    if (!flow) return null;
    return new Set(flow.focus);
  }
  function paint() {
    view3d.setState(S.cube, focusFor(S.flow));
    holdLine();
  }
  function saveCube() { store.set('cube', S.cube.join('')); }

  // ---------- pairs list ----------
  function pairKeyColors(st, slot) { return Cube.SLOTS[slot].edgeFaces.map(f => Cube.colorOf(st, f)); }
  async function refreshPairs() {
    if (S.mode !== 'cube' || !S.cube) return;
    const st = S.cube, v = ++S.pairsVersion;
    const crossOk = Cube.crossSolved(st);
    $('#cross-card').hidden = crossOk;
    const order = ['FL', 'FR', 'BL', 'BR'];
    const list = order.map(slot => {
      const pair = pairKeyColors(st, slot);
      return { slot, pair, key: pair.slice().sort().join(''), solved: Cube.slotSolved(st, slot), len: null };
    });
    S.pairs = {};
    list.forEach(p => { S.pairs[p.key] = p; });
    renderPairs(list, crossOk);
    if (!crossOk) {
      $('#cross-text').innerHTML = `${chip(D_COLOR(st))} ${cap(NAME[D_COLOR(st)])} cross: ${Cube.trackCross(st).filter((x, k) => x === Cube.CROSS[k].st).length} of 4 edges placed. <span class="spin"></span>`;
      const r = await Solver.call({ op: 'cross', state: st });
      if (v !== S.pairsVersion) return;
      $('#cross-text').innerHTML = `${chip(D_COLOR(st))} ${cap(NAME[D_COLOR(st)])} cross isn't finished. It takes <b>${r.optimal} moves</b>. Do it first, then the pairs unlock.`;
      return;
    }
    for (const p of list) {
      if (p.solved) continue;
      const r = await Solver.call({ op: 'pair', state: st, slot: p.slot, mode: S.settings.rotate ? 'rotate' : 'inplace' });
      if (v !== S.pairsVersion) return;
      p.len = r.solutions && r.solutions.length ? r.solutions[0].len : r.optimal;
      renderPairs(list, crossOk);
    }
  }
  function renderPairs(list, crossOk) {
    const host = $('#pairs');
    const open = list.filter(p => !p.solved && p.len != null);
    const best = open.length ? Math.min(...open.map(p => p.len)) : null;
    const done = list.filter(p => p.solved).length;
    $('#pairs-status').textContent = `${done} of 4 solved`;
    host.innerHTML = '';
    list.forEach(p => {
      const b = document.createElement('button');
      b.className = 'pair' + (p.solved ? ' solved' : '');
      b.setAttribute('aria-pressed', String(!!S.flow && S.flow.key === p.key));
      const meta = p.solved ? 'Solved ✓' : !crossOk ? 'After cross' : p.len == null ? '…' : `${p.len} moves`;
      b.innerHTML = `<span class="pc">${chip(p.pair[0])}${chip(p.pair[1])}<span class="nm" style="margin-left:4px">${cap(NAME[p.pair[0]])}–${NAME[p.pair[1]]}</span></span>
        <span class="meta"><span>${SLOT_WORD[p.slot]}</span>${p.solved || p.len == null ? `<span>${meta}</span>` : `<b>${meta}</b>`}</span>` + (!p.solved && p.len != null && p.len === best && open.length > 1 ? '<span><span class="badge">Fastest</span></span>' : '');
      b.disabled = !crossOk && !p.solved;
      b.addEventListener('click', () => { if (!p.solved) startPair(p.pair); else toast('That pair is already in place.'); });
      host.appendChild(b);
    });
  }

  // ---------- flows ----------
  async function startPair(pair) {
    if (S.busy) return;
    stopPlay();
    const st = S.cube, slot = slotOfPair(st, pair);
    if (!slot) return;
    if (!Cube.crossSolved(st)) { toast('Finish the cross first.'); return; }
    const D = D_COLOR(st);
    const flow = S.flow = {
      kind: 'pair', key: pair.slice().sort().join(''), pair, slot,
      title: `${chip(pair[0])}${chip(pair[1])} ${cap(NAME[pair[0]])}–${NAME[pair[1]]} pair`,
      focus: [[D, pair[0], pair[1]].sort().join(''), pair.slice().sort().join('')],
      start: st, solutions: null, loading: true,
    };
    renderFlow(); paint(); renderPairsPressed();
    const r = await Solver.call({ op: 'pair', state: st, slot, mode: S.settings.rotate ? 'rotate' : 'inplace' });
    if (S.flow !== flow) return;
    flow.loading = false;
    if (!r.solutions || !r.solutions.length) { toast('No solution found for this pair. Check the colors.'); closeFlow(); return; }
    flow.rotation = r.rotation || '';
    flow.solutions = r.solutions;
    selectSolution(0);
  }
  async function startCross() {
    if (S.busy) return;
    stopPlay();
    const st = S.cube, D = D_COLOR(st);
    const flow = S.flow = {
      kind: 'cross', key: 'cross', title: `${chip(D)} ${cap(NAME[D])} cross`,
      focus: Cube.CROSS.map(e => e.faces.map(f => Cube.colorOf(st, f)).sort().join('')),
      start: st, solutions: null, loading: true, rotation: '',
    };
    renderFlow(); paint();
    const r = await Solver.call({ op: 'cross', state: st });
    if (S.flow !== flow) return;
    flow.loading = false; flow.solutions = r.solutions;
    selectSolution(0);
  }
  function selectSolution(i) {
    const f = S.flow;
    f.sel = i;
    f.moves = (f.rotation ? [f.rotation] : []).concat(f.solutions[i].moves);
    f.states = [f.start];
    f.moves.forEach(m => f.states.push(Cube.applyMove(f.states[f.states.length - 1], m)));
    if (f.idx) toast('Back to the start of this pair');
    f.idx = 0;
    S.cube = f.start; saveCube();
    paint(); renderFlow(); afterStep();
  }
  function closeFlow() {
    stopPlay();
    S.flow = null;
    view3d.clearArrow();
    paint(); renderFlow(); renderPairsPressed();
    refreshPairs();
  }
  function renderPairsPressed() {
    document.querySelectorAll('#pairs .pair').forEach(b => { b.setAttribute('aria-pressed', 'false'); });
    if (!S.flow) return;
    const p = S.pairs[S.flow.key];
    if (!p) return;
    const idx = ['FL', 'FR', 'BL', 'BR'].indexOf(p.slot);
    const b = document.querySelectorAll('#pairs .pair')[idx];
    if (b) b.setAttribute('aria-pressed', 'true');
  }
  function renderFlow() {
    const f = S.flow;
    $('#flow-card').hidden = !f;
    $('#player').hidden = !f;
    $('#tap-hint').hidden = !!f;
    $('#stage').classList.toggle('flowing', !!f);
    view3d.setPad(f ? $('#player').offsetHeight + 16 : 48);
    if (!f) return;
    $('#flow-title').innerHTML = f.title;
    if (f.loading) {
      $('#flow-case').innerHTML = '<div class="muted"><span class="spin"></span> Finding the shortest ways to solve it…</div>';
      $('#opts').innerHTML = ''; $('#strip').innerHTML = '';
      $('#cap-move').textContent = '…'; $('#cap-move').className = ''; $('#cap-text').textContent = 'Finding the shortest solutions'; $('#cap-note').textContent = ''; $('#cap-count').textContent = '';
      setControls();
      return;
    }
    // case summary is read in the frame the solution is played in
    const caseState = f.rotation ? Cube.applyMove(f.start, f.rotation) : f.start;
    if (f.kind === 'pair') {
      const lines = describeCase(caseState, f.pair);
      const where = f.rotation ? `<div><b>Slot</b> · ${SLOT_WORD[f.slot]} → turn the cube (<span class="alg">${f.rotation}</span>) so it's front-right</div>` : `<div><b>Slot</b> · ${SLOT_WORD[f.slot]}</div>`;
      $('#flow-case').innerHTML = where + lines.join('');
    } else {
      $('#flow-case').innerHTML = `<div>Edges already placed: ${Cube.trackCross(f.start).filter((x, k) => x === Cube.CROSS[k].st).length} of 4</div>`;
    }
    const sols = f.solutions;
    const shortest = sols.reduce((a, x) => (x.len < a.len ? x : a), sols[0]);
    let shown = sols.slice(0, 3);
    if (!shown.includes(shortest)) shown = [sols[0], sols[1], shortest];
    $('#opts').innerHTML = '';
    shown.forEach(s => {
      const i = sols.indexOf(s);
      const b = document.createElement('button');
      b.className = 'opt';
      b.setAttribute('aria-pressed', String(i === f.sel));
      const tag = i === 0 ? 'Recommended' : s === shortest && s.len < sols[0].len ? 'Shortest' : s.len === shortest.len ? 'Also shortest' : 'Alternative';
      b.innerHTML = `<span class="n">${s.len} moves<br>${tag}</span><span class="alg">${s.moves.join(' ')}</span>`;
      b.addEventListener('click', () => { if (!S.busy && f.sel !== i) { stopPlay(); selectSolution(i); } });
      $('#opts').appendChild(b);
    });
    renderStrip();
    setControls();
  }
  function renderStrip() {
    const f = S.flow, host = $('#strip');
    host.innerHTML = '';
    const rotOffset = f.rotation ? 1 : 0;
    if (f.rotation) host.appendChild(moveChip(0, true));
    const body = f.moves.slice(rotOffset);
    groupMoves(body).forEach(g => {
      if (g.length === 1) host.appendChild(moveChip(g[0] + rotOffset));
      else {
        const span = document.createElement('span'); span.className = 'grp';
        g.forEach(k => span.appendChild(moveChip(k + rotOffset)));
        host.appendChild(span);
      }
    });
  }
  function moveChip(k, rot) {
    const f = S.flow;
    const b = document.createElement('button');
    b.className = 'mv' + (rot ? ' rot' : '') + (k < f.idx ? ' done' : k === f.idx ? ' now' : '');
    b.textContent = f.moves[k];
    b.title = moveText(f.moves[k]);
    b.addEventListener('click', () => goTo(k));
    return b;
  }
  function setControls() {
    const f = S.flow;
    const loading = !f || f.loading;
    $('#btn-prev').disabled = loading || S.busy || f.idx === 0;
    $('#btn-restart').disabled = loading || S.busy || f.idx === 0;
    $('#btn-next').disabled = loading || (S.busy && !S.playing) || f.idx >= f.moves.length;
    $('#btn-play').disabled = loading || (!S.playing && f.idx >= f.moves.length);
    $('#ico-play').innerHTML = S.playing ? '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>' : '<path d="M5 5v14l8-7zM13 5v14l8-7z"/>';
    $('#btn-play').setAttribute('aria-label', S.playing ? 'Pause' : 'Play all');
  }
  // Caption, arrow, camera and notes for the current position in the flow.
  function afterStep(prevIdx) {
    const f = S.flow;
    if (!f || f.loading) return;
    const next = f.moves[f.idx];
    const n = f.moves.length;
    $('#cap-count').textContent = `${f.idx}/${n}`;
    if (next) {
      $('#cap-move').textContent = next; $('#cap-move').className = '';
      $('#cap-text').textContent = moveText(next);
    } else {
      $('#cap-move').textContent = '✓'; $('#cap-move').className = 'fin';
      $('#cap-text').textContent = f.kind === 'pair' ? 'Pair inserted. Pick the next pair.' : 'Cross done. Now pick a pair.';
    }
    let note = '';
    const st = f.states[f.idx];
    if (f.kind === 'pair') {
      const p = pairState(st, f.pair);
      const was = prevIdx != null ? pairState(f.states[prevIdx], f.pair) : null;
      if (p.solved && f.idx === n) note = 'Solved in ' + f.solutions[f.sel].len + ' moves.';
      else if (p.paired && (!was || !was.paired)) note = 'Corner and edge are paired. Insert them as one block.';
      else if (p.paired) note = 'Still paired. Keep the block together.';
      else if (was && was.paired && !p.paired) note = 'Pair split on purpose to line up the insert.';
      else if (was && was.cc.pos[1] !== 1 && p.cc.pos[1] === 1) note = 'Corner is out of the slot, into the top layer.';
      else if (was && was.ec.pos[1] !== 1 && p.ec.pos[1] === 1) note = 'Edge is out of the slot, into the top layer.';
      else if (f.idx === 0 && f.rotation) note = 'First turn the whole cube so the slot is at the front-right.';
    } else if (f.idx === n) note = 'All four cross edges are home.';
    $('#cap-note').textContent = note;
    view3d.showArrow(next || null);
    if (next && S.settings.follow) {
      const face = Cube.MOVES[next].base;
      if (!'xyz'.includes(face) && !view3d.faceVisible(face)) {
        const H = view3d.HOME;
        const target = face === 'L' ? [-H.theta, H.phi] : face === 'B' ? [Math.PI - H.theta, H.phi] : face === 'D' ? [H.theta, 2.05] : [H.theta, H.phi];
        view3d.lookFrom(target[0], target[1], 450);
        view3d.swung = true;
      } else if (view3d.swung && 'URFxyz'.includes(face)) {
        view3d.lookFrom(view3d.HOME.theta, view3d.HOME.phi, 450);
        view3d.swung = false;
      }
    }
    renderStrip();
    setControls();
    if (f.idx === n) { refreshPairs(); }
  }
  async function step(dir, fast) {
    const f = S.flow;
    if (!f || f.loading || S.busy) return false;
    const from = f.idx, to = from + dir;
    if (to < 0 || to > f.moves.length) return false;
    S.busy = true; setControls();
    view3d.clearArrow();
    const m = dir > 0 ? f.moves[from] : Cube.invertMove(f.moves[to]);
    const ms = fast ? Math.min(180, S.settings.speed) : S.settings.speed;
    await view3d.turn(m, ms, () => {
      f.idx = to; S.cube = f.states[to];
      view3d.setState(S.cube, focusFor(f));
    });
    holdLine(); saveCube();
    S.busy = false;
    afterStep(from);
    return true;
  }
  async function goTo(k) {
    const f = S.flow;
    if (!f || S.busy) return;
    stopPlay();
    while (f.idx !== k && S.flow === f) {
      const ok = await step(k > f.idx ? 1 : -1, Math.abs(k - f.idx) > 1);
      if (!ok) break;
    }
  }
  async function play() {
    const f = S.flow;
    if (!f) return;
    if (S.playing) { stopPlay(); return; }
    if (f.idx >= f.moves.length) return;
    S.playing = true; setControls();
    while (S.playing && S.flow === f && f.idx < f.moves.length) {
      await step(1);
      if (S.playing) await sleep(260);
    }
    S.playing = false; setControls();
  }
  function stopPlay() { S.playing = false; if (S.flow) setControls(); }

  async function manualMove(m) {
    if (S.busy) return;
    if (S.flow) { S.flow = null; renderFlow(); view3d.clearArrow(); }
    S.busy = true;
    S.history.push(S.cube);
    const next = Cube.applyMove(S.cube, m);
    await view3d.turn(m, Math.min(S.settings.speed, 300), () => { S.cube = next; view3d.setState(S.cube, null); });
    S.busy = false;
    holdLine(); saveCube(); refreshPairs();
  }

  function onTapSticker(idx) {
    if (S.busy) return;
    const r = Cube.slotForSticker(S.cube, idx);
    if (r.slot) {
      const pair = pairKeyColors(S.cube, r.slot);
      if (Cube.slotSolved(S.cube, r.slot)) { toast(`${cap(NAME[pair[0]])}–${NAME[pair[1]]} is already solved.`); return; }
      if (S.flow && S.flow.key === pair.slice().sort().join('')) return;
      startPair(pair);
    } else if (r.kind === 'cross') toast(Cube.crossSolved(S.cube) ? 'That\'s a cross edge, already in place.' : 'That\'s a cross edge. Use "Show cross moves".');
    else if (r.kind === 'last') toast('That piece belongs to the last layer, not F2L.');
  }

  // Load a cube into the solve screen with the intro spin.
  function loadCube(state, opts) {
    S.cube = state; S.flow = null; S.history = [];
    saveCube();
    setMode('cube');
    renderFlow(); paint(); refreshPairs();
    view3d.clearArrow();
    if (!opts || opts.spin !== false) view3d.spinIn();
  }
  function frontFor(down) {
    const order = ['G', 'R', 'B', 'O', 'W', 'Y'];
    return order.find(c => c !== down && c !== OPP[down]);
  }
  function canonical(state) {
    return Cube.reorient(state, S.crossColor, frontFor(S.crossColor));
  }

  // ---------- scanning: live view → check → confirm ----------
  // The camera looks for a face. When one holds still the picture freezes and shows the 9
  // colors it read; the user fixes any square and confirms. Confirmed faces also teach the
  // reader how this camera sees each color. Five faces settle the cube (the sixth is worked
  // out); a sixth is asked for only when five could fit more than one way.
  const Scan = {
    faces: {}, review: null, stream: null, timer: 0, stable: null, live: false, blocked: false,
    needColor: null, problem: null,
    work: document.createElement('canvas'),
    enter() {
      this.faces = {}; this.review = null; this.stable = null; this.needColor = null; this.problem = null;
      this.showReview(false);
      this.renderFaces();
      this.prompt();
      if (!this.stream && !this.blocked) this.startCamera();
    },
    count() { return Object.keys(this.faces).length; },
    nextText() {
      const n = this.count();
      if (this.problem) return 'Something doesn’t fit';
      if (this.needColor) return `One more: show the ${NAME[this.needColor]}-center side`;
      return n === 0 ? 'Show any side of your cube' : `Side ${n + 1} of 5 · turn to a new side`;
    },
    prompt() {
      const t = this.nextText();
      $('#vf-empty-title').textContent = t;
      $('#vf-empty-text').textContent = this.problem
        ? 'Tap a side marked below to check its colors again.'
        : this.blocked
          ? 'The Claude app doesn’t allow a live camera view here, so your camera opens for each side. Hold the cube straight on so one face fills most of the picture.'
          : 'Hold the cube about 20 cm away, straight on.';
      $('#btn-capture-label').textContent = this.count() ? 'Capture next side' : 'Capture side';
      $('#vf-buttons').hidden = !this.blocked || !!this.problem;
      if (this.live) this.setMsg(t);
    },
    renderFaces() {
      const host = $('#faces');
      host.innerHTML = '';
      Vision.COLORS.forEach(c => {
        const f = this.faces[c];
        const b = document.createElement('button');
        const bad = this.problem && this.problem.has(c);
        b.className = 'pface' + (f ? ' done' : '') + (bad ? ' bad' : '');
        const cells = f ? f.labels.map(x => `<i style="background:${HEX[x]}"></i>`).join('') : '<i></i>'.repeat(4) + '<i class="c"></i>' + '<i></i>'.repeat(4);
        b.innerHTML = `<span class="mini${f ? '' : ' empty'}" style="--fc:${HEX[c]}">${cells}</span>${cap(NAME[c])}`;
        b.disabled = !f;
        b.setAttribute('aria-label', f ? `Check the ${NAME[c]} side again` : `${NAME[c]} side not captured yet`);
        if (f) b.addEventListener('click', () => this.openReview(f.cv, f.quad, f.samples, f.labels, c));
        host.appendChild(b);
      });
      $('#face-count').textContent = `${this.count()} of 5`;
    },
    // Which color is this sample? Nearest confirmed sticker from this camera, else the default.
    read(rgb) {
      const lab = Vision.toLab(rgb);
      let best = null, bd = Infinity;
      for (const c in this.faces) {
        const f = this.faces[c];
        f.labs.forEach((l, i) => { const d = Vision.labDistLab(lab, l); if (d < bd) { bd = d; best = f.labels[i]; } });
      }
      const def = Vision.nearest(rgb);
      return best && bd <= Vision.labDist(rgb, Vision.DEFAULT_RGB[def]) + 6 ? best : def;
    },

    // ----- live camera -----
    async startCamera() {
      $('#vf-empty-title').textContent = 'Starting the camera…';
      $('#vf-empty-text').textContent = '';
      $('#vf-buttons').hidden = true;
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { this.setBlocked(); return; }
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false });
      } catch (e) { this.setBlocked(); return; }
      if (S.mode !== 'scan') { this.stopCamera(); return; }
      this.live = true;
      const v = $('#video');
      v.srcObject = this.stream; v.hidden = false;
      await v.play().catch(() => {});
      $('#vf-empty').hidden = true;
      this.stable = null;
      this.prompt();
      clearInterval(this.timer);
      this.timer = setInterval(() => this.frame(), 120);
    },
    setBlocked() {
      this.blocked = true; this.live = false;
      $('#vf-empty').hidden = false;
      this.prompt();
    },
    stopCamera() {
      clearInterval(this.timer);
      if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; }
      this.live = false;
      const v = $('#video'); v.hidden = true; v.srcObject = null;
      $('#vf-msg').hidden = true;
      const o = $('#vf-overlay'); o.getContext('2d').clearRect(0, 0, o.width, o.height);
    },
    setMsg(html) { const m = $('#vf-msg'); m.hidden = false; m.innerHTML = html; },
    guide(dw, dh) { const s = Math.min(dw, dh) * 0.7; return { x: (dw - s) / 2, y: (dh - s) / 2 - Math.min(dw, dh) * 0.05, s }; },
    frame() {
      if (this.review || !this.live || this.problem) return;
      const v = $('#video');
      if (!v.videoWidth) return;
      const o = $('#vf-overlay');
      const dw = o.clientWidth, dh = o.clientHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
      if (o.width !== Math.round(dw * dpr) || o.height !== Math.round(dh * dpr)) { o.width = Math.round(dw * dpr); o.height = Math.round(dh * dpr); }
      const g = this.guide(dw, dh);
      // look a little beyond the guide square so the face doesn't need perfect aiming
      const rs = Math.min(g.s * 1.3, dw, dh), rx = Math.max(0, Math.min(dw - rs, g.x + g.s / 2 - rs / 2)), ry = Math.max(0, Math.min(dh - rs, g.y + g.s / 2 - rs / 2));
      const sc = Math.max(dw / v.videoWidth, dh / v.videoHeight);
      const ox = (dw - v.videoWidth * sc) / 2, oy = (dh - v.videoHeight * sc) / 2;
      const N = 360, W = this.work;
      W.width = W.height = N;
      W.getContext('2d', { willReadFrequently: true }).drawImage(v, (rx - ox) / sc, (ry - oy) / sc, rs / sc, rs / sc, 0, 0, N, N);
      const det = Vision.detectFace(W);
      const toScreen = ([x, y]) => [rx + x / N * rs, ry + y / N * rs];
      if (!det || det.score < 11) {
        this.stable = null;
        this.drawOverlay(o, dpr, g, null, null, 0);
        this.setMsg(this.nextText());
        return;
      }
      // only a side that faces the camera squarely gives a clean read
      const q = det.quad, len = (a, b) => Math.hypot(q[b][0] - q[a][0], q[b][1] - q[a][1]);
      const sides = [len(0, 1), len(1, 2), len(2, 3), len(3, 0)];
      const ux = q[1][0] - q[0][0], uy = q[1][1] - q[0][1], vx = q[3][0] - q[0][0], vy = q[3][1] - q[0][1];
      const square = Math.min(...sides) / Math.max(...sides) > 0.72 && Math.abs(ux * vx + uy * vy) / (sides[0] * sides[3]) < 0.3;
      const samples = Vision.sampleFace(W, det.quad);
      const labels = samples.map(x => this.read(x));
      const side = sides[0];
      const mid = qq => [(qq[0][0] + qq[2][0]) / 2, (qq[0][1] + qq[2][1]) / 2];
      const moved = this.stable ? Math.hypot(mid(q)[0] - mid(this.stable.quad)[0], mid(q)[1] - mid(this.stable.quad)[1]) : Infinity;
      const sig = labels.join('');
      if (square && this.stable && this.stable.sig === sig && moved < side * 0.15) { this.stable.n++; this.stable.frames.push(samples); }
      else this.stable = square ? { sig, n: 1, frames: [samples] } : null;
      if (this.stable) this.stable.quad = det.quad;
      const need = 6, progress = this.stable ? Math.min(1, this.stable.n / need) : 0;
      this.drawOverlay(o, dpr, g, det.quad.map(toScreen), labels, progress);
      if (!square) { this.setMsg('Turn the side so it faces the camera straight on'); return; }
      const have = this.faces[labels[4]];
      if (have && Vision.labDist(have.samples[4], samples[4]) < 18) {
        this.setMsg(`Already have the ${NAME[labels[4]]} side \u00b7 turn to a new one`);
        this.stable = null;
        return;
      }
      if (progress < 1) { this.setMsg('Hold still\u2026'); return; }
      // read each square from the median of the steady frames
      const frames = this.stable.frames;
      const med = samples.map((_, i) => [0, 1, 2].map(k => { const v = frames.map(f => f[i][k]).sort((a, b) => a - b); return v[v.length >> 1]; }));
      const snap = document.createElement('canvas');
      snap.width = snap.height = N;
      snap.getContext('2d').drawImage(W, 0, 0);
      this.stable = null;
      this.openReview(snap, det.quad, med, med.map(x => this.read(x)), null);
    },
    drawOverlay(o, dpr, g, quad, labels, progress) {
      const x = o.getContext('2d');
      x.setTransform(dpr, 0, 0, dpr, 0, 0);
      const dw = o.width / dpr, dh = o.height / dpr;
      x.clearRect(0, 0, dw, dh);
      x.fillStyle = 'rgba(10,12,16,0.35)';
      x.beginPath(); x.rect(0, 0, dw, dh); roundRectPath(x, g.x, g.y, g.s, g.s, 20); x.fill('evenodd');
      x.strokeStyle = 'rgba(255,255,255,0.75)'; x.lineWidth = 2;
      x.beginPath(); roundRectPath(x, g.x, g.y, g.s, g.s, 20); x.stroke();
      if (!quad) return;
      const P = (u, v) => Vision.quadPoint(quad, u, v);
      x.strokeStyle = progress >= 1 ? '#7dffb0' : '#ffffff'; x.lineWidth = 2.5;
      for (let i = 0; i <= 3; i++) {
        let a = P(i / 3, 0), b = P(i / 3, 1); x.beginPath(); x.moveTo(a[0], a[1]); x.lineTo(b[0], b[1]); x.stroke();
        a = P(0, i / 3); b = P(1, i / 3); x.beginPath(); x.moveTo(a[0], a[1]); x.lineTo(b[0], b[1]); x.stroke();
      }
      const cell = Math.hypot(quad[1][0] - quad[0][0], quad[1][1] - quad[0][1]) / 3;
      labels.forEach((l, i) => {
        const [cx, cy] = P(((i % 3) + 0.5) / 3, (Math.floor(i / 3) + 0.5) / 3);
        x.beginPath(); x.arc(cx, cy, Math.max(6, cell * 0.16), 0, Math.PI * 2);
        x.fillStyle = HEX[l]; x.fill(); x.lineWidth = 2; x.strokeStyle = '#fff'; x.stroke();
      });
      const a = P(0, 1), b = P(1, 1);
      x.fillStyle = 'rgba(255,255,255,0.3)'; x.fillRect(a[0], a[1] + 10, b[0] - a[0], 5);
      x.fillStyle = '#7dffb0'; x.fillRect(a[0], a[1] + 10, (b[0] - a[0]) * progress, 5);
    },

    // ----- when the live view is blocked: the phone camera's shutter instead -----
    async fromFile(file) {
      if (!file) return;
      try {
        const cv = await Vision.loadImage(file, 1000);
        const det = Vision.detectFace(cv);
        const quad = det ? det.quad : Vision.autoQuad(cv);
        const samples = Vision.sampleFace(cv, quad);
        this.openReview(cv, quad, samples, samples.map(x => this.read(x)), null);
        if (!det) $('#rv-hint').textContent = 'The grid may be off. Check every square, or retake closer and straight on.';
      } catch (e) { toast(e.message); }
    },

    // ----- check and confirm -----
    openReview(cv, quad, samples, labels, editing) {
      this.review = { cv, quad, samples, labels: labels.slice(), sel: -1, editing };
      if (navigator.vibrate) { try { navigator.vibrate(20); } catch (e) { /* not allowed */ } }
      this.showReview(true);
      $('#rv-hint').textContent = 'Do these match your cube? Tap a square to fix it.';
      this.renderReview();
    },
    showReview(on) {
      $('#review').hidden = !on;
      if (on) $('#vf-msg').hidden = true;
      $('#vf-empty').hidden = on || this.live;
    },
    renderReview() {
      const r = this.review;
      const c = r.labels[4];
      $('#rv-title').innerHTML = `${chip(c)} ${cap(NAME[c])} center`;
      const dup = !r.editing && this.faces[c];
      $('#rv-step').textContent = r.editing ? 'Editing' : dup ? 'Replaces the one you have' : `Side ${this.count() + 1}`;
      const grid = $('#rv-grid');
      grid.innerHTML = '';
      r.labels.forEach((l, i) => {
        const b = document.createElement('button');
        b.style.background = HEX[l];
        b.className = i === 4 ? 'center' : '';
        b.setAttribute('aria-pressed', String(r.sel === i));
        b.setAttribute('aria-label', `Row ${Math.floor(i / 3) + 1}, column ${(i % 3) + 1}: ${NAME[l]}. Tap to change.`);
        b.addEventListener('click', () => { r.sel = r.sel === i ? -1 : i; this.renderReview(); });
        grid.appendChild(b);
      });
      const pal = $('#rv-palette');
      pal.hidden = r.sel < 0;
      pal.innerHTML = '';
      if (r.sel >= 0) Vision.COLORS.forEach(col => {
        const b = document.createElement('button');
        b.style.background = HEX[col];
        b.setAttribute('aria-label', 'Make it ' + NAME[col]);
        b.addEventListener('click', () => { r.labels[r.sel] = col; r.sel = -1; this.renderReview(); });
        pal.appendChild(b);
      });
      this.drawReviewPhoto();
    },
    drawReviewPhoto() {
      const r = this.review, pc = $('#rv-photo');
      const W = pc.clientWidth, H = pc.clientHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
      if (!W || !H) return;
      pc.width = Math.round(W * dpr); pc.height = Math.round(H * dpr);
      const x = pc.getContext('2d');
      x.setTransform(1, 0, 0, 1, 0, 0);
      x.fillStyle = '#0d0f13'; x.fillRect(0, 0, pc.width, pc.height);
      const xs = r.quad.map(p => p[0]), ys = r.quad.map(p => p[1]);
      let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      const pad = Math.max(x1 - x0, y1 - y0) * 0.14;
      x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(r.cv.width, x1 + pad); y1 = Math.min(r.cv.height, y1 + pad);
      const sc = Math.min(W / (x1 - x0), H / (y1 - y0));
      const ox = (W - (x1 - x0) * sc) / 2 - x0 * sc, oy = (H - (y1 - y0) * sc) / 2 - y0 * sc;
      x.setTransform(dpr * sc, 0, 0, dpr * sc, dpr * ox, dpr * oy);
      x.drawImage(r.cv, 0, 0);
      const P = (u, v) => Vision.quadPoint(r.quad, u, v);
      x.strokeStyle = 'rgba(255,255,255,0.9)'; x.lineWidth = 2 / sc;
      for (let i = 0; i <= 3; i++) {
        let a = P(i / 3, 0), b = P(i / 3, 1); x.beginPath(); x.moveTo(a[0], a[1]); x.lineTo(b[0], b[1]); x.stroke();
        a = P(0, i / 3); b = P(1, i / 3); x.beginPath(); x.moveTo(a[0], a[1]); x.lineTo(b[0], b[1]); x.stroke();
      }
      const cell = Math.hypot(r.quad[1][0] - r.quad[0][0], r.quad[1][1] - r.quad[0][1]) / 3;
      r.labels.forEach((l, i) => {
        const [cx, cy] = P(((i % 3) + 0.5) / 3, (Math.floor(i / 3) + 0.5) / 3);
        x.beginPath(); x.arc(cx, cy, cell * 0.17, 0, Math.PI * 2);
        x.fillStyle = HEX[l]; x.fill();
        x.lineWidth = (r.sel === i ? 5 : 2.5) / sc; x.strokeStyle = r.sel === i ? '#4f46e5' : '#fff'; x.stroke();
      });
      this.photoMap = { sc, ox, oy };
    },
    // tapping the photo picks the nearest square too
    tapPhoto(e) {
      const r = this.review;
      if (!r || !this.photoMap) return;
      const rect = $('#rv-photo').getBoundingClientRect();
      const px = (e.clientX - rect.left - this.photoMap.ox) / this.photoMap.sc, py = (e.clientY - rect.top - this.photoMap.oy) / this.photoMap.sc;
      let best = -1, bd = Infinity;
      for (let i = 0; i < 9; i++) {
        const [cx, cy] = Vision.quadPoint(r.quad, ((i % 3) + 0.5) / 3, (Math.floor(i / 3) + 0.5) / 3);
        const d = Math.hypot(cx - px, cy - py);
        if (d < bd) { bd = d; best = i; }
      }
      const cell = Math.hypot(r.quad[1][0] - r.quad[0][0], r.quad[1][1] - r.quad[0][1]) / 3;
      if (bd < cell * 0.7) { r.sel = r.sel === best ? -1 : best; this.renderReview(); }
    },
    confirm() {
      const r = this.review;
      if (!r) return;
      if (r.editing && r.editing !== r.labels[4]) delete this.faces[r.editing];
      const c = r.labels[4];
      this.faces[c] = { labels: r.labels.slice(), samples: r.samples, labs: r.samples.map(Vision.toLab), cv: r.cv, quad: r.quad };
      this.review = null;
      if (this.problem) this.problem.delete(c);
      if (this.problem && !this.problem.size) this.problem = null;
      if (this.needColor && this.faces[this.needColor]) this.needColor = null;
      this.showReview(false);
      this.renderFaces();
      if (this.finish()) return;
      this.stable = null;
      this.prompt();
      // without a live view, go straight to the camera for the next side (still inside the tap)
      if (this.blocked && !this.problem) $('#in-capture').click();
    },
    retake() {
      const r = this.review;
      this.review = null;
      if (r && r.editing) { delete this.faces[r.editing]; this.renderFaces(); }
      this.showReview(false);
      this.stable = null;
      this.prompt();
      if (this.blocked) $('#in-capture').click();
    },
    // Enough faces? Build the cube and move on to solving.
    finish() {
      const n = this.count();
      if (n < 5) return false;
      const grids = {};
      for (const c in this.faces) grids[c] = this.faces[c].labels.slice();
      let o = Cube.orientFromPhotos(grids, STD_LAYOUT);
      if (!o.valid && n === 6) { const fixed = Cube.repair(o); if (fixed) o = { valid: true, state: fixed }; }
      if (o.valid) {
        this.stopCamera();
        loadCube(canonical(o.state));
        toast(o.inferred ? `Got it. The ${NAME[o.inferred]} side was worked out from the others.` : 'Got it. Hold your cube as shown.');
        return true;
      }
      if (n === 5) { this.needColor = Vision.COLORS.find(c => !this.faces[c]); return false; }
      // six faces that don't fit: point at the sides holding the pieces that don't fit
      const bad = new Set();
      if (o.check && o.layout) o.check.bad.forEach(i => bad.add(o.layout[Math.floor(i / 9)]));
      this.problem = bad.size ? bad : new Set(Object.keys(this.faces));
      this.renderFaces();
      return false;
    },
  };
  function roundRectPath(x, a, b, w, h, r) {
    x.moveTo(a + r, b); x.arcTo(a + w, b, a + w, b + h, r); x.arcTo(a + w, b + h, a, b + h, r); x.arcTo(a, b + h, a, b, r); x.arcTo(a, b, a + w, b, r); x.closePath();
  }

  // ---------- wiring ----------
  function buildPad() {
    const moves = ['U', "U'", 'U2', 'D', "D'", 'D2', 'R', "R'", 'R2', 'L', "L'", 'L2', 'F', "F'", 'F2', 'B', "B'", 'B2', 'y', "y'", 'y2'];
    const host = $('#pad');
    moves.forEach(m => {
      const b = document.createElement('button');
      b.textContent = m; b.title = moveText(m);
      b.addEventListener('click', () => manualMove(m));
      host.appendChild(b);
    });
  }
  function wire() {
    $('#btn-newscan').addEventListener('click', () => setMode('scan'));
    $('#btn-cancelscan').addEventListener('click', () => setMode('cube'));
    $('#in-capture').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; Scan.fromFile(f); });
    $('#rv-ok').addEventListener('click', () => Scan.confirm());
    $('#rv-retake').addEventListener('click', () => Scan.retake());
    $('#rv-photo').addEventListener('click', e => Scan.tapPhoto(e));
    new ResizeObserver(() => { if (Scan.review) Scan.drawReviewPhoto(); }).observe($('#rv-photo'));
    $('#btn-cross').addEventListener('click', () => startCross());
    $('#btn-close-flow').addEventListener('click', () => closeFlow());
    $('#btn-next').addEventListener('click', () => { stopPlay(); step(1); });
    $('#btn-prev').addEventListener('click', () => { stopPlay(); step(-1); });
    $('#btn-restart').addEventListener('click', () => { stopPlay(); if (S.flow) goTo(0); });
    $('#btn-play').addEventListener('click', () => play());
    $('#btn-view').addEventListener('click', () => { view3d.lookFrom(view3d.HOME.theta, view3d.HOME.phi, 500); view3d.swung = false; });
    $('#btn-undo').addEventListener('click', () => {
      if (S.busy || !S.history.length) return;
      if (S.flow) { S.flow = null; renderFlow(); view3d.clearArrow(); }
      S.cube = S.history.pop(); paint(); saveCube(); refreshPairs();
    });
    const rot = $('#opt-rotate'), fol = $('#opt-follow'), spd = $('#opt-speed');
    rot.checked = S.settings.rotate; fol.checked = S.settings.follow; spd.value = S.settings.speed;
    const saveSettings = () => store.set('settings', S.settings);
    rot.addEventListener('change', () => { S.settings.rotate = rot.checked; saveSettings(); const f = S.flow; if (f && f.kind === 'pair') { S.cube = f.start; startPair(f.pair); } else refreshPairs(); });
    fol.addEventListener('change', () => { S.settings.follow = fol.checked; saveSettings(); });
    spd.addEventListener('input', () => { S.settings.speed = +spd.value; saveSettings(); });
    document.addEventListener('keydown', e => {
      if (S.mode !== 'cube' || e.target.closest('input,select,textarea')) return;
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); stopPlay(); step(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); stopPlay(); step(-1); }
    });
    new ResizeObserver(() => { if (S.flow) view3d.setPad($('#player').offsetHeight + 16); }).observe($('#player'));
    buildPad();
  }

  async function init() {
    window.F2L = { S, Scan }; // handy for debugging from the console
    view3d = new Cube3D($('#stage'), onTapSticker);
    wire();
    Solver.call({ op: 'warm' });
    const saved = store.get('cube', null);
    if (saved && saved.length === 54 && Cube.validate(saved.split('')).valid) {
      loadCube(canonical(saved.split('')), {});
      return;
    }
    // No cube of yours yet: open straight on the scanner.
    S.cube = null;
    setMode('scan');
  }
  init();
})();
