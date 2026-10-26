import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { choicesFromInfo } from '../core/ytdlp.mjs';
import { DownloadEngine } from '../core/engine.mjs';

const tiktokInfo = {
  title: 'Clip',
  formats: [
    { format_id: 'download', ext: 'mp4', height: 1280, width: 720, vcodec: 'h264', acodec: 'aac', tbr: 2400, filesize: 4_000_000, url: 'https://cdn.example.com/wm.mp4' },
    { format_id: 'play_addr', ext: 'mp4', height: 1280, width: 720, vcodec: 'h264', acodec: 'aac', tbr: 3100, filesize: 5_000_000, url: 'https://cdn.example.com/clean.mp4' },
    { format_id: 'h264_720p', ext: 'mp4', height: 720, width: 405, vcodec: 'h264', acodec: 'aac', tbr: 1200, filesize: 2_000_000, url: 'https://cdn.example.com/720.mp4' },
    { format_id: 'h264_540p', ext: 'mp4', height: 540, width: 303, vcodec: 'h264', acodec: 'aac', tbr: 800, size: undefined, url: 'https://cdn.example.com/540.mp4' },
    { format_id: 'audio', ext: 'm4a', vcodec: 'none', acodec: 'aac', abr: 128, url: 'https://cdn.example.com/a.m4a' }
  ]
};

test('TikTok formats become real, de-duplicated quality rows', () => {
  const rows = choicesFromInfo(tiktokInfo);
  assert.deepEqual(rows.map(row => row.quality), ['1280p', '720p', '540p'], 'one row per resolution, highest bitrate kept');
  assert.equal(rows[0].youtubeFormat, 'play_addr', 'the better variant represents 1280p');
  assert.equal(rows[0].url, 'https://cdn.example.com/clean.mp4');
  assert.equal(rows[1].format, 'MP4');
  assert.equal(rows[0].size, 5_000_000);
  assert.ok(rows.every(row => row.quality !== 'Media'), 'generic "Media" labels are never produced');
  assert.equal(new Set(rows.map(row => row.quality)).size, rows.length, 'no duplicate labels');
});

test('audio-only sources fall back to a single labelled row', () => {
  const rows = choicesFromInfo({ formats: [{ format_id: 'a', ext: 'm4a', vcodec: 'none', acodec: 'aac', abr: 96, url: 'https://cdn.example.com/a.m4a' }] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].quality, 'Audio');
  assert.equal(rows[0].audioOnly, true);
});

test('a video-only format records the audio pair needed for merging', () => {
  const rows = choicesFromInfo({
    formats: [
      { format_id: 'v1080', ext: 'mp4', height: 1080, vcodec: 'h264', acodec: 'none', url: 'https://cdn.example.com/v.mp4' },
      { format_id: 'a128', ext: 'm4a', vcodec: 'none', acodec: 'aac', abr: 128, url: 'https://cdn.example.com/a.m4a' }
    ]
  });
  assert.equal(rows[0].needsAudio, true);
  assert.equal(rows[0].audioFormatId, 'a128');
});

test('the engine accepts a real resolution label and selects that height', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'redx-quality-'));
  await fs.mkdir(path.join(root, 'data'), { recursive: true });
  await fs.mkdir(path.join(root, 'downloads'), { recursive: true });
  const engine = await new DownloadEngine({
    dataDirectory: path.join(root, 'data'), downloadDirectory: path.join(root, 'downloads'),
    resolvePage: async () => ({
      provider: 'tiktok', title: 'Clip',
      variants: [
        { url: 'https://cdn.example.com/1280.mp4', quality: '1280p', height: 1280, format: 'MP4' },
        { url: 'https://cdn.example.com/720.mp4', quality: '720p', height: 720, format: 'MP4' }
      ]
    })
  }).init();
  try {
    // 1280p is not in the fixed UI list; it must still be accepted.
    const [id] = await engine.add({ urls: ['https://www.tiktok.com/@a/video/1'], preferredQuality: '1280p' });
    await new Promise(resolve => setTimeout(resolve, 600));
    const download = engine.downloads.find(item => item.id === id);
    assert.equal(download.preferredQuality, '1280p');
    assert.equal(download.url, 'https://cdn.example.com/1280.mp4', 'the chosen quality is the one transferred');
    assert.equal(download.qualityNote, undefined, 'no substitution note when the quality exists');
    await assert.rejects(() => engine.add({ urls: ['https://www.tiktok.com/@a/video/2'], preferredQuality: 'ultra' }), /Invalid quality/);
  } finally {
    await engine.close().catch(() => {});
    await fs.rm(root, { recursive: true, force: true });
  }
});
