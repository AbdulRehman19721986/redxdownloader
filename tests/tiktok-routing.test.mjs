import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DownloadEngine } from '../core/engine.mjs';
import { isEphemeralMediaUrl, providerFor } from '../core/extract.mjs';

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), 'redx-tt-route-'));

test('signed TikTok CDN links are recognised as ephemeral media', () => {
  const cdn = [
    'https://v16-webapp-prime.tiktok.com/video/tos/useast2a/abc/?a=1988',
    'https://v16.tiktokcdn.com/xyz/video.mp4?a=1',
    'https://v19-webapp.tiktokcdn-us.com/video/tos/x/'
  ];
  for (const url of cdn) assert.equal(isEphemeralMediaUrl(url), true, url);

  const pages = [
    'https://www.tiktok.com/@studio/video/7412345678901234567',
    'https://www.tiktok.com/t/ZTRabc123/',
    'https://example.com/video/tos/clip.mp4',
    'https://cdn.example.com/file.zip'
  ];
  for (const url of pages) assert.equal(isEphemeralMediaUrl(url), false, url);
});

test('TikTok pages route to the extractor, media CDNs do not', () => {
  assert.equal(providerFor('https://www.tiktok.com/@a/video/1'), 'tiktok');
  assert.equal(providerFor('https://vm.tiktok.com/ZMabc/'), 'tiktok');
  // A CDN host is not a page provider: it must be rejected, not extracted.
  assert.equal(providerFor('https://v16.tiktokcdn.com/video/tos/x/'), null);
});

test('a CDN link fails with an actionable message instead of "Unsupported URL"', async () => {
  const root = await tmp();
  const engine = await new DownloadEngine({
    dataDirectory: path.join(root, 'data'),
    downloadDirectory: path.join(root, 'out')
  }).init();
  try {
    const [id] = await engine.add({
      urls: ['https://v16-webapp-prime.tiktok.com/video/tos/useast2a/abc/?a=1988']
    });
    await engine.action(id, 'resume');
    await new Promise(resolve => setTimeout(resolve, 2000));
    const item = engine.downloads.find(d => d.id === id);
    assert.equal(item.status, 'error');
    assert.match(item.error, /temporary TikTok media link/i);
    assert.doesNotMatch(item.error, /Unsupported URL/i);
  } finally {
    await engine.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('a real TikTok page is not rejected by the ephemeral guard', async () => {
  const root = await tmp();
  const engine = await new DownloadEngine({
    dataDirectory: path.join(root, 'data'),
    downloadDirectory: path.join(root, 'out')
  }).init();
  try {
    const [id] = await engine.add({ urls: ['https://www.tiktok.com/@a/video/7412345678901234567'] });
    await engine.action(id, 'pause').catch(() => {});
    const item = engine.downloads.find(d => d.id === id);
    assert.doesNotMatch(String(item.error || ''), /temporary TikTok media link/i);
  } finally {
    await engine.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
