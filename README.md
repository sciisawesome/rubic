# F2L Pair Coach

Learn CFOP's F2L on your own cube. Point your phone at each side, confirm the colors, then
pick a corner–edge pair and step through the fastest way to insert it on a 3D cube that
turns with you.

**Open it:** https://sciisawesome.github.io/rubic/ (on iPhone: Share → Add to Home Screen
to use it like an app, also offline).

## How it works
- **Scan:** live camera view; when a side holds still the picture freezes and shows the 9
  colors it read. Tap a square to fix it, then **Correct**. Five sides are enough (the bottom
  is worked out). Hold the cube white-cross down, yellow on top.
- **Solve:** pick a pair (or tap a piece on the 3D cube). Each move shows an arrow and a
  plain-language description; triggers like `R U R'` are grouped.

## Files
- `index.html`, `js/` – the app (`cube.js` cube model and solvers, `vision.js` face
  detection and color reading, `app.js` interface, `solver-worker.js` background solver).
- `docs/` – the built site served by GitHub Pages. Rebuild with `node build-single.mjs`
  after changing the app (also writes `dist/f2l-pair-coach.html`, a single offline file).
- `vendor/three.r128.min.js` – three.js (MIT), inlined by the build.
