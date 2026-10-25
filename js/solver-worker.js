// Runs the search off the main thread so the 3D view stays smooth.
importScripts('cube.js');
self.onmessage = e => {
  const m = e.data;
  let out;
  try {
    if (m.op === 'warm') { self.Cube.tables(); out = { ok: true }; }
    else if (m.op === 'cross') out = self.Cube.solveCross(m.state);
    else if (m.op === 'pair') out = self.Cube.solvePair(m.state, m.slot, m.mode);
    if (out && out.solutions) out.solutions = out.solutions.slice(0, 6);
  } catch (err) { out = { error: err.message }; }
  self.postMessage(Object.assign({ id: m.id }, out));
};
