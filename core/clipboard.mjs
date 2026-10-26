/*
 * Clipboard link detection.
 *
 * The desktop app reads the clipboard only while the user has enabled the
 * monitor, and only inspects the text to decide whether it *is* a single
 * download link. Nothing else is stored, logged or forwarded.
 */
const DOWNLOADABLE = /\.(?:7z|apk|avi|bin|bz2|cab|deb|dmg|docx?|epub|exe|flac|gz|img|iso|jar|jpe?g|m4a|m4v|mkv|mov|mp3|mp4|msi|msix|odt|ogg|opus|pdf|pkg|png|pptx?|rar|rpm|tar|tgz|ttf|wav|webm|webp|wim|xapk|xlsx?|zip)(?:[?#].*)?$/i;
const ARCHIVE_HINT = /(?:^|[/?&])(?:download|getfile|dl)(?:[/?=&]|$)/i;

export function detectDownloadUrl(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  // A copied link is a single token. Anything longer is prose, a document or a
  // password manager payload and is ignored without being inspected further.
  if (!trimmed || trimmed.length > 4096 || /[\r\n]/.test(trimmed)) return null;
  let url;
  try { url = new URL(trimmed); } catch { return null; }
  if (!/^https?:$/.test(url.protocol)) return null;
  if (url.username || url.password) return null;
  if (!url.hostname || url.hostname === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)) return null;
  if (!DOWNLOADABLE.test(url.pathname + url.search) && !ARCHIVE_HINT.test(url.pathname)) return null;
  url.hash = '';
  return url.href;
}

export function looksLikePage(url) {
  try {
    const parsed = new URL(url);
    const page = /\.(?:html?|php|aspx?|jsp)(?:[?#]|$)/i.test(parsed.pathname) || parsed.pathname.endsWith('/');
    return page && !DOWNLOADABLE.test(parsed.pathname);
  } catch { return false; }
}
