/*
 * Generic yt-dlp bridge for page-based providers (TikTok, X/Twitter).
 *
 * YouTube keeps its dedicated module because it uses a captured SABR session;
 * everything else that yt-dlp supports can flow through here, which means the
 * signed CDN URLs are produced by the extractor at download time instead of
 * being replayed later (the cause of the previous TikTok HTTP 403 failures).
 */
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpeg from 'ffmpeg-static';

const here = path.dirname(fileURLToPath(import.meta.url));

export function ytdlpExecutable() {
  const candidates = [];
  if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, 'tools', 'yt-dlp.exe'));
  candidates.push(path.join(here, '..', 'vendor', 'yt-dlp.exe'));
  return candidates[0];
}

let missing = false;
export function ytdlpAvailable() { return !missing; }

function run(args, { signal, onLine, timeout = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = '1';
    const child = spawn(ytdlpExecutable(), ['--ignore-config', '--no-playlist', '--no-colors', '--no-warnings', ...args], {
      windowsHide: true, env, signal, stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '', stderr = '', pending = '';
    const timer = timeout ? setTimeout(() => { stderr = 'yt-dlp timed out.'; child.kill(); }, timeout) : null;
    child.on('error', error => {
      if (timer) clearTimeout(timer);
      if (error.code === 'ENOENT') { missing = true; const failure = new Error('The yt-dlp extractor is missing from this installation.'); failure.code = 'YTDLP_MISSING'; reject(failure); return; }
      reject(error);
    });
    child.stdout.on('data', chunk => {
      if (onLine) {
        pending += chunk;
        let at;
        while ((at = pending.indexOf('\n')) >= 0) { onLine(pending.slice(0, at)); pending = pending.slice(at + 1); }
      } else {
        stdout += chunk;
        if (stdout.length > 32 * 1024 * 1024) { stderr = 'yt-dlp output was too large.'; child.kill(); }
      }
    });
    child.stderr.on('data', chunk => { stderr += chunk; if (stderr.length > 20000) { stderr = stderr.slice(-20000); } });
    child.on('close', code => {
      if (timer) clearTimeout(timer);
      if (signal?.aborted) { const abort = new Error('Cancelled.'); abort.name = 'AbortError'; reject(abort); return; }
      if (code !== 0) {
        const raw = cleanError(stderr) || `yt-dlp exited with code ${code}.`;
        const friendly = /Unsupported URL/i.test(raw)
          ? 'The extractor does not support this link. Open the video page in the browser and use the RedX button there.'
          : raw;
        reject(new Error(friendly));
        return;
      }
      resolve(stdout);
    });
  });
}

function cleanError(text) {
  const lines = String(text || '').split(/\r?\n/).map(line => line.replace(/^ERROR:\s*/i, '').trim()).filter(line => line && !/^WARNING/i.test(line));
  return lines.slice(-2).join(' ').slice(0, 300);
}

export function choicesFromInfo(info) {
  const formats = Array.isArray(info?.formats) ? info.formats : [];
  const video = formats.filter(f => f.vcodec !== 'none' && f.url);
  const audio = formats.filter(f => f.vcodec === 'none' && f.acodec !== 'none' && f.url);
  const rows = [];
  for (const f of video) {
    rows.push({
      url: f.url,
      youtubeFormat: f.format_id,
      quality: f.height ? `${f.height}p` : (f.format_note || 'Video'),
      format: String(f.ext || 'mp4').toUpperCase(),
      size: Number(f.filesize) || Number(f.filesize_approx) || undefined,
      height: Number(f.height) || undefined,
      bitrate: Number(f.tbr) || undefined,
      needsAudio: f.acodec === 'none',
      audioFormatId: f.acodec === 'none' ? audio.sort((a, b) => (b.abr || 0) - (a.abr || 0))[0]?.format_id : undefined
    });
  }
  if (!video.length && audio.length) {
    const best = audio.sort((a, b) => (b.abr || 0) - (a.abr || 0))[0];
    rows.push({
      url: best.url, youtubeFormat: best.format_id, quality: 'Audio',
      format: String(best.ext || 'm4a').toUpperCase(), size: Number(best.filesize) || undefined, audioOnly: true
    });
  }
  const unique = new Map();
  for (const row of rows) {
    if (!row.youtubeFormat) continue;
    // Group by resolution, keeping the highest bitrate for that height so the
    // menu shows one honest row per quality.
    const key = row.height ? `h${row.height}` : `id${row.youtubeFormat}`;
    const existing = unique.get(key);
    if (!existing || (row.bitrate || 0) > (existing.bitrate || 0)) unique.set(key, row);
  }
  return [...unique.values()].sort((a, b) => (b.height || 0) - (a.height || 0));
}

export async function ytdlpFormats(url, { signal } = {}) {
  let info;
  try {
    info = JSON.parse(await run(['--skip-download', '--dump-single-json', url], { signal, timeout: 60000 }));
  } catch (error) {
    if (error.code === 'YTDLP_MISSING') throw error;
    throw new Error(`The extractor could not read this page: ${error.message}`);
  }
  const rows = choicesFromInfo(info);
  if (!rows.length) throw new Error('No downloadable formats were published for this link.');
  return { title: info.title || '', duration: info.duration, uploader: info.uploader || info.channel, rows };
}

/**
 * Downloads one format. Video-only selections are paired with the best audio
 * and merged to MP4, which is what yt-dlp does for YouTube as well.
 */
export async function ytdlpDownload({ url, formatId, needsAudio, audioFormatId, directory, signal, onProgress, cookiesFromBrowser }) {
  const selector = formatId
    ? (needsAudio ? `${formatId}+${audioFormatId || 'bestaudio'}/${formatId}/best` : `${formatId}/best`)
    : 'bestvideo*+bestaudio/best';
  const args = [
    '-f', selector,
    '--newline',
    '--progress-template', 'RXPROG:%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.speed)s|%(progress.eta)s',
    '--merge-output-format', 'mp4',
    '-o', path.join(directory, 'media.%(ext)s')
  ];
  if (ffmpeg) args.push('--ffmpeg-location', path.dirname(ffmpeg));
  if (cookiesFromBrowser) args.push('--cookies-from-browser', cookiesFromBrowser);
  args.push(url);

  await run(args, {
    signal,
    timeout: 0,
    onLine: line => {
      if (!line.startsWith('RXPROG:') || !onProgress) return;
      const [downloaded, total, speed, eta] = line.slice(7).split('|');
      onProgress({
        downloaded: Number(downloaded) || 0,
        total: Number(total) > 0 ? Number(total) : null,
        speed: Number(speed) > 0 ? Number(speed) : 0,
        eta: Number(eta) > 0 ? Number(eta) : null
      });
    }
  });

  const files = (await fs.readdir(directory)).filter(name => name.startsWith('media.') && !name.endsWith('.part'));
  if (!files.length) throw new Error('The extractor finished without producing a file.');
  const produced = path.join(directory, files.sort((a, b) => (a.endsWith('.mp4') ? -1 : 1))[0]);
  const stat = await fs.stat(produced);
  if (!stat.size) throw new Error('The extractor produced an empty file.');
  return { path: produced, size: stat.size };
}
