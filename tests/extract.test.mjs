import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { promises as fs } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { DownloadEngine } from '../core/engine.mjs';
import { providerFor, pickVariant, parseTikTok, parseTweetResult, parseGeneric, resolvePageMedia, tweetIdFrom } from '../core/extract.mjs';

const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const TIKTOK_HTML = `<!doctype html><html><head><title>t</title></head><body>
<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">
{"__DEFAULT_SCOPE__":{"webapp.video-detail":{"statusCode":0,"itemInfo":{"itemStruct":{
  "id":"6718335390845095173","desc":"Cat playing piano #music",
  "author":{"nickname":"scout"},
  "video":{"duration":12,"height":1024,"width":576,
    "playAddr":"https://v16.tiktokcdn.com/play.mp4","downloadAddr":"https://v16.tiktokcdn.com/download.mp4",
    "bitrateInfo":[{"Quality":"1080p","Bitrate":2500000,"PlayAddr":{"UrlList":["https://v16.tiktokcdn.com/1080.mp4"],"Height":1920,"Width":1080}},
                   {"Quality":"720p","Bitrate":1200000,"PlayAddr":{"UrlList":["https://v16.tiktokcdn.com/720.mp4"],"Height":1280,"Width":720}}]}}}}}}
</script></body></html>`;

const TWEET_JSON = {
  __typename: 'Tweet',
  id_str: '1580661436132757506',
  text: 'Look at this clip',
  user: { name: 'Someone' },
  mediaDetails: [{
    type: 'video',
    video_info: {
      variants: [
        { content_type: 'application/x-mpegURL', url: 'https://video.twimg.com/pl.m3u8' },
        { content_type: 'video/mp4', bitrate: 832000, url: 'https://video.twimg.com/832.mp4' },
        { content_type: 'video/mp4', bitrate: 2176000, url: 'https://video.twimg.com/2176.mp4' }
      ]
    }
  }]
};

test('providerFor recognises the supported page providers only', () => {
  assert.equal(providerFor('https://www.tiktok.com/@a/video/1'), 'tiktok');
  assert.equal(providerFor('https://vm.tiktok.com/abc/'), 'tiktok');
  assert.equal(providerFor('https://x.com/user/status/1234567890'), 'x');
  assert.equal(providerFor('https://twitter.com/user/status/1234567890'), 'x');
  assert.equal(providerFor('https://www.youtube.com/watch?v=abc'), null);
  assert.equal(providerFor('https://cdn.example.com/file.mp4'), null);
  assert.equal(providerFor('not a url'), null);
  assert.equal(providerFor('ftp://x.com/a'), null);
});

test('TikTok page data yields real quality variants and a title', () => {
  const parsed = parseTikTok(TIKTOK_HTML);
  assert.equal(parsed.title, 'Cat playing piano #music');
  assert.equal(parsed.author, 'scout');
  assert.equal(parsed.variants.length, 2);
  assert.deepEqual(parsed.variants.map(v => v.quality).sort(), ['1080p', '720p']);
  // A 1080x1920 upload reports an encoded height of 1920: the quality users
  // recognise is the 1080 short side, not the raw height.
  assert.equal(parsed.variants.find(v => v.quality === '1080p').height, 1080);
  assert.equal(parseTikTok('<html>no data</html>'), null);
});

test('X post data is labelled by bitrate instead of inventing a resolution', () => {
  const parsed = parseTweetResult(TWEET_JSON);
  assert.equal(parsed.variants.length, 2, 'HLS manifest is not offered as a file');
  assert.deepEqual(parsed.variants.map(v => v.quality).sort(), ['0.8 Mbps', '2.2 Mbps']);
  assert.equal(parsed.variants.every(v => v.height === undefined), true);
  assert.throws(() => parseTweetResult({ __typename: 'TweetTombstone' }), /unavailable/i);
  assert.equal(tweetIdFrom('https://x.com/user/status/1580661436132757506?s=20'), '1580661436132757506');
  assert.equal(tweetIdFrom('https://x.com/user'), null);
});

test('generic pages use Open Graph video metadata', () => {
  const parsed = parseGeneric('<html><head><meta property="og:title" content="Clip &amp; more"><meta property="og:video" content="https://cdn.example.com/v.mp4?a=1"></head></html>', 'https://example.com/post/1');
  assert.equal(parsed.title, 'Clip & more');
  assert.equal(parsed.variants[0].url, 'https://cdn.example.com/v.mp4?a=1');
  assert.equal(parseGeneric('<html></html>', 'https://example.com/'), null);
});

test('pickVariant honours best, exact and fallback quality', () => {
  const variants = [{ url: 'a', height: 2160, quality: '2160p' }, { url: 'b', height: 1080, quality: '1080p' }, { url: 'c', height: 720, quality: '720p' }];
  assert.equal(pickVariant(variants, 'best').url, 'a');
  assert.equal(pickVariant(variants, '1080p').url, 'b');
  assert.equal(pickVariant(variants, '1440p').url, 'b', 'falls back to the nearest lower quality');
  assert.equal(pickVariant(variants, '360p').url, 'c', 'never claims a higher quality than exists');
  assert.equal(pickVariant([], 'best'), null);
});

