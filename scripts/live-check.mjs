import { youtubeFormats } from '../core/youtube.mjs';
import { resolvePageMedia } from '../core/extract.mjs';
const timeout = AbortSignal.timeout(30000);
try {
  const items = await youtubeFormats('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  console.log('YOUTUBE formats:', items.length, JSON.stringify(items.slice(0, 3).map(i => ({ q: i.quality, f: i.format, size: i.size }))));
} catch (e) { console.log('YOUTUBE FAIL:', e.message); }
try {
  const media = await resolvePageMedia('https://www.tiktok.com/@scout2015/video/6718335390845095173', { signal: timeout });
  console.log('TIKTOK:', media.title, '| variants:', media.variants.length, media.variants.map(v => v.quality).join(','));
} catch (e) { console.log('TIKTOK FAIL:', e.message); }
