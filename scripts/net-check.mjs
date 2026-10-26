const targets = [
  ['youtube-oembed', 'https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ&format=json'],
  ['tiktok-oembed', 'https://www.tiktok.com/oembed?url=https://www.tiktok.com/@scout2015/video/6718335390845095173'],
  ['x-syndication', 'https://cdn.syndication.twimg.com/tweet-result?id=1580661436132757506&token=a']
];
for (const [name, url] of targets) {
  const started = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12000), headers: { 'user-agent': 'Mozilla/5.0 RedX' } });
    const text = await res.text();
    console.log(name, res.status, text.length, Date.now() - started + 'ms', text.slice(0, 90).replace(/\s+/g, ' '));
  } catch (error) { console.log(name, 'FAIL', error.name, Date.now() - started + 'ms'); }
}
