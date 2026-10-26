/* Live YouTube check: formats, a real 360p download and stream verification. */
import { youtubeFormats } from '../core/youtube.mjs';
import { DownloadEngine } from '../core/engine.mjs';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';

const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const formats = await youtubeFormats(url);
console.log('format item keys:', Object.keys(formats[0]).join(','));
console.log('sample:', JSON.stringify(formats[0]));
const pick = formats.find(f => f.quality === '360p') || formats[formats.length - 1];
console.log('chosen:', JSON.stringify({ quality: pick.quality, yt: pick.youtubeFormat }));

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'redx-yt-'));
const data = path.join(root, 'data');
const dl = path.join(root, 'dl');
await fs.mkdir(data, { recursive: true });
await fs.mkdir(dl, { recursive: true });

const engine = await new DownloadEngine({ dataDirectory: data, downloadDirectory: dl }).init();
const [id] = await engine.add({ urls: [url], youtubeFormat: pick.youtubeFormat });
let d;
for (let i = 0; i < 150; i++) {
  d = engine.downloads.find(x => x.id === id);
  if (d && ['complete', 'error'].includes(d.status)) break;
  await new Promise(r => setTimeout(r, 1000));
}
console.log('result:', JSON.stringify({ status: d.status, error: d.error, bytes: d.total, file: d.path && path.basename(d.path), duration: d.duration }));
if (d.path) {
  const stat = await fs.stat(d.path);
  console.log('file bytes:', stat.size);
  const ff = (await import('ffmpeg-static')).default;
  await new Promise(resolve => execFile(ff, ['-hide_banner', '-i', d.path], (_e, _o, err) => {
    console.log(err.split('\n').filter(l => /Stream #/.test(l)).map(l => l.trim().slice(0, 84)).join(' || '));
    resolve();
  }));
}
await engine.close();
await fs.rm(root, { recursive: true, force: true });
