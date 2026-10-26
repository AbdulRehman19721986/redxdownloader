#!/usr/bin/env node
/**
 * Builds the Chrome Web Store upload archive.
 *
 *   node scripts/pack-extension.cjs
 *
 * Only runtime files are copied: the *.test.cjs suites, the Firefox manifest and
 * local notes stay out of the package. manifest.json must sit at the archive
 * root, which is what the Web Store expects.
 */
'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = path.join(root, 'extension');
const staging = path.join(root, 'build', 'extension-pack');
const target = path.join(root, 'dist', 'RedX-Downloader-Extension.zip');

const RUNTIME = [
  'manifest.json', 'background.js', 'content.js', 'hls.js', 'media-choices.js',
  'popup.html', 'popup.css', 'popup.js', 'youtube-media.js', 'youtube-page.js',
  'youtube-relay.js'
];

fs.rmSync(staging, { recursive: true, force: true });
fs.mkdirSync(staging, { recursive: true });

for (const file of RUNTIME) {
  const from = path.join(source, file);
  if (!fs.existsSync(from)) throw new Error(`extension file missing: ${file}`);
  fs.copyFileSync(from, path.join(staging, file));
}
fs.cpSync(path.join(source, 'icons'), path.join(staging, 'icons'), { recursive: true });

// Validate the manifest that is about to be uploaded.
const manifest = JSON.parse(fs.readFileSync(path.join(staging, 'manifest.json'), 'utf8'));
if (manifest.manifest_version !== 3) throw new Error('Chrome requires manifest_version 3');
if (!manifest.icons?.['128']) throw new Error('a 128px store icon is required');
if (!manifest.background?.service_worker) throw new Error('service worker entry missing');
const referenced = new Set([
  ...Object.values(manifest.icons || {}),
  ...(manifest.content_scripts || []).flatMap(entry => entry.js || []),
  manifest.background.service_worker
]);
for (const file of referenced) {
  if (!fs.existsSync(path.join(staging, file))) throw new Error(`manifest references a missing file: ${file}`);
}

fs.mkdirSync(path.dirname(target), { recursive: true });
if (fs.existsSync(target)) fs.unlinkSync(target);
const packed = execFileSync('powershell', [
  '-NoProfile', '-NonInteractive', '-Command',
  `Compress-Archive -Path '${staging}\\*' -DestinationPath '${target}' -CompressionLevel Optimal -Force`
], { cwd: root });

const size = fs.statSync(target).size;
console.log(`packed ${target}`);
console.log(`  version ${manifest.version} · ${(size / 1024).toFixed(0)} KB · ${RUNTIME.length + 4} files`);
console.log(`  entry points: ${[...referenced].join(', ')}`);