test('resolvePageMedia talks to the right endpoint and tolerates failures', async () => {
  const calls = [];
  const fetchImpl = async url => {
    calls.push(url);
    if (String(url).includes('tiktok')) return new Response(TIKTOK_HTML, { status: 200, headers: { 'content-type': 'text/html' } });
    if (String(url).includes('syndication')) return new Response(JSON.stringify(TWEET_JSON), { status: 200 });
    return new Response('nope', { status: 404 });
  };
  const tiktok = await resolvePageMedia('https://www.tiktok.com/@a/video/1', { fetchImpl });
  assert.equal(tiktok.provider, 'tiktok');
  assert.equal(tiktok.variants.length, 2);
  const x = await resolvePageMedia('https://x.com/a/status/1580661436132757506', { fetchImpl });
  assert.equal(x.provider, 'x');
  assert.ok(calls.some(url => url.includes('tweet-result?id=1580661436132757506')));
  await assert.rejects(() => resolvePageMedia('https://x.com/a/status/1580661436132757506', { fetchImpl: async () => new Response('gone', { status: 404 }) }), /HTTP 404/);
});

/* ------------------------------------------------- real engine integration */
async function serveFile(body) {
  const server = http.createServer((req, res) => {
    const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
    if (range) {
      const start = Number(range[1]);
      const end = range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
      res.writeHead(206, { 'content-type': 'video/mp4', 'accept-ranges': 'bytes', etag: '"p"', 'content-range': `bytes ${start}-${end}/${body.length}`, 'content-length': end - start + 1 });
      res.end(body.subarray(start, end + 1));
      return;
    }
    res.writeHead(200, { 'content-type': 'video/mp4', 'accept-ranges': 'bytes', etag: '"p"', 'content-length': body.length });
    res.end(body);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

test('a TikTok page link is resolved and downloaded through the normal transfer path', async () => {
  const body = randomBytes(700 * 1024);
  const { server, base } = await serveFile(body);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'redx-extract-'));
  const data = path.join(root, 'data'), downloads = path.join(root, 'downloads');
  await fs.mkdir(data, { recursive: true });
  await fs.mkdir(downloads, { recursive: true });
  let engine;
  try {
    const resolved = [];
    engine = await new DownloadEngine({
      dataDirectory: data, downloadDirectory: downloads,
      resolvePage: async url => {
        resolved.push(url);
        return { provider: 'tiktok', title: 'Cat playing piano', author: 'scout', duration: 12,
          variants: [{ url: `${base}/1080.mp4`, quality: '1080p', height: 1920, format: 'MP4' }, { url: `${base}/720.mp4`, quality: '720p', height: 1280, format: 'MP4' }] };
      }
    }).init();
    const [id] = await engine.add({ urls: ['https://www.tiktok.com/@scout/video/6718335390845095173'], preferredQuality: '720p' });
    let download;
    for (let i = 0; i < 200; i++) {
      download = engine.downloads.find(d => d.id === id);
      if (download && ['complete', 'error'].includes(download.status)) break;
      await delay(100);
    }
    assert.equal(download.status, 'complete', download.error || '');
    assert.equal(download.provider, 'tiktok');
    assert.equal(download.kind, 'page');
    assert.equal(download.category, 'Video');
    assert.equal(download.filename, 'Cat playing piano.mp4', 'title becomes the file name');
    assert.equal(download.duration, 12);
    assert.deepEqual(download.qualities.map(q => q.quality), ['1080p', '720p']);
    assert.equal(download.url, `${base}/720.mp4`, 'the requested quality is the one transferred');
    assert.equal(download.sourceUrl, 'https://www.tiktok.com/@scout/video/6718335390845095173');
    assert.equal(sha256(await fs.readFile(download.path)), sha256(body));
    assert.deepEqual(resolved, ['https://www.tiktok.com/@scout/video/6718335390845095173']);
  } finally {
    await engine?.close().catch(() => {});
    await new Promise(resolve => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('an unavailable quality is reported instead of silently mislabelled', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'redx-quality-'));
  await fs.mkdir(path.join(root, 'data'), { recursive: true });
  await fs.mkdir(path.join(root, 'downloads'), { recursive: true });
  const engine = await new DownloadEngine({
    dataDirectory: path.join(root, 'data'), downloadDirectory: path.join(root, 'downloads'),
    resolvePage: async () => ({ provider: 'x', title: 'Post', variants: [{ url: 'https://video.twimg.com/only-720.mp4', quality: '720p', height: 720, format: 'MP4' }] })
  }).init();
  try {
    const [id] = await engine.add({ urls: ['https://x.com/a/status/1580661436132757506'], preferredQuality: '1080p' });
    // Stop before any network attempt: only the resolution metadata matters here.
    await delay(400);
    const download = engine.downloads.find(d => d.id === id);
    assert.match(download.qualityNote || '', /1080p is not available.*720p/i);
    assert.equal(download.url, 'https://video.twimg.com/only-720.mp4');
  } finally {
    await engine.close().catch(() => {});
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('the YouTube extractor binary and FFmpeg are actually bundled', async () => {
  const vendor = path.join(process.cwd(), 'vendor', 'yt-dlp.exe');
  assert.ok((await fs.stat(vendor)).size > 1_000_000, 'vendor/yt-dlp.exe must ship with the project');
  const ffmpeg = (await import('ffmpeg-static')).default;
  assert.ok((await fs.stat(ffmpeg)).size > 1_000_000, 'a bundled FFmpeg is required to merge streams');
});
