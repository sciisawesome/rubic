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
  const APP_VERSION = '__APP_VERSION__';   // stamped by build-single.mjs
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
  function roundedShape(w, r) {
    const s = new THREE.Shape(), h = w / 2;
    s.moveTo(-h + r, -h); s.lineTo(h - r, -h); s.quadraticCurveTo(h, -h, h, -h + r);
    s.lineTo(h, h - r); s.quadraticCurveTo(h, h, h - r, h); s.lineTo(-h + r, h);
    s.quadraticCurveTo(-h, h, -h, h - r); s.lineTo(-h, -h + r); s.quadraticCurveTo(-h, -h, -h + r, -h);
    return s;
  }
  // Rounded square with its own radius per corner: [top-left, top-right, bottom-right, bottom-left].
  function cornerShape(w, rr, path) {
    const s = path || new THREE.Shape(), h = w / 2, [tl, tr, br, bl] = rr;
    s.moveTo(-h + bl, -h); s.lineTo(h - br, -h); s.quadraticCurveTo(h, -h, h, -h + br);
    s.lineTo(h, h - tr); s.quadraticCurveTo(h, h, h - tr, h); s.lineTo(-h + tl, h);
    s.quadraticCurveTo(-h, h, -h, h - tl); s.lineTo(-h, -h + bl); s.quadraticCurveTo(-h, -h, -h + bl, -h);
    return s;
  }
  // Tile outline for each sticker in the style of a stickerless speed cube: centers are round
  // caps, edges are rounded on the side facing the center, corners soften the corner nearest
  // the center. `toCenter` is the local direction from the tile toward its face's center.
  const TILE = 0.92;
  function tileRadii(kind, toCenter) {
    const sx = Math.sign(Math.round(toCenter.x)), sy = Math.sign(Math.round(toCenter.y));
    const small = 0.07;
    if (kind === 1) return [0.3, 0.3, 0.3, 0.3];
    const big = kind === 2 ? 0.4 : 0.26;
    const corners = [[-1, 1], [1, 1], [1, -1], [-1, -1]];
    return corners.map(([cx, cy]) => {
      if (kind === 3) return cx === sx && cy === sy ? big : small;
      return (sx && cx === sx) || (sy && cy === sy) ? big : small;
    });
  }

  // A flat arrow pointing along +y, centered on the origin; `double` adds a second head ("twice").
  function arrowGeometry(len, w, hl, hw, double) {
    const y0 = -len / 2, y1 = len / 2;
    const s = new THREE.Shape();
    s.moveTo(-w / 2, y0); s.lineTo(w / 2, y0); s.lineTo(w / 2, y1 - hl); s.lineTo(hw / 2, y1 - hl);
    s.lineTo(0, y1); s.lineTo(-hw / 2, y1 - hl); s.lineTo(-w / 2, y1 - hl); s.closePath();
    const shapes = [s];
    if (double) {
      const t = new THREE.Shape(), off = hl * 0.95;
      t.moveTo(hw / 2, y1 - hl - off); t.lineTo(0, y1 - off); t.lineTo(-hw / 2, y1 - hl - off); t.closePath();
      shapes.push(t);
    }
    return new THREE.ShapeGeometry(shapes);
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
      // soft studio light: sky/ground fill, a key light from the upper front-right, a faint rim
      this.scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa1b0, 0.62));
      const key = new THREE.DirectionalLight(0xffffff, 0.58); key.position.set(3, 10, 6); this.scene.add(key);
      const fill = new THREE.DirectionalLight(0xffffff, 0.16); fill.position.set(-6, 2, 4); this.scene.add(fill);
      this.root = new THREE.Group(); this.scene.add(this.root);
      this.HOME = { theta: 0.62, phi: 0.98 };
      this.view = { theta: this.HOME.theta, phi: this.HOME.phi };
      this.pad = 0; this.dist = 12;
      this.cubies = []; this.stickers = [];
      this.anims = []; this.dirty = true; this.arrow = null; this.slotMark = null;
      this.buildShadow();
      // light inner plastic, as on a stickerless cube; the tiles nearly cover it
      const bodyMat = new THREE.MeshStandardMaterial({ color: 0xd9d3c6, roughness: 0.85, metalness: 0 });
      const bodyGeo = new THREE.BoxGeometry(0.985, 0.985, 0.985);
      const geoCache = {}, ringCache = {};
      const extrude = { depth: 0.02, bevelEnabled: true, bevelThickness: 0.014, bevelSize: 0.012, bevelSegments: 2, curveSegments: 8 };
      const tileGeoFor = rr => geoCache[rr] || (geoCache[rr] = new THREE.ExtrudeGeometry(cornerShape(TILE - 0.024, rr), extrude));
      // a dark frame laid on a tile, used to mark the pair's stickers
      const ringGeoFor = rr => {
        if (ringCache[rr]) return ringCache[rr];
        const outer = cornerShape(TILE - 0.02, rr);
        const hole = cornerShape(TILE - 0.2, rr.map(r => Math.max(0.03, r - 0.08)), new THREE.Path());
        outer.holes.push(hole);
        return (ringCache[rr] = new THREE.ShapeGeometry(outer, 8));
      };
      const ringMat = new THREE.MeshBasicMaterial({ color: 0x121318 });
      for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
        if (!x && !y && !z) continue;
        const g = new THREE.Group();
        const home = new THREE.Vector3(x, y, z);
        g.position.copy(home);
        g.add(new THREE.Mesh(bodyGeo, bodyMat));
        Cube.STICKERS.forEach(s => {
          if (s.pos[0] !== x || s.pos[1] !== y || s.pos[2] !== z) return;
          const n = new THREE.Vector3(...s.n);
          const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
          // which way the face's center lies, in the tile's own flat coordinates
          const toCenter = n.clone().sub(new THREE.Vector3(x, y, z)).applyQuaternion(q.clone().invert());
          const rr = tileRadii(Cube.STICKER_CUBIE[s.i].stickers.length, toCenter);
          const m = new THREE.Mesh(tileGeoFor(rr), new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.34, metalness: 0 }));
          m.position.copy(n.clone().multiplyScalar(0.49));
          m.quaternion.copy(q);
          m.userData.idx = s.i;
          const ring = new THREE.Mesh(ringGeoFor(rr), ringMat);
          ring.position.z = 0.036; ring.visible = false;
          m.add(ring); m.userData.ring = ring;
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
      const g = x.createRadialGradient(64, 64, 2, 64, 64, 62);
      g.addColorStop(0, 'rgba(18,19,24,0.26)'); g.addColorStop(0.55, 'rgba(18,19,24,0.08)'); g.addColorStop(1, 'rgba(18,19,24,0)');
      x.fillStyle = g; x.fillRect(0, 0, 128, 128);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 5.6), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.position.y = -2.25;
      this.scene.add(m);
    }
    setPad(px) { this.pad = px; this.resize(); }
    resize() {
      const w = this.host.clientWidth, h = this.host.clientHeight;
      if (!w || !h) return;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      const top = 48, pad = Math.min(this.pad, h * 0.6);
      const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
      const R = 2.55;
      const fitV = tanV * (h - pad - top) / h, fitH = tanV * (w - 20) / h;
      this.dist = R / Math.min(fitV, fitH) + 0.3;
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
    // Paint tiles from a 54-color state. `focus` (sorted color keys) marks pieces in full color
    // with dark frames; `keep` shows pieces in full color without frames (the white cross);
    // the rest turn a quiet gray. Centers stay faintly tinted so faces stay readable.
    setState(state, focus, keep) {
      const quiet = new THREE.Color('#c3c8d0');
      for (const c of this.cubies) {
        const meshes = c.obj.children.filter(m => m.userData.idx != null);
        const key = meshes.map(m => state[m.userData.idx]).sort().join('');
        const isCenter = meshes.length === 1;
        const marked = !!focus && focus.has(key) && !isCenter;
        const dim = !!focus && !marked && !(keep && keep.has(key)) && !(isCenter && keep);
        for (const m of meshes) {
          const col = new THREE.Color(HEX[state[m.userData.idx]]);
          if (dim) col.lerp(quiet, isCenter ? 0.5 : 0.94);
          else if (focus && isCenter) col.lerp(quiet, 0.25);
          m.material.color.copy(col);
          m.userData.ring.visible = marked;
        }
      }
      this.dirty = true;
    }
    // Outline the slot a pair goes into ('FR', 'FL', 'BR', 'BL' in the current view), or none.
    setSlot(slot) {
      if (this.slotMark) { this.scene.remove(this.slotMark); this.slotMark = null; }
      if (slot) {
        const box = new THREE.BoxGeometry(1.14, 2.14, 1.14);
        const g = new THREE.Group();
        g.add(new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.13, depthWrite: false })));
        g.add(new THREE.LineSegments(new THREE.EdgesGeometry(box), new THREE.LineBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.85 })));
        g.position.set(slot[1] === 'R' ? 1 : -1, -0.5, slot[0] === 'F' ? 1 : -1);
        this.scene.add(g);
        this.slotMark = g;
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
    // Arrows the way cube tutorials draw them: a straight arrow along the column or row that
    // turns (drawn on the front, or on the top for the back layer), a curved one for the front
    // face, and a ring around the cube for whole-cube turns.
    showArrow(move) {
      this.clearArrow();
      if (!move) return;
      const mv = Cube.MOVES[move], f = mv.base, a = mv.amount;
      const fill = new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.97 });
      const edge = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95 });
      const g = new THREE.Group();
      const flat = (len) => {
        const inner = new THREE.Group();
        const o = new THREE.Mesh(arrowGeometry(len + 0.14, 0.3, 0.52, 0.72, a === 2), edge);
        const i = new THREE.Mesh(arrowGeometry(len, 0.17, 0.42, 0.56, a === 2), fill);
        o.position.set(0, 0, -0.004); i.position.y = -0.02;
        inner.add(o, i);
        return inner;
      };
      if ('RLUD'.includes(f)) {
        // direction the front stickers of that layer travel
        const dirs = { R: [0, 1], L: [0, -1], U: [-1, 0], D: [1, 0] };
        let [dx, dy] = dirs[f];
        if (a === -1) { dx = -dx; dy = -dy; }
        const arrow = flat(2.15);
        arrow.rotation.z = Math.atan2(-dx, dy);
        arrow.position.set(f === 'R' ? 1 : f === 'L' ? -1 : 0, f === 'U' ? 1 : f === 'D' ? -1 : 0, 1.58);
        g.add(arrow);
      } else if (f === 'B') {
        // back layer: its top row slides left (B) or right (B') as seen from the front
        const arrow = flat(2.15);
        arrow.rotation.z = Math.atan2(a === -1 ? -1 : 1, 0);
        const holder = new THREE.Group();
        holder.rotation.x = -Math.PI / 2;
        holder.position.set(0, 1.58, -1);
        holder.add(arrow);
        g.add(holder);
      } else {
        // curved: front face, or a ring around the cube for whole-cube turns
        const isRot = 'xyz'.includes(f);
        const radius = isRot ? 2.3 : 0.98, tube = isRot ? 0.075 : 0.085;
        const arc = a === 2 ? Math.PI * 1.7 : Math.PI * 1.3;
        const outer = new THREE.Group(), inner = new THREE.Group();
        inner.add(new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 12, 72, arc), fill));
        const cw = a !== -1;
        const heads = a === 2 ? [0, arc / 2] : [cw ? 0 : arc];
        heads.forEach(t => {
          const cone = new THREE.Mesh(new THREE.ConeGeometry(isRot ? 0.22 : 0.2, isRot ? 0.48 : 0.42, 24), fill);
          const dir = cw ? new THREE.Vector3(Math.sin(t), -Math.cos(t), 0) : new THREE.Vector3(-Math.sin(t), Math.cos(t), 0);
          cone.position.set(radius * Math.cos(t), radius * Math.sin(t), 0).add(dir.clone().multiplyScalar(0.12));
          cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
          inner.add(cone);
        });
        inner.rotation.z = Math.PI * 0.35;
        outer.add(inner);
        const ax = new THREE.Vector3(...mv.axis);
        outer.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), ax);
        if (!isRot) outer.position.copy(ax.clone().multiplyScalar(1.6));
        g.add(outer);
      }
      this.scene.add(g);
      this.arrow = g;
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
    pairs: {}, pairList: [], pairsVersion: 0,
    settings: Object.assign({ rotate: true, speed: 450 }, store.get('settings', {})),
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
    ['#pairs-card', '#guide-card', '#more-card'].forEach(id => { $(id).hidden = scanning; });
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
  const SLOT_WORD = { FR: 'front right', FL: 'front left', BR: 'back right', BL: 'back left' };
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
  // One plain line on where the two pieces are, read in the view the solution starts from.
  function caseLine(st, pair) {
    const p = pairState(st, pair);
    if (!p) return '';
    if (p.paired) return 'The corner and edge are already joined. Just insert them.';
    const D = D_COLOR(st), cs = Cube.STICKERS[p.ci];
    const facing = cs.face === 'U' ? 'up' : cs.face === 'D' ? 'down' : FACE_WORD[cs.face];
    const corner = p.cc.pos[1] === 1 ? `Corner on top, ${NAME[D]} facing ${facing}` : `Corner stuck in a slot, ${NAME[D]} facing ${facing}`;
    let edge;
    if (p.ec.pos[1] === 1) edge = 'edge on top';
    else if (p.slot && sameVec(p.ec.pos, Cube.STICKER_CUBIE[Cube.SLOTS[p.slot].edge].pos)) edge = p.ei === Cube.SLOTS[p.slot].edge ? 'edge already in place' : 'edge in its slot but flipped';
    else edge = 'edge stuck in another slot';
    return `${corner}; ${edge}.`;
  }
  const isTurn = m => 'xyz'.includes(Cube.MOVES[m].base);
  // For a whole-cube turn inside a flow: which color faces you afterwards.
  function frontAfter(f, k) { return Cube.colorOf(f.states[k + 1], 'F'); }
  function stepText(f, k) {
    const m = f.moves[k];
    if (!isTurn(m)) return moveText(m);
    const st = f.states[k + 1];
    return `Turn the cube so ${NAME[Cube.colorOf(st, 'F')]} faces you (${NAME[Cube.colorOf(st, 'U')]} stays on top)`;
  }
  // Why this move: what it does to the white cross (lift a side and a cross edge rides up;
  // turn it back and the cross is put back), or that a top turn never touches it.
  function stepWhy(f, k) {
    const m = f.moves[k], before = f.states[k], after = f.states[k + 1];
    if (isTurn(m)) return f.kind === 'pair' ? 'So the slot is at the front right. Your hands do the same moves every time.' : '';
    const D = NAME[D_COLOR(after)];
    const cb = Cube.trackCross(before), ca = Cube.trackCross(after);
    const home = st => Cube.trackCross(st).every((x, i) => x === Cube.CROSS[i].st);
    const okBefore = home(before), okAfter = home(after);
    const base = Cube.MOVES[m].base;
    if (base === 'U') return okBefore ? `Top only: the ${D} cross is never touched, so this is free.` : 'Top only: moves the pieces while the side is turned.';
    if (f.kind === 'cross') return '';
    const moved = Cube.CROSS.map((e, i) => i).filter(i => cb[i] !== ca[i]);
    const edgeName = i => `${D}–${NAME[Cube.colorOf(after, Cube.CROSS[i].faces[1])]}`;
    const side = FACE_WORD[base];
    if (okBefore && !okAfter) return `Turns the ${side} side, so the ${moved.length ? edgeName(moved[0]) + ' cross edge' : D + ' cross'} moves out for now.`;
    if (!okBefore && okAfter) return `Turns the ${side} side back, which puts the ${D} cross back.`;
    if (!okBefore && !okAfter) return `Turns the ${side} side too; it gets turned back later.`;
    return '';
  }
  const TURN_ICON = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v5h-5"/></svg>';

  // What to do for a move, in plain words. Directions are as you look at the front.
  function moveText(m) {
    const mv = Cube.MOVES[m], f = mv.base, a = mv.amount;
    const T = {
      R: ['Right side up', 'Right side down', 'Right side twice'],
      L: ['Left side down', 'Left side up', 'Left side twice'],
      U: ['Top to the left', 'Top to the right', 'Top twice'],
      D: ['Bottom to the right', 'Bottom to the left', 'Bottom twice'],
      F: ['Front clockwise', 'Front counter-clockwise', 'Front twice'],
      B: ['Back: top row goes left', 'Back: top row goes right', 'Back twice'],
      y: ['Turn the whole cube left', 'Turn the whole cube right', 'Turn the whole cube around'],
      x: ['Tip the whole cube back', 'Tip the whole cube forward', 'Flip the whole cube over'],
      z: ['Roll the whole cube right', 'Roll the whole cube left', 'Roll the whole cube over'],
    };
    return T[f][a === 1 ? 0 : a === -1 ? 1 : 2];
  }
  // Split a pair solution into what each part is for: turn the cube, join the pieces, insert.
  const PHASE = {
    turn: { name: 'Turn the cube', why: 'So the slot is at the front right.' },
    pair: { name: 'Pair up', why: 'Join the corner and its edge into one block.' },
    insert: { name: 'Insert', why: 'Drop the block into its slot.' },
    cross: { name: 'Cross', why: 'Bring the four edges home, matching the side centers.' },
  };
  function phasesFor(f) {
    if (f.kind === 'cross') return [{ key: 'cross', from: 0, to: f.moves.length }];
    const out = [];
    const off = f.rotation ? 1 : 0;
    if (off) out.push({ key: 'turn', from: 0, to: 1 });
    const n = f.moves.length;
    let joined = -1;
    for (let i = off; i <= n; i++) if (pairState(f.states[i], f.pair).paired) { joined = i; break; }
    if (joined === off) out.push({ key: 'insert', from: off, to: n });
    else if (joined > off && joined < n) { out.push({ key: 'pair', from: off, to: joined }); out.push({ key: 'insert', from: joined, to: n }); }
    else {
      // joined only by the final move: the last trigger (side, top, side back) is the insert
      let cut = n;
      if (n - off >= 4) {
        const m = f.moves;
        if (Cube.MOVES[m[n - 2]].base === 'U' && m[n - 1] === Cube.invertMove(m[n - 3])) cut = n - 3;
      }
      if (cut > off) out.push({ key: 'pair', from: off, to: cut });
      out.push({ key: 'insert', from: cut, to: n });
    }
    return out;
  }

  function holdLine() {
    const st = S.cube;
    const U = Cube.colorOf(st, 'U'), F = Cube.colorOf(st, 'F');
    $('#hold').innerHTML = (S.practice ? '<span class="tag">Practice</span>' : '') + `${chip(U)} top <span class="sep">·</span> ${chip(F)} front`;
    $('#hold').setAttribute('aria-label', `Hold ${NAME[U]} on top and ${NAME[F]} in front`);
  }
  function focusFor(flow) {
    if (!flow) return null;
    return new Set(flow.focus);
  }
  // The white cross stays in color while a pair is solved, so you can watch it leave and return.
  function keepFor(flow) {
    if (!flow || flow.kind !== 'pair') return null;
    const st = flow.start;
    return new Set(Cube.CROSS.map(e => e.faces.map(f => Cube.colorOf(st, f)).sort().join('')));
  }
  // The bottom face, drawn as if seen through the cube from above (front at the bottom),
  // so the white cross can be watched while the cube is viewed from the top.
  function renderBottom() {
    const st = S.cube, host = $('#bm-grid');
    if (!st || !host) return;
    const D = Cube.FACES.indexOf('D') * 9;
    let html = '';
    for (let i = 0; i < 3; i++) for (let c = 0; c < 3; c++) html += `<i style="background:${HEX[st[D + (2 - i) * 3 + c]]}"></i>`;
    host.innerHTML = html;
    const ok = Cube.crossSolved(st);
    const label = $('#bm-label');
    label.textContent = ok ? 'Cross ✓' : 'Cross out';
    label.className = 'bm-label ' + (ok ? 'ok' : 'out');
    $('#bottom-map').setAttribute('aria-label', ok ? `Bottom view: the ${NAME[D_COLOR(st)]} cross is complete` : `Bottom view: part of the ${NAME[D_COLOR(st)]} cross is out of place`);
  }
  function paint() {
    view3d.setState(S.cube, focusFor(S.flow), keepFor(S.flow));
    renderBottom();
    view3d.setSlot(S.flow && S.flow.kind === 'pair' ? slotOfPair(S.cube, S.flow.pair) : null);
    holdLine();
  }
  function saveCube() { store.set('cube', S.cube.join('')); }

  // ---------- pairs list ----------
  function pairKeyColors(st, slot) { return Cube.SLOTS[slot].edgeFaces.map(f => Cube.colorOf(st, f)); }
  // A top view of the cube (front at the bottom) with the slot's corner filled in.
  function slotMap(slot, solved) {
    const at = { BL: [3, 3], BR: [16, 3], FL: [3, 16], FR: [16, 16] };
    return '<svg class="map" viewBox="0 0 30 30" aria-hidden="true"><rect x="1" y="1" width="28" height="28" rx="7" fill="#f0f1f4"/>' +
      Object.keys(at).map(k => `<rect x="${at[k][0]}" y="${at[k][1]}" width="11" height="11" rx="3" fill="${k === slot ? (solved ? '#0f7a45' : '#121318') : '#dcdfe5'}"/>`).join('') + '</svg>';
  }
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
    S.pairs = {}; S.pairList = list;
    list.forEach(p => { S.pairs[p.key] = p; });
    renderPairs(list, crossOk);
    if (!crossOk) {
      const D = D_COLOR(st);
      $('#cross-text').innerHTML = `The ${NAME[D]} cross on the bottom isn't finished yet. Do it first; the pairs build on it. <span class="spin"></span>`;
      const r = await Solver.call({ op: 'cross', state: st });
      if (v !== S.pairsVersion) return;
      $('#cross-text').textContent = `The ${NAME[D]} cross on the bottom isn't finished yet. It takes ${r.optimal} moves; the pairs build on it.`;
      return;
    }
    for (const p of list) {
      if (p.solved) continue;
      const r = await Solver.call({ op: 'pair', state: st, slot: p.slot, mode: S.settings.rotate ? 'rotate' : 'inplace' });
      if (v !== S.pairsVersion) return;
      p.len = r.solutions && r.solutions.length ? r.solutions[0].len : r.optimal;
      renderPairs(list, crossOk);
    }
    setControls();
  }
  function bestPair() {
    const open = S.pairList.filter(p => !p.solved && p.len != null);
    return open.length ? open.reduce((a, b) => (b.len < a.len ? b : a)) : null;
  }
  function pairName(pair) { return `${cap(NAME[pair[0]])}–${NAME[pair[1]]}`; }
  function renderPairs(list, crossOk) {
    const host = $('#pairs');
    const open = list.filter(p => !p.solved);
    const best = bestPair();
    const done = list.length - open.length;
    $('#pairs-status').textContent = done === 4 ? 'All done' : `${done} of 4 done`;
    host.innerHTML = '';
    list.forEach(p => {
      const b = document.createElement('button');
      b.className = 'pair' + (p.solved ? ' solved' : '');
      b.setAttribute('aria-pressed', String(!!S.flow && S.flow.key === p.key));
      let meta;
      if (p.solved) meta = 'Done';
      else if (!crossOk) meta = 'After the cross';
      else if (p.len == null) meta = '<span class="spin"></span>';
      else meta = `<b>${p.len} moves</b>${best && best.key === p.key && open.length > 1 ? '<span class="badge">Fastest</span>' : ''}`;
      b.innerHTML = `${slotMap(p.slot, p.solved)}<span class="nm">${chip(p.pair[0])}${chip(p.pair[1])} ${pairName(p.pair)}</span><span class="meta">${meta}</span>`;
      b.setAttribute('aria-label', `${pairName(p.pair)} pair, ${SLOT_WORD[p.slot]} slot, ${p.solved ? 'done' : p.len != null ? p.len + ' moves' : ''}`);
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
      title: `${chip(pair[0])}${chip(pair[1])} ${pairName(pair)} pair`,
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
    if (window.innerWidth < 900) $('#flow-card').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
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
    const restarting = f.idx > 0;
    f.sel = i;
    f.moves = (f.rotation ? [f.rotation] : []).concat(f.solutions[i].moves);
    f.states = [f.start];
    f.moves.forEach(m => f.states.push(Cube.applyMove(f.states[f.states.length - 1], m)));
    f.phases = phasesFor(f);
    f.idx = 0;
    S.cube = f.start; saveCube();
    if (restarting) toast('Back to the start of this pair');
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
    document.querySelectorAll('#pairs .pair').forEach((b, i) => {
      const p = S.pairList[i];
      b.setAttribute('aria-pressed', String(!!(S.flow && p && S.flow.key === p.key)));
    });
  }
  function renderFlow() {
    const f = S.flow;
    $('#flow-card').hidden = !f;
    $('#player').hidden = !f;
    $('#tap-hint').hidden = !!f;
    $('#stage').classList.toggle('flowing', !!f);
    view3d.setPad(f ? $('#player').offsetHeight + 20 : 56);
    if (!f) return;
    $('#flow-title').innerHTML = f.title;
    if (f.loading) {
      $('#flow-case').innerHTML = '<span class="spin"></span> Working out the quickest way…';
      $('#phases').innerHTML = ''; $('#opts').innerHTML = ''; $('#others').hidden = true;
      $('#cap-move').textContent = '…'; $('#cap-move').className = 'mv-big';
      $('#cap-text').textContent = 'Working it out'; $('#cap-phase').textContent = ''; $('#cap-count').textContent = ''; $('#cap-why').textContent = '';
      setControls();
      return;
    }
    const caseState = f.rotation ? Cube.applyMove(f.start, f.rotation) : f.start;
    $('#flow-case').textContent = f.kind === 'pair'
      ? caseLine(caseState, f.pair)
      : `${Cube.trackCross(f.start).filter((x, k) => x === Cube.CROSS[k].st).length} of 4 edges are already home.`;
    // other ways: the shortest one and one more, tucked away
    const sols = f.solutions;
    const shortest = sols.reduce((a, x) => (x.len < a.len ? x : a), sols[0]);
    let shown = sols.slice(0, 3);
    if (!shown.includes(shortest)) shown = [sols[0], sols[1], shortest];
    $('#others').hidden = shown.length < 2;
    $('#opts').innerHTML = '';
    shown.forEach(s => {
      const i = sols.indexOf(s);
      const b = document.createElement('button');
      b.className = 'opt';
      b.setAttribute('aria-pressed', String(i === f.sel));
      const tag = i === 0 ? 'Recommended' : s === shortest && s.len < sols[0].len ? 'Shortest' : 'Also good';
      b.innerHTML = `<span class="n">${s.len} moves<br>${tag}</span><span class="alg">${s.moves.join(' ')}</span>`;
      b.addEventListener('click', () => { if (!S.busy && f.sel !== i) { stopPlay(); selectSolution(i); } });
      $('#opts').appendChild(b);
    });
    renderPhases();
    setControls();
  }
  function phaseAt(f, i) { return f.phases.find(p => i >= p.from && i < p.to) || f.phases[f.phases.length - 1]; }
  function renderPhases() {
    const f = S.flow, host = $('#phases');
    host.innerHTML = '';
    const cur = f.idx < f.moves.length ? phaseAt(f, f.idx) : null;
    f.phases.forEach((ph, n) => {
      const li = document.createElement('li');
      const state = f.idx >= ph.to ? 'done' : ph === cur ? 'now' : '';
      li.className = 'phase ' + state;
      const info = PHASE[ph.key];
      li.innerHTML = `<span class="num">${state === 'done' ? '✓' : n + 1}</span><span class="ph-name">${info.name}${state === 'now' ? `<span class="ph-why">${info.why}</span>` : ''}</span>`;
      const row = document.createElement('div');
      row.className = 'moves';
      // "side, top, side back" triggers are boxed so the pattern stands out
      for (let k = ph.from; k < ph.to;) {
        const m = f.moves;
        const trig = k + 2 < ph.to && !isTurn(m[k]) && Cube.MOVES[m[k]].base !== 'U' && Cube.MOVES[m[k + 1]].base === 'U' && m[k + 2] === Cube.invertMove(m[k]);
        if (trig) {
          const box = document.createElement('span');
          box.className = 'trig';
          box.title = 'Trigger: side up, top, side back';
          for (let j = k; j < k + 3; j++) box.appendChild(moveChip(j));
          row.appendChild(box); k += 3;
        } else { row.appendChild(moveChip(k)); k++; }
      }
      li.appendChild(row);
      host.appendChild(li);
    });
  }
  function moveChip(k) {
    const f = S.flow;
    const b = document.createElement('button');
    const turn = isTurn(f.moves[k]);
    b.className = 'mv' + (turn ? ' turn' : '') + (k < f.idx ? ' done' : k === f.idx ? ' now' : '');
    if (turn) b.innerHTML = `${chip(frontAfter(f, k))} ${cap(NAME[frontAfter(f, k)])} front`;
    else b.textContent = f.moves[k];
    b.title = stepText(f, k);
    b.setAttribute('aria-label', `Step ${k + 1}: ${stepText(f, k)}`);
    b.addEventListener('click', () => goTo(k));
    return b;
  }
  const ICON_PLAY = '<path d="M7 5v14l11-7z"/>', ICON_PAUSE = '<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/>';
  const ICON_NEXT = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>';
  function setControls() {
    const f = S.flow;
    if (!f) return;
    const loading = f.loading, end = !loading && f.idx >= f.moves.length;
    $('#btn-prev').disabled = loading || S.busy || f.idx === 0;
    $('#btn-play').disabled = loading || end;
    $('#ico-play').innerHTML = S.playing ? ICON_PAUSE : ICON_PLAY;
    $('#btn-play').setAttribute('aria-label', S.playing ? 'Pause' : 'Play the rest');
    const next = $('#btn-next');
    next.disabled = loading || (S.busy && !S.playing);
    next.classList.toggle('good', end);
    next.classList.toggle('primary', !end);
    if (!end) { next.innerHTML = `Next move ${ICON_NEXT}`; return; }
    const best = bestPair();
    const allDone = S.pairList.length && S.pairList.every(p => p.solved);
    if (allDone) { next.innerHTML = S.practice ? `New practice cube ${ICON_NEXT}` : 'All four pairs done'; next.disabled = !S.practice; return; }
    next.innerHTML = best ? `Next pair: ${pairName(best.pair)} ${ICON_NEXT}` : 'Pick the next pair';
    next.disabled = !best;
  }
  function onNext() {
    const f = S.flow;
    if (!f) return;
    stopPlay();
    if (f.idx < f.moves.length) { step(1); return; }
    const best = bestPair();
    if (best) startPair(best.pair);
    else if (S.practice && S.pairList.every(p => p.solved)) loadPractice();
  }
  // Caption, arrow, slot marker and camera for the current position in the flow.
  function afterStep(prevIdx) {
    const f = S.flow;
    if (!f || f.loading) return;
    const next = f.moves[f.idx];
    const n = f.moves.length;
    const capMove = $('#cap-move');
    let event = '';
    if (f.kind === 'pair') {
      const p = pairState(f.states[f.idx], f.pair);
      const was = prevIdx != null ? pairState(f.states[prevIdx], f.pair) : null;
      if (p.paired && !p.solved && was && !was.paired && prevIdx < f.idx) event = '✓ Corner and edge joined';
    }
    if (next) {
      const ph = phaseAt(f, f.idx);
      if (isTurn(next)) { capMove.innerHTML = TURN_ICON; capMove.className = 'mv-big rot'; }
      else { capMove.textContent = next; capMove.className = 'mv-big'; }
      $('#cap-text').textContent = stepText(f, f.idx);
      $('#cap-why').textContent = stepWhy(f, f.idx);
      $('#cap-phase').innerHTML = event ? `<span class="event">${event}</span>` : PHASE[ph.key].name;
      $('#cap-count').textContent = `${f.idx + 1} of ${n}`;
    } else {
      capMove.textContent = '✓'; capMove.className = 'mv-big fin';
      $('#cap-text').textContent = f.kind === 'pair' ? 'Pair inserted' : 'Cross done';
      $('#cap-why').textContent = f.kind === 'pair' ? `The ${NAME[D_COLOR(S.cube)]} cross is complete and the slot is filled.` : 'Now the pairs can go in.';
      $('#cap-phase').innerHTML = `<span class="event">${n} moves</span>`;
      $('#cap-count').textContent = '';
    }
    view3d.showArrow(next || null);
    view3d.setSlot(f.kind === 'pair' && !(f.idx === n) ? slotOfPair(S.cube, f.pair) : null);
    // the back layer turns out of sight from the usual view: swing round for it, then back
    if (next && Cube.MOVES[next].base === 'B') { view3d.lookFrom(Math.PI - view3d.HOME.theta, view3d.HOME.phi, 450); view3d.swung = true; }
    else if (view3d.swung) { view3d.lookFrom(view3d.HOME.theta, view3d.HOME.phi, 450); view3d.swung = false; }
    renderPhases();
    setControls();
    if (f.idx === n) refreshPairs();
  }
  async function step(dir, fast) {
    const f = S.flow;
    if (!f || f.loading || S.busy) return false;
    const from = f.idx, to = from + dir;
    if (to < 0 || to > f.moves.length) return false;
    S.busy = true; setControls();
    view3d.clearArrow();
    const m = dir > 0 ? f.moves[from] : Cube.invertMove(f.moves[to]);
    if ('xyz'.includes(Cube.MOVES[m].base)) view3d.setSlot(null);
    const ms = fast ? Math.min(180, S.settings.speed) : S.settings.speed;
    await view3d.turn(m, ms, () => {
      f.idx = to; S.cube = f.states[to];
      view3d.setState(S.cube, focusFor(f), keepFor(f));
      renderBottom();
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
      if (S.playing) await sleep(280);
    }
    S.playing = false; setControls();
  }
  function stopPlay() { S.playing = false; if (S.flow) setControls(); }

  async function manualMove(m) {
    if (S.busy) return;
    if (S.flow) { S.flow = null; renderFlow(); view3d.clearArrow(); view3d.setSlot(null); }
    S.busy = true;
    S.history.push(S.cube);
    const next = Cube.applyMove(S.cube, m);
    await view3d.turn(m, Math.min(S.settings.speed, 300), () => { S.cube = next; view3d.setState(S.cube, null); renderBottom(); });
    S.busy = false;
    holdLine(); saveCube(); refreshPairs();
  }

  function onTapSticker(idx) {
    if (S.busy) return;
    const r = Cube.slotForSticker(S.cube, idx);
    if (r.slot) {
      const pair = pairKeyColors(S.cube, r.slot);
      if (Cube.slotSolved(S.cube, r.slot)) { toast(`${pairName(pair)} is already in place.`); return; }
      if (S.flow && S.flow.key === pair.slice().sort().join('')) return;
      startPair(pair);
    } else if (r.kind === 'cross') toast(Cube.crossSolved(S.cube) ? 'That\'s a cross edge, already in place.' : 'That\'s a cross edge. Start with "Show the cross moves".');
    else if (r.kind === 'last') toast('That piece belongs to the last layer, not to a pair.');
  }

  // A practice position: white cross solved, all four pairs scattered. Made only from
  // "turn a side, move the top, turn the side back" sequences, which never disturb the cross.
  function randomPracticeCube() {
    const rand = n => Math.floor(Math.random() * n);
    for (let attempt = 0; attempt < 60; attempt++) {
      let st = Cube.solvedFromCenters(STD_LAYOUT);
      for (let i = 0; i < 12; i++) {
        const side = ['R', 'L', 'F', 'B'][rand(4)] + ['', "'"][rand(2)];
        st = Cube.applyAlg(st, [side, ['U', "U'", 'U2'][rand(3)], Cube.invertMove(side), ['U', "U'", 'U2'][rand(3)]]);
      }
      st = canonical(st);
      if (['FR', 'FL', 'BR', 'BL'].every(sl => !Cube.slotSolved(st, sl))) return st;
    }
    return null;
  }
  function loadPractice() {
    const st = randomPracticeCube();
    if (!st) return;
    if (S.mode === 'scan') Scan.stopCamera();
    loadCube(st, { practice: true });
    toast('Practice cube: pick any pair');
  }

  // Load a cube into the solve screen with the intro spin.
  function loadCube(state, opts) {
    S.cube = state; S.flow = null; S.history = [];
    S.practice = !!(opts && opts.practice);
    store.set('practice', S.practice);
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
      if (this.needColor) return this.retaking ? `Retake: show the ${NAME[this.needColor]} side again` : `One more: show the ${NAME[this.needColor]}-center side`;
      return n === 0 ? 'Show any side of your cube' : `Side ${n + 1} of 5 · turn to a new side`;
    },
    prompt() {
      const t = this.nextText();
      $('#vf-empty-title').textContent = t;
      $('#vf-empty-text').textContent = this.problem
        ? 'Tap a side marked below to check its colors again.'
        : this.blocked
          ? (window.top !== window
            ? 'The Claude app doesn\u2019t allow live video here, so take a photo of each side instead.'
            : 'Camera access is off. Allow it for this site to scan live, or take a photo of each side.')
            + ' Hold the cube straight on.'
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
      $('#face-count').textContent = `${this.count()} of ${this.needColor || this.problem ? 6 : 5}`;
    },
    // Which color is this sample? Each confirmed side's center shows how this camera sees
    // that color; colors without a confirmed side use a standard shade. (Only centers are
    // used: a sticker confirmed by mistake must not teach the reader the wrong color.)
    read(rgb) {
      const lab = Vision.toLab(rgb);
      let best = null, bd = Infinity;
      for (const c of Vision.COLORS) {
        const f = this.faces[c];
        let ref = Vision.toLab(Vision.DEFAULT_RGB[c]);
        if (f) ref = c === 'W' ? f.labs[4].map((v, k) => (v + ref[k]) / 2) : f.labs[4];
        const d = Vision.colorCost(lab, ref, c === 'W');
        if (d < bd) { bd = d; best = c; }
      }
      return best;
    },

    // Read a new side together with the sides already captured: every color matched to the
    // centers seen so far, at most 9 of each. Squares the user set by hand stay as set.
    readFace(samples) {
      const center = this.read(samples[4]);
      const all = {}, fixed = {};
      for (const c in this.faces) {
        if (c === center) continue;
        all[c] = this.faces[c].samples;
        fixed[c] = {}; this.faces[c].edited.forEach(i => { fixed[c][i] = this.faces[c].labels[i]; });
      }
      all[center] = samples;
      return Vision.classify(all, fixed).grids[center];
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
      // a touch darker than auto exposure keeps bright stickers from washing out (where the phone allows it)
      try {
        const track = this.stream.getVideoTracks()[0];
        const caps = track.getCapabilities ? track.getCapabilities() : {};
        if (caps.exposureCompensation) track.applyConstraints({ advanced: [{ exposureCompensation: Math.max(caps.exposureCompensation.min, -0.7) }] }).catch(() => {});
      } catch (e) { /* not supported */ }
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
      const stats = {};
      const samples = Vision.sampleFace(W, det.quad, stats);
      const labels = samples.map(x => this.read(x));
      const side = sides[0];
      const mid = qq => [(qq[0][0] + qq[2][0]) / 2, (qq[0][1] + qq[2][1]) / 2];
      const moved = this.stable ? Math.hypot(mid(q)[0] - mid(this.stable.quad)[0], mid(q)[1] - mid(this.stable.quad)[1]) : Infinity;
      // steady = the face stays put and mostly reads the same (a square or two may flicker;
      // the median over the steady frames settles them)
      const agree = this.stable ? labels.filter((l, i) => l === this.stable.labels[i]).length : 0;
      const steady = square && det.score >= 13;
      if (steady && this.stable && moved < side * 0.1 && agree >= 6) { this.stable.n++; this.stable.frames.push(samples); }
      else this.stable = steady ? { n: 1, frames: [samples] } : null;
      if (this.stable) this.stable.labels = labels;
      if (this.stable) this.stable.quad = det.quad;
      const need = 7, progress = this.stable ? Math.min(1, this.stable.n / need) : 0;
      this.drawOverlay(o, dpr, g, det.quad.map(toScreen), labels, progress);
      if (!square) { this.setMsg('Turn the side so it faces the camera straight on'); return; }
      if (stats.clipped > 0.35) { this.stable = null; this.setMsg('Too bright \u00b7 tilt the cube away from the light'); return; }
      const have = this.faces[labels[4]];
      const sameAs = f => [0, 1, 2, 3].some(k => { let g = f.labels; for (let t = 0; t < k; t++) g = [6, 3, 0, 7, 4, 1, 8, 5, 2].map(i => g[i]); return g.filter((x, i) => x === labels[i]).length >= 6; });
      if (have && sameAs(have)) {
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
      this.openReview(snap, det.quad, med, this.readFace(med), null);
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
        this.openReview(cv, quad, samples, this.readFace(samples), null);
        if (!det) { this.review.note = 'The grid may be off. Check every square, or retake closer and straight on.'; this.renderReview(); }
      } catch (e) { toast(e.message); }
    },

    // ----- check and confirm -----
    openReview(cv, quad, samples, labels, editing) {
      this.review = { cv, quad, samples, labels: labels.slice(), sel: -1, editing, edited: new Set(editing && this.faces[editing] ? this.faces[editing].edited : []) };
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
        b.addEventListener('click', () => { r.labels[r.sel] = col; r.edited.add(r.sel); r.sel = -1; this.renderReview(); });
        pal.appendChild(b);
      });
      // a cube has 9 of each color: flag a side that would push a color past that
      const counts = {};
      for (const k in this.faces) if (k !== r.editing && k !== c) this.faces[k].labels.forEach(x => { counts[x] = (counts[x] || 0) + 1; });
      r.labels.forEach(x => { counts[x] = (counts[x] || 0) + 1; });
      const over = Vision.COLORS.filter(x => counts[x] > 9);
      const hint = $('#rv-hint');
      if (r.sel >= 0) { hint.textContent = 'Pick the right color for that square.'; hint.className = 'small'; }
      else if (over.length) {
        const x = over[0], look = { Y: 'orange or white', O: 'red or yellow', R: 'orange', W: 'yellow', G: 'blue', B: 'green' }[x];
        hint.textContent = `That makes ${counts[x]} ${NAME[x]}; a cube has 9. Some may be ${look}. Tap them to fix.`;
        hint.className = 'small warn-text';
      } else { hint.textContent = r.note || 'Do these match your cube? Tap a square to fix it.'; hint.className = 'small'; }
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
      this.faces[c] = { labels: r.labels.slice(), samples: r.samples, labs: r.samples.map(Vision.toLab), cv: r.cv, quad: r.quad, edited: Array.from(r.edited) };
      this.review = null;
      if (this.problem) this.problem.delete(c);
      if (this.problem && !this.problem.size) this.problem = null;
      if (this.needColor && this.faces[this.needColor]) { this.needColor = null; this.retaking = false; }
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
      // read all stickers together (9 of each color), keeping squares the user set by hand;
      // fall back to the colors exactly as confirmed
      const samples = {}, fixed = {}, confirmed = {};
      for (const c in this.faces) {
        const f = this.faces[c];
        samples[c] = f.samples; confirmed[c] = f.labels.slice();
        fixed[c] = {}; f.edited.forEach(i => { fixed[c][i] = f.labels[i]; });
      }
      let o = Cube.orientFromPhotos(Vision.classify(samples, fixed).grids, STD_LAYOUT);
      if (!o.valid) { const o2 = Cube.orientFromPhotos(confirmed, STD_LAYOUT); if (o2.valid) o = o2; }
      if (!o.valid && n === 6) { const fixedState = Cube.repair(o); if (fixedState) o = { valid: true, state: fixedState }; }
      const suspects = [];
      if (!o.valid && n === 6) {
        // one badly captured side shouldn't block everything: leave each out in turn and
        // accept only if exactly one cube comes out; the sides that make it work are suspects
        const found = new Map();
        for (const skip in this.faces) {
          const s5 = {}, f5 = {};
          for (const c in samples) if (c !== skip) { s5[c] = samples[c]; f5[c] = fixed[c]; }
          const r = Cube.orientFromPhotos(Vision.classify(s5, f5).grids, STD_LAYOUT);
          if (r.valid) { found.set(r.state.join(''), r); suspects.push(skip); }
        }
        if (found.size === 1) o = Array.from(found.values())[0];
      }
      if (o.valid) {
        this.stopCamera();
        loadCube(canonical(o.state));
        toast(o.inferred ? `Got it. The ${NAME[o.inferred]} side was worked out from the others.` : 'Got it. Hold your cube as shown.');
        return true;
      }
      if (n === 5) { this.needColor = Vision.COLORS.find(c => !this.faces[c]); return false; }
      // six faces that don't fit: mark the sides holding the pieces that don't fit, and open
      // the final check so the user can fix the few stickers at fault before solving
      const perSide = {};
      if (o.check && o.layout) o.check.bad.forEach(i => { const c = o.layout[Math.floor(i / 9)]; perSide[c] = (perSide[c] || 0) + 1; });
      const ranked = suspects.length ? suspects : Object.keys(perSide).sort((a, b) => perSide[b] - perSide[a]);
      this.problem = new Set(ranked.length ? ranked : Object.keys(this.faces));
      this.renderFaces();
      if (o.state) Final.open(o.state, ranked[0] || null);
      return false;
    },
  };
  // ---------- final check: the whole cube laid flat, when the scan doesn't add up ----------
  const NET_AT = { U: [0, 3], L: [3, 0], F: [3, 3], R: [3, 6], B: [3, 9], D: [6, 3] };
  const Final = {
    state: null, sel: -1,
    // `suspect`: the side most likely misread, offered for a retake
    open(state, suspect) {
      this.state = state.slice(); this.sel = -1; this.suspect = suspect || null;
      $('#final').hidden = false;
      this.render();
    },
    close() { $('#final').hidden = true; },
    render() {
      const st = this.state, v = Cube.validate(st), bad = new Set(v.bad);
      const counts = {};
      st.forEach(c => { counts[c] = (counts[c] || 0) + 1; });
      const over = Vision.COLORS.filter(c => counts[c] > 9), under = Vision.COLORS.filter(c => (counts[c] || 0) < 9);
      let msg;
      if (v.valid) msg = 'Everything fits. Your cube is ready.';
      else if (over.length || under.length) msg = `<b>${over.map(c => `${counts[c]} ${NAME[c]}`).join(', ')}</b>${over.length && under.length ? ' but only ' : ''}<b>${under.map(c => `${counts[c] || 0} ${NAME[c]}`).join(', ')}</b>. A cube has 9 of each. The outlined stickers don't fit; tap one to change it.`;
      else if (bad.size) msg = 'The outlined stickers make pieces that don\u2019t exist. One of them is probably misread; tap it to change it.';
      else msg = `Every piece exists, but they can't sit like this (${v.reason.toLowerCase().replace(/\.$/, '')}). A side was probably captured turned. Rescan the side you're least sure of.`;
      if (!v.valid && this.suspect) msg = `The <b>${NAME[this.suspect]}</b> side was probably misread. Retake it, or tap an outlined sticker to fix it.`;
      $('#final-msg').innerHTML = msg;
      const net = $('#net');
      net.innerHTML = '';
      Cube.STICKERS.forEach(s => {
        const b = document.createElement('button');
        const [r0, c0] = NET_AT[s.face];
        b.style.gridRow = r0 + s.r + 1; b.style.gridColumn = c0 + s.c + 1;
        b.style.background = HEX[st[s.i]];
        const center = s.r === 1 && s.c === 1;
        b.className = center ? 'center' : bad.has(s.i) ? 'bad' : '';
        b.setAttribute('aria-pressed', String(this.sel === s.i));
        b.setAttribute('aria-label', `${FACE_WORD[s.face]} side, row ${s.r + 1}, column ${s.c + 1}: ${NAME[st[s.i]]}`);
        if (!center) b.addEventListener('click', () => { this.sel = this.sel === s.i ? -1 : s.i; this.render(); });
        net.appendChild(b);
      });
      const pal = $('#final-palette');
      pal.hidden = this.sel < 0;
      pal.innerHTML = '';
      if (this.sel >= 0) Vision.COLORS.forEach(c => {
        const b = document.createElement('button');
        b.style.background = HEX[c];
        b.setAttribute('aria-label', 'Make it ' + NAME[c]);
        b.addEventListener('click', () => { this.state[this.sel] = c; this.sel = -1; this.render(); });
        pal.appendChild(b);
      });
      const go = $('#final-go'), again = $('#final-rescan');
      go.disabled = !v.valid;
      go.className = 'btn ' + (v.valid ? 'primary' : '');
      again.className = 'btn ' + (v.valid ? '' : 'primary');
      again.innerHTML = this.suspect ? `${chip(this.suspect)} Retake ${NAME[this.suspect]} side` : 'Rescan a side';
    },
    // back to the camera for just the suspect side
    retake() {
      this.close();
      const c = this.suspect;
      if (!c) { toast('Tap a marked side to check it again'); return; }
      delete Scan.faces[c];
      Scan.problem = null; Scan.needColor = c; Scan.retaking = true; Scan.stable = null;
      Scan.renderFaces(); Scan.prompt();
      if (Scan.blocked) $('#in-capture').click();
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
    $('#final-close').addEventListener('click', () => Final.close());
    $('#btn-random').addEventListener('click', () => loadPractice());
    $('#btn-random-scan').addEventListener('click', () => loadPractice());
    $('#final-rescan').addEventListener('click', () => Final.retake());
    $('#final-go').addEventListener('click', () => { Final.close(); Scan.stopCamera(); loadCube(canonical(Final.state)); toast('Got it. Hold your cube as shown.'); });
    $('#btn-restart-scan').addEventListener('click', () => { Scan.enter(); toast('Starting over'); });
    $('#rv-retake').addEventListener('click', () => Scan.retake());
    $('#rv-photo').addEventListener('click', e => Scan.tapPhoto(e));
    new ResizeObserver(() => { if (Scan.review) Scan.drawReviewPhoto(); }).observe($('#rv-photo'));
    $('#btn-cross').addEventListener('click', () => startCross());
    $('#btn-close-flow').addEventListener('click', () => closeFlow());
    $('#btn-next').addEventListener('click', () => onNext());
    $('#btn-prev').addEventListener('click', () => { stopPlay(); step(-1); });
    $('#btn-play').addEventListener('click', () => play());
    $('#btn-view').addEventListener('click', () => { view3d.lookFrom(view3d.HOME.theta, view3d.HOME.phi, 500); view3d.swung = false; });
    $('#btn-undo').addEventListener('click', () => {
      if (S.busy || !S.history.length) return;
      if (S.flow) { S.flow = null; renderFlow(); view3d.clearArrow(); }
      S.cube = S.history.pop(); paint(); saveCube(); refreshPairs();
    });
    const rot = $('#opt-rotate'), spd = $('#opt-speed');
    rot.checked = S.settings.rotate; spd.value = S.settings.speed;
    const saveSettings = () => store.set('settings', S.settings);
    rot.addEventListener('change', () => { S.settings.rotate = rot.checked; saveSettings(); const f = S.flow; if (f && f.kind === 'pair') { S.cube = f.start; startPair(f.pair); } else refreshPairs(); });
    spd.addEventListener('input', () => { S.settings.speed = +spd.value; saveSettings(); });
    document.addEventListener('keydown', e => {
      if (S.mode !== 'cube' || e.target.closest('input,select,textarea')) return;
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); stopPlay(); step(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); stopPlay(); step(-1); }
    });
    new ResizeObserver(() => { if (S.flow) view3d.setPad($('#player').offsetHeight + 20); }).observe($('#player'));
    buildPad();
  }

  async function init() {
    window.F2L = { S, Scan, Final }; // handy for debugging from the console
    document.querySelectorAll('.app-version').forEach(el => { el.textContent = 'Version ' + (APP_VERSION.startsWith('__') ? 'preview' : APP_VERSION); });
    view3d = new Cube3D($('#stage'), onTapSticker);
    wire();
    Solver.call({ op: 'warm' });
    const saved = store.get('cube', null);
    if (saved && saved.length === 54 && Cube.validate(saved.split('')).valid) {
      loadCube(canonical(saved.split('')), { practice: store.get('practice', false) });
      return;
    }
    // No cube of yours yet: open straight on the scanner.
    S.cube = null;
    setMode('scan');
  }
  init();
})();
