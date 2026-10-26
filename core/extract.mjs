/*
 * Page-based media resolution for providers that do not expose a direct file
 * link: TikTok, X/Twitter and a generic Open Graph fallback.
 *
 * Only publicly available page data and public endpoints are read. Nothing here
 * authenticates, bypasses a paywall, or circumvents DRM; when a page does not
 * publish a downloadable stream the caller receives a clear error instead.
 *
 * Every function accepts an injectable fetch so tests stay deterministic.
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const MAX_PAGE_BYTES = 4 * 1024 * 1024;
const QUALITY_ORDER = ['2160p', '1440p', '1080p', '720p', '480p', '360p', '240p'];

export function providerFor(value) {
  let url;
  try { url = new URL(String(value)); } catch { return null; }
  if (!/^https?:$/.test(url.protocol)) return null;
  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) return 'tiktok';
  if (host === 'x.com' || host === 'twitter.com' || host.endsWith('.twitter.com') || host === 'mobile.twitter.com') return 'x';
  if (host === 'vm.tiktok.com' || host === 'vt.tiktok.com') return 'tiktok';
  return null;
}

/** Highest quality at or below the requested label; `best` takes the top tier. */
export function pickVariant(variants, wanted = 'best') {
  const usable = variants.filter(item => item && item.url && !item.unsupported);
  if (!usable.length) return null;
  const ranked = [...usable].sort((a, b) => score(b) - score(a));
  if (!wanted || wanted === 'best' || wanted === 'audio') return ranked[0];
  const target = /^(\d{3,4})p$/.exec(wanted);
  if (!target) return ranked[0];
  const height = Number(target[1]);
  const exact = ranked.find(item => Number(item.height) === height);
  if (exact) return exact;
  const smaller = ranked.find(item => Number(item.height) && Number(item.height) <= height);
  return smaller || ranked[ranked.length - 1];
}
function score(item) {
  const height = Number(item.height) || heightFromLabel(item.quality) || 0;
  return height * 1e6 + (Number(item.bitrate) || 0) / 1000;
}
function heightFromLabel(label) {
  const match = /(\d{3,4})p/.exec(String(label || ''));
  return match ? Number(match[1]) : 0;
}
const extensionOf = (url, fallback = 'mp4') => {
  try {
    const ext = /\.([a-z0-9]{2,4})(?:[?#]|$)/i.exec(new URL(url).pathname);
    return ext ? ext[1].toLowerCase() : fallback;
  } catch { return fallback; }
};
const cleanTitle = value => String(value || '').replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150);

async function fetchText(url, { signal, fetchImpl = fetch, headers = {} } = {}) {
  const response = await fetchImpl(url, {
    signal, redirect: 'follow',
    headers: { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9', ...headers }
  });
  if (!response.ok) throw new Error(`The page returned HTTP ${response.status}.`);
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > MAX_PAGE_BYTES) throw new Error('The page is too large to inspect.');
  const text = await response.text();
  if (text.length > MAX_PAGE_BYTES) throw new Error('The page is too large to inspect.');
  return text;
}

/* ------------------------------------------------------------------ TikTok */
export function parseTikTok(html) {
  const match = /<script[^>]+id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/.exec(html || '');
  if (!match) return null;
  let data;
  try { data = JSON.parse(match[1]); } catch { return null; }
  const scope = data?.__DEFAULT_SCOPE__ || {};
  const detail = scope['webapp.video-detail']?.itemInfo?.itemStruct
    || Object.values(scope).map(entry => entry?.itemInfo?.itemStruct).find(Boolean);
  if (!detail?.video) return null;
  const video = detail.video;
  const variants = [];
  for (const entry of Array.isArray(video.bitrateInfo) ? video.bitrateInfo : []) {
    const url = entry?.PlayAddr?.UrlList?.[0] || (Array.isArray(entry?.PlayAddr) ? entry.PlayAddr[0] : null);
    if (!url) continue;
    // Vertical videos report an encoded height of 1920 for a 1080p master, so
    // the short side is the quality users recognise.
    const rawWidth = Number(entry?.PlayAddr?.Width) || Number(video.width) || 0;
    const rawHeight = Number(entry?.PlayAddr?.Height) || Number(video.height) || 0;
    const height = Math.min(...[rawWidth, rawHeight].filter(Boolean)) || rawHeight || heightFromLabel(entry?.Quality);
    const labelled = /^\d{3,4}p$/.test(String(entry?.Quality || '')) ? entry.Quality : null;
    variants.push({
      url, height: height || undefined,
      quality: labelled || (height ? `${height}p` : 'MP4'),
      bitrate: Number(entry?.Bitrate) || undefined,
      format: extensionOf(url).toUpperCase(), size: Number(entry?.DataSize) || undefined
    });
  }
  if (!variants.length) {
    for (const url of [video.playAddr, video.downloadAddr].filter(Boolean)) {
      variants.push({
        url, height: Number(video.height) || undefined,
        quality: video.height ? `${video.height}p` : 'MP4',
        format: extensionOf(url).toUpperCase(), size: Number(video.size) || undefined
      });
    }
  }
  const deduped = [...new Map(variants.map(item => [item.url, item])).values()];
  if (!deduped.length) return null;
  return {
    title: cleanTitle(detail.desc) || `TikTok video ${detail.id || ''}`.trim(),
    author: cleanTitle(detail.author?.nickname),
    duration: Number(detail.video?.duration) || undefined,
    variants: deduped
  };
}

async function resolveTikTok(url, options) {
  const html = await fetchText(url, options);
  const parsed = parseTikTok(html);
  if (!parsed) throw new Error('TikTok did not publish this video. It may be private, region-locked or removed.');
  return parsed;
}

/* --------------------------------------------------------------- X/Twitter */
export function tweetIdFrom(value) {
  try {
    const url = new URL(String(value));
    const match = /\/status(?:es)?\/(\d{5,25})/.exec(url.pathname);
    return match ? match[1] : null;
  } catch { return null; }
}

export function parseTweetResult(json) {
  if (!json || typeof json !== 'object') return null;
  if (json.__typename === 'TweetTombstone') throw new Error('This post is unavailable (deleted, protected or age-restricted).');
  const details = Array.isArray(json.mediaDetails) ? json.mediaDetails : [];
  const variants = [];
  for (const media of details) {
    for (const variant of media?.video_info?.variants || []) {
      if (variant.content_type !== 'video/mp4' || !variant.url) continue;
      const bitrate = Number(variant.bitrate) || 0;
      variants.push({
        url: variant.url,
        // Height is not published by the syndication endpoint: label by bitrate
        // instead of inventing a resolution.
        quality: bitrate ? `${(bitrate / 1000000).toFixed(1)} Mbps` : 'MP4',
        bitrate: bitrate || undefined,
        height: undefined,
        format: 'MP4'
      });
    }
  }
  if (!variants.length) return null;
  const text = cleanTitle(json.text);
  return {
    title: text || `Post ${json.id_str || ''}`.trim(),
    author: cleanTitle(json.user?.name),
    variants: [...new Map(variants.map(item => [item.url, item])).values()]
  };
}

async function resolveX(url, options) {
  const id = tweetIdFrom(url);
  if (!id) throw new Error('This link is not a post with a video. Open the post itself and try again.');
  const endpoint = `https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=a`;
  const text = await fetchText(endpoint, { ...options, headers: { accept: 'application/json', ...(options?.headers || {}) } });
  let json;
  try { json = JSON.parse(text); } catch { throw new Error('X returned an unreadable response.'); }
  const parsed = parseTweetResult(json);
  if (!parsed) throw new Error('This post has no downloadable video.');
  return parsed;
}

/* ------------------------------------------------------------------ generic */
export function parseGeneric(html, pageUrl) {
  const meta = name => {
    const patterns = [
      new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']+)["']`, 'i'),
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${name}["']`, 'i')
    ];
    for (const pattern of patterns) {
      const found = pattern.exec(html || '');
      if (found) return found[1].replace(/&amp;/g, '&');
    }
    return null;
  };
  const urls = [meta('og:video:secure_url'), meta('og:video'), meta('og:video:url')].filter(Boolean);
  for (const match of (html || '').matchAll(/<(?:video|source)[^>]+src=["']([^"']+)["']/gi)) urls.push(match[1].replace(/&amp;/g, '&'));
  const resolved = [];
  for (const raw of urls) {
    try {
      const absolute = new URL(raw, pageUrl).href;
      if (/^https?:$/.test(new URL(absolute).protocol)) resolved.push(absolute);
    } catch { /* ignore malformed candidates */ }
  }
  if (!resolved.length) return null;
  return {
    title: cleanTitle(meta('og:title') || /<title[^>]*>([^<]+)<\/title>/i.exec(html || '')?.[1] || ''),
    variants: [...new Set(resolved)].map(url => ({ url, quality: 'Source', format: extensionOf(url, 'mp4').toUpperCase() }))
  };
}

