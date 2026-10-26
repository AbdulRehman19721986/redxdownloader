/*
 * Renders the RedX brand SVGs into the PNG/ICO files used by the desktop app,
 * installer and browser extension. Run with:
 *   npx electron scripts/render-icons.cjs
 *
 * Chromium does the rasterising, so every size is crisp and transparent where
 * the artwork is transparent. Windows clamps hidden windows to a minimum size,
 * so the artwork is always drawn at the top-left of a larger canvas and the
 * exact pixel region is captured.
 */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');
const assets = path.join(root, 'assets');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'redx-icons-'));
const read = name => fs.readFileSync(path.join(assets, name), 'utf8');

const mark = read('redx-mark.svg');
const markTransparent = read('redx-mark-transparent.svg');
const horizontal = read('redx-logo-horizontal.svg');

const page = (svg, width, height, extra = '') =>
  `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:transparent;overflow:hidden}
    svg{display:block;width:${width}px;height:${height}px}
    ${extra}
  </style></head><body>${svg}</body></html>`;

let canvas;
async function capture(html, width, height) {
  if (!canvas) {
    canvas = new BrowserWindow({
      width: 1100, height: 1100, show: false, frame: false, transparent: true,
      backgroundColor: '#00000000', useContentSize: true, resizable: false,
      webPreferences: { offscreen: false, backgroundThrottling: false, sandbox: true }
    });
  }
  const file = path.join(tmpRoot, `render-${width}x${height}-${Math.random().toString(36).slice(2)}.html`);
  fs.writeFileSync(file, html, 'utf8');
  await canvas.loadFile(file);
  await new Promise(resolve => setTimeout(resolve, 90));
  const image = await canvas.webContents.capturePage({ x: 0, y: 0, width, height });
  return image.toPNG();
}

function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + images.length * 16;
  for (const { size, data } of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2); entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4); entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8); entry.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(entry);
  }
  return Buffer.concat([header, ...entries, ...images.map(i => i.data)]);
}

async function run() {
  const outputs = [];
  const write = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); outputs.push(file); };

  // Windows icon: sizes up to 32 px drop the hairline border, which turns to mush.
  const frames = [];
  for (const size of [16, 24, 32, 48, 64, 128, 256]) {
    const extra = size <= 32 ? '.rx-edge{display:none}' : '';
    frames.push({ size, data: await capture(page(mark, size, size, extra), size, size) });
  }
  write(path.join(root, 'build', 'icon.ico'), ico(frames));
  write(path.join(root, 'assets', 'app-icon.png'), frames.find(f => f.size === 256).data);
  write(path.join(root, 'assets', 'app-icon-1024.png'), await capture(page(mark, 1024, 1024), 1024, 1024));

  for (const size of [16, 32, 48, 128]) {
    const extra = size <= 32 ? '.rx-edge{display:none}' : '';
    write(path.join(root, 'extension', 'icons', `icon${size}.png`), await capture(page(mark, size, size, extra), size, size));
  }

  // Transparent lockups for documentation, the About screen and store listings.
  write(path.join(root, 'assets', 'redx-mark-512.png'), await capture(page(markTransparent, 512, 512), 512, 512));
  write(path.join(root, 'assets', 'redx-logo-horizontal.png'), await capture(page(horizontal, 600, 144), 600, 144));

  for (const file of outputs) console.log(`wrote ${path.relative(root, file)} (${fs.statSync(file).size} bytes)`);
}

app.disableHardwareAcceleration();
app.whenReady()
  .then(run)
  .then(() => { fs.rmSync(tmpRoot, { recursive: true, force: true }); app.quit(); })
  .catch(error => { console.error(error); app.exit(1); });
