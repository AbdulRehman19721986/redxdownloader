#!/usr/bin/env node
/**
 * Release gate for the RedX Downloader interface.
 *
 *   node scripts/verify-ui.cjs                 # checks the working sources
 *   node scripts/verify-ui.cjs --packaged DIR  # checks the built app (asar)
 *
 * The interface is the single most obvious regression risk for this product:
 * an older renderer inside the packaged asar looks exactly like a broken build
 * even when the download engine is fine. This script fails the release when the
 * polished shell, its assets or its scripts are missing, so `npm run dist:all`
 * cannot produce an installer that opens a different (legacy) window.
 */
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const rendererFiles = ['index.html', 'app.js', 'styles.css'];

/* Markers unique to the polished shell. If any is missing the packaged window
   is not the interface this release is supposed to ship. */
const SHELL_MARKERS = [
  ['command ribbon', 'class="ribbon"'],
  ['ribbon group separators', 'class="ribbon-sep"'],
  ['LED transfer gauge', 'id="gauge-value"'],
  ['menu bar', 'id="menubar"'],
  ['categorised sidebar', 'id="sidebar-collapse"'],
  ['data grid header', 'class="grid-head"'],
  ['status bar', 'class="statusbar"'],
  ['status bar totals', 'id="completed-count"'],
  ['transfer window streams', 'id="p-streams-title"'],
  ['transfer window details toggle', 'id="p-toggle"'],
  ['title bar version badge', 'id="brand-version"']
];

const RIBBON_COMMANDS = [
  'ribbon-add', 'ribbon-resume', 'ribbon-stop', 'ribbon-stop-all', 'ribbon-delete',
  'ribbon-delete-completed', 'ribbon-options', 'ribbon-scheduler',
  'ribbon-start-queue', 'ribbon-stop-queue'
];

const SCRIPT_MARKERS = ['function updateGauge', 'function badgeFor', 'function wireMenus', 'function renderProgress'];

const problems = [];
const notes = [];
const fail = message => problems.push(message);
const sha = buffer => crypto.createHash('sha256').update(buffer).digest('hex');

function checkShell(html, label) {
  for (const [name, marker] of SHELL_MARKERS) {
    if (!html.includes(marker)) fail(`${label}: missing ${name} (${marker})`);
  }
  for (const id of RIBBON_COMMANDS) {
    if (!html.includes(`id="${id}"`)) fail(`${label}: ribbon command missing: ${id}`);
  }
  const legacy = ['class="table-head"', 'class="ribbon-bar"'];
  for (const marker of legacy) {
    if (html.includes(marker)) fail(`${label}: legacy markup still present (${marker})`);
  }
  if (!/data-ptab="status"/.test(html)) fail(`${label}: transfer window tabs missing`);
}

