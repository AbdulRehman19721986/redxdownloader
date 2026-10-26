# RedX Downloader

A Windows download manager with a dark red interface, verified resumable transfers, page-based
extraction for video sites and a browser video button for Chrome, Edge and Firefox.

**Owner & Developed by Abdur Rehman Rajput**
**A Project of Team RedX**

RedX Downloader is an independent product. It is not affiliated with, endorsed by, or a replacement
for Internet Download Manager; it uses its own logo, branding and code.

## Download and run (portable)

The public release ships **one** application binary: **`RedX-Downloader-Portable.exe`** (Windows 10/11, x64).
No installer is required and nothing is written into the executable.

1. Download `RedX-Downloader-Portable.exe` from the Releases page.
2. Compare its SHA-256 with the value in the release notes:

   ```powershell
   Get-FileHash .\RedX-Downloader-Portable.exe -Algorithm SHA256
   ```

3. Run it. Windows SmartScreen may warn about an unknown publisher because the build is
   **unsigned** — that is expected, and it is not a statement that Microsoft verified it.
4. Pick your download folder in **Settings → Downloads**. Personal data (history, settings,
   partial transfers, logs) lives in `%USERPROFILE%\.redx-downloader`, never inside the EXE.
5. To update, keep that folder, replace the EXE with the newer portable build, and start it again.

A desktop shortcut is optional: right-click the EXE → **Send to → Desktop (create shortcut)**.

The NSIS installer still exists for local testing (`npm run dist`) but is intentionally **not**
published as a release asset.
## Supported sources

| Source | How it is handled |
| --- | --- |
| Direct HTTP/HTTPS files | Segmented range requests, resume, checksum verification |
| HLS VOD (`.m3u8`) | Segment download, optional audio track, muxed to MP4 |
| YouTube (`watch`, `youtu.be`, `/shorts/`, embed) | `yt-dlp` format discovery (up to 2160p) + FFmpeg merge |
| TikTok video pages and `vm.tiktok.com` short links | `yt-dlp` extraction, signed stream fetched at download time |
| X / Twitter posts with video | `yt-dlp` extraction with MP4 variants |
| Any other page with Open Graph video | Generic `og:video` / `<video>` extraction |
| Browser-detected media | Extension captures the media URL and hands it over |

YouTube, TikTok and X resolve through `core/extract.mjs` and the bundled `vendor/yt-dlp.exe`
(YouTube). Both tools ship inside the installer, so a packaged build needs no external downloads.

## Features

- **Segmented transfers** with byte-range requests, adaptive connection counts and a global speed limit.
- **Verified resume** — ETag/validator checks, range validation and segment bookkeeping mean an
  interrupt (pause, network loss, crash, restart) continues from proven bytes instead of starting over.
- **Stall watchdog** — a connection that stops producing data is recycled with backoff and jitter.
- **Quality selection that reflects reality** — the menu lists only formats the extractor returned.
  If 1080p is unavailable the app says so instead of mislabelling a smaller file.
- **Queue and scheduler** — priorities, reordering, a concurrency limit and start times that follow
  your local clock. Queue state survives a restart.
- **SHA-256 verification** — every completed file is hashed and compared with an optional expected
  checksum. File size and cryptographic integrity are reported separately.
- **Duplicate detection** — normalised links and destination names are checked before adding a job;
  nothing is overwritten or deleted without an explicit choice.
- **Smart categories** — Video, Music, Documents, Programs, Archives, Images and Other.
- **Clipboard monitor** (off by default) — offers a download when a copied link is a single direct file.
- **Live network monitor** — aggregate and per-download speed, session total and a graph that stops
  drawing when hidden.
- **Per-download window** — a compact IDM-style dialog with status, source address, size, speed,
  remaining time, resume capability, per-segment details, its own speed limit and a completion action.
  Closing it never cancels the transfer; **Open RedX** returns to the full window with the same job.
- **Download start behaviour** — *Start automatically after quality selection* (default), *Ask every
  time*, or *Add to queue for later*. In automatic mode a single quality choice is enough; there is no
  second Download Now / Download Later prompt.
- **Browser integration** — Chrome, Edge and Firefox hand links and detected video to the desktop app;
  supported pages get a RedX Download button with a quality menu. Optional interception of ordinary
  browser downloads routes files to RedX before the browser saves them.
- **Optional browser session** — Settings → Browser can let the extractor read your own signed-in
  Chrome/Edge/Firefox profile for sites that require it. The profile is read locally; nothing is
  uploaded or written to logs, and the choice is opt-in.

## Development

Requirements: Windows 10/11, Node.js 20+, npm.

```bash
npm ci
npm start          # launch the desktop app from source
npm test           # full automated suite
npm run icons      # regenerate PNG/ICO assets from assets/*.svg
npm run preview    # renderer-only harness with sample data (dev only)
```

`vendor/yt-dlp.exe` is required for YouTube. A fresh clone does not include the binary; place the
official release build there before running, or YouTube downloads report a missing extractor.

## Tests

```bash
npm test                                   # everything (85 tests)
node --test tests/engine.test.mjs          # engine, ranges, resume, queue
node --test tests/redx-features.test.mjs   # resume after restart, stalls, ETag, checksums,
                                           # duplicates, speed limit, scheduler, clipboard
node --test tests/extract.test.mjs         # TikTok/X parsing, quality picking, provider wiring
node --test tests/workflow.test.mjs        # start behaviour, per-download limit, completion action
node --test integration/native-host.test.cjs
node --test extension/lifecycle.test.cjs   # content-script lifecycle and messaging
```

