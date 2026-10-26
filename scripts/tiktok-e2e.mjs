/* Live TikTok check: a page URL must be resolved and downloaded by the bundled
 * extractor, not replayed as a captured CDN link. */
import { DownloadEngine } from '../core/engine.mjs';
import { ytdlpFormats } from '../core/ytdlp.mjs';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const url = process.argv[2] || 'https://www.tiktok.com/@scout2015/video/6718335390845095173';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'redx-tt-'));
const data = path.join(root, 'data');
const dl = path.join(root, 'dl');
await fs.mkdir(data, { recursive: true });
await fs.mkdir(dl, { recursive: true });

try {
  const listing = await ytdlpFormats(url);
  console.log('title:', listing.title);
  console.log('formats:', listing.rows.slice(0, 6).map(r => `${r.quality}/${r.format}/${r.size || '?'}`).join(', '));
} catch (error) {
  console.log('FORMATS FAIL:', error.message);
}

const engine = await new DownloadEngine({ dataDirectory: data, downloadDirectory: dl }).init();
const [id] = await engine.add({ urls: [url] });
let d;
for (let i = 0; i < 150; i++) {
  d = engine.downloads.find(x => x.id === id);
  if (d && ['complete', 'error', 'cancelled'].includes(d.status)) break;
  await new Promise(r => setTimeout(r, 1000));
}
console.log('result:', JSON.stringify({ status: d.status, error: d.error, bytes: d.total, file: d.path && path.basename(d.path), kind: d.kind, provider: d.provider, qualities: (d.qualities || []).length }));
if (d.path) {
  const stat = await fs.stat(d.path);
  console.log('file bytes:', stat.size, 'magic:', (await fs.readFile(d.path)).subarray(4, 8).toString('ascii'));
}
await engine.close();
await fs.rm(root, { recursive: true, force: true });