function checkAssets(html, css) {
  const assetDir = path.join(root, 'assets');
  const references = new Set();
  for (const match of html.matchAll(/(?:src|href)="(?!https?:|#)([^"]+)"/g)) references.add(match[1]);
  for (const match of css.matchAll(/url\((['"]?)([^'")]+)\1\)/g)) references.add(match[2]);
  for (const reference of references) {
    if (reference.startsWith('data:')) continue;
    const resolved = path.join(root, 'renderer', reference);
    if (!fs.existsSync(resolved)) fail(`asset referenced but missing: ${reference}`);
  }
  for (const icon of ['app-icon.ico', 'app-icon.png', 'redx-logo-horizontal.svg']) {
    if (!fs.existsSync(path.join(assetDir, icon))) fail(`packaging asset missing: assets/${icon}`);
  }
  if (!html.includes('id="i-mark"')) fail('inline SVG icon sprite missing');
  notes.push(`${references.size} document/asset references resolved`);
}

function verifySources() {
  const paths = Object.fromEntries(rendererFiles.map(name => [name, path.join(root, 'renderer', name)]));
  for (const [name, file] of Object.entries(paths)) {
    if (!fs.existsSync(file)) { fail(`renderer/${name} is missing`); return null; }
  }
  const html = fs.readFileSync(paths['index.html'], 'utf8');
  const css = fs.readFileSync(paths['styles.css'], 'utf8');
  const js = fs.readFileSync(paths['app.js'], 'utf8');

  checkShell(html, 'renderer/index.html');
  checkAssets(html, css);
  for (const marker of SCRIPT_MARKERS) {
    if (!js.includes(marker)) fail(`renderer/app.js: missing ${marker}`);
  }
  if (!/body\.sidebar-collapsed/.test(css)) fail('renderer/styles.css: sidebar collapse rules missing');
  if (!/\.p-segments/.test(css)) fail('renderer/styles.css: transfer stream styling missing');

  // Every selector app.js queries must exist in the markup, otherwise the shell
  // renders but a control silently stops working.
  const ids = [...new Set([...js.matchAll(/\$\('#([A-Za-z0-9_-]+)'/g)].map(m => m[1]))];
  const optional = new Set(['new-download', 'about-version']);
  for (const id of ids) {
    if (!optional.has(id) && !html.includes(`id="${id}"`)) fail(`renderer/index.html: no element for #${id}`);
  }
  notes.push(`${ids.length} renderer selectors verified against the markup`);
  notes.push(`index.html ${html.length} bytes · styles.css ${css.length} bytes · app.js ${js.length} bytes`);
  return { html, css, js };
}

function verifyPackaged(directory) {
  const unpacked = path.resolve(root, directory);
  const asarPath = path.join(unpacked, 'resources', 'app.asar');
  const exePath = path.join(unpacked, 'RedX-Downloader.exe');
  if (!fs.existsSync(asarPath)) { fail(`packaged asar not found: ${asarPath}`); return; }
  if (!fs.existsSync(exePath)) fail(`packaged executable not found: ${exePath}`);

  const asar = require('@electron/asar');
  const listing = asar.listPackage(asarPath);
  const wanted = rendererFiles.map(name => path.join('renderer', name).replace(/\\/g, '/'));
  for (const entry of wanted) {
    const candidates = listing.filter(item => item.replace(/\\/g, '/') === `/${entry}` || item.replace(/\\/g, '/') === entry);
    if (!candidates.length) fail(`packaged app is missing ${entry} — the installer would open the wrong interface`);
  }

  // Compare bytes: a packaged copy that differs from the sources means the build
  // archived an older renderer than the one in this checkout.
  for (const name of rendererFiles) {
    const source = fs.readFileSync(path.join(root, 'renderer', name));
    let packed;
    try { packed = asar.extractFile(asarPath, `renderer/${name}`); }
    catch { packed = asar.extractFile(asarPath, `renderer\\${name}`); }
    if (!packed) { fail(`could not read renderer/${name} from the packaged asar`); continue; }
    if (sha(source) !== sha(packed)) {
      fail(`packaged renderer/${name} differs from the source file — rebuild before shipping (source ${source.length} bytes, packed ${packed.length} bytes)`);
    }
  }

  const packedHtml = asar.extractFile(asarPath, 'renderer/index.html').toString('utf8');
  checkShell(packedHtml, 'packaged renderer/index.html');
  if (!listing.some(item => item.replace(/\\/g, '/').endsWith('assets/app-icon.ico'))) {
    fail('packaged app is missing assets/app-icon.ico');
  }
  notes.push(`packaged asar contains ${listing.length} entries`);
  notes.push('packaged renderer is byte-identical to the working tree');
}

const packagedIndex = process.argv.indexOf('--packaged');
try {
  const sources = verifySources();
  if (packagedIndex !== -1) {
    const target = process.argv[packagedIndex + 1];
    if (!target) fail('--packaged needs a directory (for example dist/win-unpacked)');
    else verifyPackaged(target);
  }
  if (sources) {
    const manifest = {
      generatedAt: new Date().toISOString(),
      renderer: Object.fromEntries(rendererFiles.map(name => [name, sha(fs.readFileSync(path.join(root, 'renderer', name)))])),
      mode: packagedIndex === -1 ? 'sources' : 'packaged'
    };
    fs.mkdirSync(path.join(root, 'build'), { recursive: true });
    fs.writeFileSync(path.join(root, 'build', 'ui-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  }
} catch (error) {
  fail(error.message);
}

for (const note of notes) console.log(`  ok  ${note}`);
if (problems.length) {
  console.error(`\nUI verification failed (${problems.length}):`);
  for (const problem of problems) console.error(`  x   ${problem}`);
  process.exit(1);
}
console.log(`\nUI verification passed (${packagedIndex === -1 ? 'sources' : 'packaged build'}).`);