Engine tests run against local HTTP servers that implement ranges, ETags, stalls and interruptions;
assertions compare the bytes and hashes that land on disk, not progress counters.

Live checks used during development (network required, not part of `npm test`):

```bash
node scripts/live-check.mjs    # YouTube format list + TikTok page resolution
node scripts/yt-e2e.mjs        # real 360p YouTube download, verifies merged video+audio streams
node scripts/packaged-youtube.cjs   # same flow against the built application
node scripts/tiktok-e2e.mjs        # TikTok page URL resolved and downloaded by the extractor
```

## Windows build

```bash
npm run dist:all        # NSIS installer + portable executable, x64
npm run dist            # installer only
npm run dist:portable   # portable only
npm run package         # unpacked folder for inspection
```

Output goes to `release/`:

| Artifact | Purpose |
| --- | --- |
| `release/RedX-Downloader-Setup.exe` | NSIS installer, per-user, choose install folder |
| `release/RedX-Downloader-Portable.exe` | Single-file portable build |
| `release/win-unpacked/` | Unpacked application for diagnosis |

The installer bundles `resources/tools/yt-dlp.exe`, the unpacked FFmpeg binary and the browser
extension. `electron-builder` needs network access the first time to download the NSIS toolchain; it
is cached in `%LOCALAPPDATA%\electron-builder\Cache` afterwards.

The native-messaging launcher is compiled from `integration/NativeHostLauncher.cs` with the .NET
Framework compiler at first run into
`%USERPROFILE%\.redx-downloader\BrowserIntegration\integration\native-host.exe`.

## Browser extension

1. Start RedX Downloader and open **Browser integration** from the sidebar.
2. Select **Copy extension folder path**.
3. In Chrome/Edge open `chrome://extensions` (or `edge://extensions`), enable **Developer mode**.
4. Choose **Load unpacked**, paste the path and select the `extension` folder.
5. Reload any video page; the RedX **Download** button appears over supported players.

Firefox uses `extension/manifest.firefox.json` (`about:debugging` → **Load Temporary Add-on**). The
Firefox build has no YouTube player hooks; it handles direct media and HLS pages.

The popup has two real switches: **Show the Download button over videos** and **Send browser
downloads to RedX** (off by default — a browser download is cancelled only after RedX accepts it).

Native messaging registration writes `com.redx.downloader` manifests for the browsers found on the
machine. If the desktop app moves, restart it so the connector and manifests are rewritten.

## Requirements, resume and compatibility

- Resume needs a server that supports byte ranges **and** exposes a validator. Without both the file
  restarts from zero and the UI says so; RedX never appends incompatible bytes.
- DASH (`.mpd`) streams need a muxing engine that is not included.
- Live streams, DRM-protected media, private or sign-in-only videos are not supported.
- TikTok availability depends on the page publishing its video data; private, region-locked or
  removed posts return a clear error.
- X/Twitter does not publish stream heights in its public metadata, so variants are labelled by
  bitrate instead of an invented resolution.
- A requested resolution is only used when the extractor returned it; otherwise the nearest lower
  quality is used and the download records a note explaining the substitution.
- Speed depends on the server and network; the limit is a ceiling, not a guarantee.
- Builds are unsigned.

## Troubleshooting

- **YouTube says the extractor is missing** — `vendor/yt-dlp.exe` is not present (development) or the
  packaged `resources/tools/yt-dlp.exe` was removed. Reinstall or restore the binary.
- **Extension says the connector is missing** — open Browser setup, confirm `native-host.exe` exists in
  `%USERPROFILE%\.redx-downloader\BrowserIntegration\integration`, then reload extension and page.
- **Video button does not appear** — reload the page after installing; some players load late. The
  button hides on very small players by design.
- **TikTok returns HTTP 403** — the link is a captured CDN URL that has expired. Use the download
  button on the TikTok page (or paste the page address, not the CDN address) so RedX can resolve a
  fresh stream. If a site needs your session, enable Browser session in Settings → Browser.
- **A download will not resume** — the server omitted `Accept-Ranges`/`ETag`; RedX reports that the
  source cannot resume rather than corrupting the partial file.
- **Diagnostics** — Settings → Diagnostics shows versions, paths and the tail of
  `%USERPROFILE%\.redx-downloader\logs\redx.log`.
- **History and settings** live in `%USERPROFILE%\.redx-downloader\downloads.json`. Uninstalling keeps
  this folder and your downloads.


## Security and privacy

- Nothing is uploaded. There is no telemetry, analytics or account system.
- Only opt-in features read anything outside the app: the clipboard monitor (off by default) and
  the browser-session option (off by default).
- Logs rotate at 1 MB in `%USERPROFILE%\.redx-downloader\logs`. Cookies, authorisation headers and
  signed query strings are never written; URLs are truncated.
- Builds are unsigned. Verify the published SHA-256 before running a file from anywhere else.
- Report a vulnerability through GitHub private advisories — see [SECURITY.md](SECURITY.md).

## Updating from an older portable build

Your data is separate from the executable. Quit RedX, move the old EXE to the Recycle Bin, place the
new one in the same folder (or anywhere), and start it. History, settings and resumable partial
files in `%USERPROFILE%\.redx-downloader` are reused; a download interrupted by the update resumes
from its verified bytes.

## Licensing

Project code is MIT licensed — see [LICENSE](LICENSE). Third-party components keep their own terms;
see [THIRD-PARTY.md](THIRD-PARTY.md). FFmpeg and yt-dlp are used under their respective licences;
`googlevideo` retains its own. The RedX name, logo and interface are original artwork for this project.