export async function resolvePageMedia(value, { signal, fetchImpl = fetch, provider } = {}) {
  const kind = provider || providerFor(value);
  if (kind === 'tiktok') return { provider: 'tiktok', ...(await resolveTikTok(value, { signal, fetchImpl })) };
  if (kind === 'x') return { provider: 'x', ...(await resolveX(value, { signal, fetchImpl })) };
  if (kind === 'page') {
    const html = await fetchText(value, { signal, fetchImpl });
    const parsed = parseGeneric(html, value);
    if (!parsed) throw new Error('No downloadable video was published on that page.');
    return { provider: 'page', ...parsed };
  }
  return null;
}

/** True for links that must be resolved through a page rather than fetched. */
export function looksLikePage(value) {
  try {
    const url = new URL(String(value));
    if (providerFor(value)) return true;
    if (/\.(mp4|webm|m4v|mov|mp3|m4a|zip|pdf|exe|msi|apk|iso|7z|rar|gz|tar)$/i.test(url.pathname)) return false;
    if (/\.(html?|php|aspx?|jsp)$/i.test(url.pathname)) return true;
    return url.pathname === '/' || !/\.[a-z0-9]{2,5}$/i.test(url.pathname);
  } catch { return false; }
}

export { QUALITY_ORDER };

/** Signed, short-lived media CDN hosts: never a valid download source by themselves. */
export function isEphemeralMediaUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname;
    const mediaCdn = /(^|\.)(tiktokcdn\.com|tiktokcdn-us\.com|tiktokv\.com|byteoversea\.com|ibytedtos\.com)$/i.test(host);
    // Signed TikTok media also ships from *.tiktok.com/video/tos/... subdomains,
    // so the path is what separates it from a real video page.
    const signedPath = /(^|\.)tiktok\.com$/i.test(host) && /^\/video\/tos\//i.test(url.pathname);
    return mediaCdn || signedPath;
  } catch {
    return false;
  }
}
