// Builds two outputs from index.html + js/:
//   dist/f2l-pair-coach.html  one self-contained file (3D library, solver, scanner inlined)
//   docs/                     the same page for GitHub Pages, plus offline support and a
//                             home-screen icon so it opens like an app
// Run: node build-single.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const here = f => new URL(f, import.meta.url);
const read = f => readFileSync(here(f), 'utf8');
const safe = js => js.replace(/<\/script/gi, '<\\/script');
const inline = (js, id) => `<script${id ? ` id="${id}"` : ''}>\n${safe(js)}\n</script>`;

let page = read('./index.html');
const swap = (tag, html) => {
  if (!page.includes(tag)) throw new Error('Missing ' + tag);
  page = page.replace(tag, () => html);
};
const workerBody = read('./js/solver-worker.js').replace(/^importScripts\(.*\);\s*$/m, '');
swap('<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>', inline(read('./vendor/three.r128.min.js')));
swap('<script src="js/cube.js"></script>', inline(read('./js/cube.js'), 'cube-src') +
  `\n<script>window.SOLVER_WORKER_URL = URL.createObjectURL(new Blob([document.getElementById('cube-src').textContent, ${safe(JSON.stringify(workerBody))}], { type: 'text/javascript' }));</script>`);
swap('<script src="js/vision.js"></script>', inline(read('./js/vision.js')));
const stamp = new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
swap('<script src="js/app.js"></script>', inline(read('./js/app.js').replace('__APP_VERSION__', stamp)));

const base = '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
  '<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>';

// 1) single file
mkdirSync(here('./dist/'), { recursive: true });
const single = `<!doctype html><html lang="en"><head>${base}</head><body>${page}</body></html>`;
writeFileSync(here('./dist/f2l-pair-coach.html'), single);
console.log('dist/f2l-pair-coach.html', (single.length / 1024).toFixed(0) + ' KB');

// 2) GitHub Pages site
mkdirSync(here('./docs/'), { recursive: true });
const appHead = base +
  '<meta name="theme-color" content="#ffffff"><meta name="apple-mobile-web-app-capable" content="yes">' +
  '<meta name="apple-mobile-web-app-title" content="F2L Coach"><meta name="apple-mobile-web-app-status-bar-style" content="default">' +
  '<link rel="manifest" href="manifest.webmanifest"><link rel="apple-touch-icon" href="apple-touch-icon.png"><link rel="icon" href="icon-192.png">';
const register = `<script>if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});</script>`;
const site = `<!doctype html><html lang="en"><head>${appHead}</head><body>${page}${register}</body></html>`;
writeFileSync(here('./docs/index.html'), site);
writeFileSync(here('./docs/manifest.webmanifest'), JSON.stringify({
  name: 'F2L Pair Coach', short_name: 'F2L Coach', start_url: '.', scope: '.', display: 'standalone',
  background_color: '#ffffff', theme_color: '#ffffff',
  icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' }, { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }],
}, null, 2));
writeFileSync(here('./docs/sw.js'), read('./js/offline-sw.js').replace('__VERSION__', String(Date.now())));
writeFileSync(here('./docs/.nojekyll'), '');
for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) writeFileSync(here('./docs/' + name), icon(size));
console.log('docs/ ready');

// App icon: four cube tiles (green, red, blue, yellow) on white, drawn straight into a PNG.
function icon(n) {
  const tiles = [[0x19, 0xb2, 0x4b], [0xda, 0x1f, 0x2d], [0x16, 0x63, 0xe8], [0xff, 0xd6, 0x0a]];
  const raw = Buffer.alloc((n * 4 + 1) * n);
  const pad = n * 0.2, gap = n * 0.04, t = (n - 2 * pad - gap) / 2, r = t * 0.22;
  for (let y = 0; y < n; y++) {
    raw[y * (n * 4 + 1)] = 0;
    for (let x = 0; x < n; x++) {
      let c = [255, 255, 255];
      for (let k = 0; k < 4; k++) {
        const x0 = pad + (k % 2) * (t + gap), y0 = pad + (k >> 1) * (t + gap);
        const dx = Math.max(x0 + r - x, 0, x - (x0 + t - r)), dy = Math.max(y0 + r - y, 0, y - (y0 + t - r));
        if (x >= x0 && x < x0 + t && y >= y0 && y < y0 + t && dx * dx + dy * dy <= r * r) c = tiles[k];
      }
      raw.set([...c, 255], y * (n * 4 + 1) + 1 + x * 4);
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(n, 0); ihdr.writeUInt32BE(n, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function crc32(buf) {
  let c = ~0;
  for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return ~c >>> 0;
}
