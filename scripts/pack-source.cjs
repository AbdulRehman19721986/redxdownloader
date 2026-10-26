#!/usr/bin/env node
/**
 * Builds the GitHub-ready source archive.
 *
 *   node scripts/pack-source.cjs [output.zip]
 *
 * Ships source, tests, docs and the extension — never node_modules, build
 * output, the packaged installers, browser profiles or local logs.
 */
'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const out = path.resolve(process.argv[2] || path.join(root, 'dist', `RedX-Downloader-${pkg.version}-source.zip`));

const INCLUDE = [
  'README.md', 'CHANGELOG.md', 'LICENSE', 'package.json', 'package-lock.json', 'pubspec.yaml',
  'lib', 'test', 'desktop', 'core', 'renderer', 'extension', 'integration', 'assets',
  'scripts', 'shared', 'docs', 'tests'
];

const SKIP_DIRS = new Set(['node_modules', 'build', 'dist', '.git', '.dart_tool', 'media-output']);
const SKIP_FILES = /(\.bak|\.legacy|__uninstaller|\.blockmap|\.log)$|^builder-debug\.yml$/;

function walk(dir, bucket, prefix) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, bucket, rel);
    } else if (!SKIP_FILES.test(entry.name)) {
      bucket.push(rel);
    }
  }
}

const files = [];
for (const entry of INCLUDE) {
  const full = path.join(root, entry);
  if (!fs.existsSync(full)) continue;
  if (fs.statSync(full).isDirectory()) walk(full, files, entry);
  else files.push(entry);
}

if (!files.some(file => file.startsWith('extension/') && file.endsWith('manifest.json'))) {
  throw new Error('extension/manifest.json missing — refusing to build an incomplete archive');
}
if (!files.some(file => file.startsWith('lib/') && file.endsWith('.dart'))) {
  throw new Error('Dart sources missing — refusing to build an incomplete archive');
}

fs.mkdirSync(path.dirname(out), { recursive: true });
if (fs.existsSync(out)) fs.unlinkSync(out);

// -CompressionLevel Optimal keeps the archive small without a build step.
const listFile = path.join(root, 'build', 'source-list.txt');
fs.mkdirSync(path.dirname(listFile), { recursive: true });
fs.writeFileSync(listFile, files.join('\n'), 'utf8');

const script = [
  `$ErrorActionPreference='Stop'`,
  `$zip='${out.replace(/'/g, "''")}'`,
  `$root='${root.replace(/'/g, "''")}'`,
  `$files=Get-Content '${listFile.replace(/'/g, "''")}'`,
  `Add-Type -AssemblyName System.IO.Compression.FileSystem`,
  `$archive=[System.IO.Compression.ZipFile]::Open($zip,'Create')`,
  `try{ foreach($f in $files){ $src=Join-Path $root $f; if(Test-Path -LiteralPath $src){ [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive,$src,$f,[System.IO.Compression.CompressionLevel]::Optimal) | Out-Null } } } finally { $archive.Dispose() }`
].join('; ');

execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: 'inherit' });

const size = fs.statSync(out).size;
console.log(`packed ${files.length} files → ${path.relative(root, out)} (${(size / 1024 / 1024).toFixed(1)} MB)`);
console.log(`excluded: ${[...SKIP_DIRS].join(', ')}`);
