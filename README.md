<!--
  REDX DOWNLOADER — GitHub README
  Project: https://github.com/AbdulRehman19721986/RedXDownloader
  Owner & Developer: Abdur Rehman Rajput | A Project of Team RedX
-->

<p align="center">
  <img src="https://capsule-render.vercel.app/api?type=waving&color=0:111111,55:7f0000,100:ff3030&height=190&section=header&text=REDX%20DOWNLOADER&fontSize=42&fontColor=ffffff&fontAlignY=36&desc=FAST%20%E2%80%A2%20RELIABLE%20%E2%80%A2%20VERIFIED&descSize=16&descAlignY=58&animation=fadeIn" alt="RedX Downloader banner" width="100%" />
</p>

<p align="center">
  <img src="https://readme-typing-svg.demolab.com?font=JetBrains+Mono&weight=700&size=20&duration=2600&pause=900&color=FF3030&center=true&vCenter=true&width=720&lines=A+modern+Windows+download+manager;Verified+resume.+Smart+queues.+Media+extraction.;A+Project+of+Team+RedX" alt="Animated RedX Downloader tagline" />
</p>

<p align="center">
  <a href="https://github.com/AbdulRehman19721986/RedXDownloader/releases/latest/download/RedX-Downloader-Portable.exe">
    <img src="https://img.shields.io/badge/⬇%20DOWNLOAD%20FOR%20WINDOWS-PORTABLE%20EXE-cb171e?style=for-the-badge&logo=windows&logoColor=white" alt="Download RedX Downloader for Windows" />
  </a>
  &nbsp;
  <a href="https://github.com/AbdulRehman19721986/RedXDownloader/releases">
    <img src="https://img.shields.io/badge/ALL%20RELEASES-VERSIONS%20%26%20NOTES-242424?style=for-the-badge&logo=github&logoColor=white" alt="View all RedX Downloader releases" />
  </a>
  &nbsp;
  <a href="#windows-build">
    <img src="https://img.shields.io/badge/BUILD%20SETUP-Developer%20Guide-8b0000?style=for-the-badge&logo=windows&logoColor=white" alt="Build the Windows setup locally" />
  </a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/OS-Windows%2010%20%7C%2011-222222?style=flat-square&logo=windows&logoColor=00ADEF" alt="Windows 10 and 11" />
  <img src="https://img.shields.io/badge/Architecture-x64-222222?style=flat-square" alt="x64 architecture" />
  <img src="https://img.shields.io/badge/Runtime-Node.js%2020%2B-222222?style=flat-square&logo=nodedotjs&logoColor=339933" alt="Node.js 20 or newer" />
  <img src="https://img.shields.io/badge/License-MIT-222222?style=flat-square&logo=opensourceinitiative&logoColor=white" alt="MIT license" />
  <img src="https://img.shields.io/github/v/release/AbdulRehman19721986/RedXDownloader?display_name=tag&style=flat-square&color=cb171e" alt="Latest release" />
</p>

<p align="center">
  <b>Owner &amp; Developer: Abdur Rehman Rajput</b><br />
  <b>A Project of Team RedX</b>
</p>

> [!IMPORTANT]
> The public release is intended to provide **`RedX-Downloader-Portable.exe`** for Windows 10/11 (x64). The direct-download button works when a published GitHub release contains that exact asset. The NSIS installer is currently for local testing and is **not published as a release asset**. Use the portable download unless a future release explicitly offers a setup installer.

---

## ◈ Contents

- [About RedX](#-about-redx)
- [Download for Windows](#-download-for-windows)
- [Features](#-features)
- [Supported Sources](#-supported-sources)
- [Install, Run & Update](#-install-run--update)
- [Browser Extension](#-browser-extension)
- [Requirements & Compatibility](#-requirements--compatibility)
- [Development](#-development)
- [Tests](#-tests)
- [Windows Build](#-windows-build)
- [Troubleshooting](#-troubleshooting)
- [Security & Privacy](#-security--privacy)
- [License & Credits](#-license--credits)

---

## 🔴 About RedX

**RedX Downloader** is a Windows download manager with a dark-red interface, verified resumable transfers, page-based media extraction, and a browser video button for Chrome, Edge, and Firefox.

It is built around an important idea: a download manager should do more than show a progress bar. RedX focuses on reliable transfers, honest quality selection, queue control, integrity checks, and practical browser integration.

**RedX Downloader is an independent product.** It is not affiliated with, endorsed by, or a replacement for Internet Download Manager (IDM). RedX uses its own branding, logo, interface, and code.

## ⬇️ Download for Windows

<p align="center">
  <a href="https://github.com/AbdulRehman19721986/RedXDownloader/releases/latest/download/RedX-Downloader-Portable.exe">
    <img src="https://img.shields.io/badge/GET%20REDX%20DOWNLOADER-Download%20Portable%20EXE-cb171e?style=for-the-badge&logo=windows&logoColor=white" alt="Download the portable Windows application" />
  </a>
  <br />
  <a href="https://github.com/AbdulRehman19721986/RedXDownloader/releases">
    <img src="https://img.shields.io/badge/BROWSE%20RELEASES-View%20all%20versions-343434?style=for-the-badge&logo=github&logoColor=white" alt="Browse all releases" />
  </a>
</p>

| Download option | Availability | Details |
|---|---|---|
| **Portable for PC** | Public release asset | Download `RedX-Downloader-Portable.exe`. No installer is required. |
| **Setup / NSIS installer** | Not currently published | Build it locally with `npm run dist`, or check future [releases](https://github.com/AbdulRehman19721986/RedXDownloader/releases). |
| **Source code** | This repository | Clone or download the repository and follow the development steps below. |

### Verify your download

After downloading the portable EXE, open PowerShell in the download folder and calculate its SHA-256 hash:

```powershell
Get-FileHash .\RedX-Downloader-Portable.exe -Algorithm SHA256
```

Compare the result with the SHA-256 value published in the corresponding release notes before running the file.

---

## ✨ Features

<table>
  <tr>
    <td width="50%">
      <h3>⚡ Segmented Transfers</h3>
      Byte-range requests, adaptive connection counts, and a global speed limit help make direct downloads efficient.
    </td>
    <td width="50%">
      <h3>🛡️ Verified Resume</h3>
      Validator checks, range validation, and segment bookkeeping help resume from verified bytes after pauses, network loss, crashes, or restarts.
    </td>
  </tr>
  <tr>
    <td>
      <h3>🩺 Stall Watchdog</h3>
      Stalled connections can be recycled with backoff and jitter instead of being left stuck indefinitely.
    </td>
    <td>
      <h3>🎞️ Honest Quality Selection</h3>
      Quality options reflect formats actually returned by the extractor. RedX does not label a smaller file as a resolution that is unavailable.
    </td>
  </tr>
  <tr>
    <td>
      <h3>📋 Queue &amp; Scheduler</h3>
      Priorities, reordering, concurrency limits, scheduled start times based on your local clock, and queue persistence across restarts.
    </td>
    <td>
      <h3>🔐 SHA-256 Integrity Checks</h3>
      Completed files can be hashed and compared with an optional expected checksum. File size and cryptographic integrity are reported separately.
    </td>
  </tr>
  <tr>
    <td>
      <h3>🧹 Duplicate Detection</h3>
      Normalized links and destination names are checked before a job is added. Existing files are not overwritten or deleted without an explicit choice.
    </td>
    <td>
      <h3>🗂️ Smart Categories</h3>
      Automatically organize downloads as Video, Music, Documents, Programs, Archives, Images, or Other.
    </td>
  </tr>
  <tr>
    <td>
      <h3>📋 Clipboard Monitor</h3>
      Optional and off by default. Offers to download a copied link when it appears to be a single direct file.
    </td>
    <td>
      <h3>📈 Live Network Monitor</h3>
      View aggregate and per-download speeds, session totals, and a graph that stops drawing when hidden.
    </td>
  </tr>
  <tr>
    <td>
      <h3>🪟 Per-Download Window</h3>
      A compact download dialog with status, source, size, speed, remaining time, resume capability, segment details, its own speed limit, and a completion action. Closing it does not cancel the transfer.
    </td>
    <td>
      <h3>🌐 Browser Integration</h3>
      Chrome, Edge, and Firefox integration passes links and detected media to RedX. Supported pages can display a RedX Download button with a quality menu.
    </td>
  </tr>
</table>

Additional controls include:

- **Download start behavior:** Start automatically after quality selection (default), ask every time, or add to the queue for later. Automatic mode does not require a second Download Now / Download Later prompt.
- **Optional browser session:** Settings → Browser can allow the extractor to read a locally installed browser profile for supported sites that require a signed-in session. This is opt-in.
- **Optional browser download interception:** Route ordinary browser downloads through RedX. The extension setting is off by default; the browser download is cancelled only after RedX accepts it.
- **Persistent personal data:** History, settings, and partial transfers are stored separately from the executable.

---

## 🌍 Supported Sources

| Source | Handling |
|---|---|
| Direct HTTP/HTTPS files | Segmented range requests, resume, and checksum verification |
| HLS VOD (`.m3u8`) | Segment download, optional audio track, and muxing to MP4 |
| YouTube (`watch`, `youtu.be`, `/shorts/`, embed) | `yt-dlp` format discovery (up to 2160p when available) plus FFmpeg merge |
| TikTok video pages and `vm.tiktok.com` short links | `yt-dlp` extraction; signed stream fetched at download time |
| X / Twitter posts with video | `yt-dlp` extraction with MP4 variants |
| Other pages with Open Graph video | Generic `og:video` / `<video>` extraction |
| Browser-detected media | Browser extension captures the media URL and passes it to the desktop app |

YouTube, TikTok, and X media resolution uses `core/extract.mjs` and `vendor/yt-dlp.exe` (for YouTube). The packaged build is designed to include its required media tools so users do not need to download them separately.

---

## 🚀 Install, Run & Update

### Run the portable application

1. Open the [GitHub Releases page](https://github.com/AbdulRehman19721986/RedXDownloader/releases).
2. Download **`RedX-Downloader-Portable.exe`** from the release assets.
3. Optionally verify its SHA-256 hash using the command shown above.
4. Run the EXE. Windows SmartScreen may warn about an unknown publisher because the build is unsigned; this is not evidence that Microsoft has verified the file.
5. Choose your destination folder in **Settings → Downloads**.

### Where RedX stores data

User data is stored in:

```text
%USERPROFILE%\.redx-downloader
```

This folder can contain history, settings, partial transfers, and logs. Personal data is not stored inside the portable executable.

### Create a desktop shortcut

Right-click `RedX-Downloader-Portable.exe` → **Send to → Desktop (create shortcut)**.

### Update an existing portable installation

1. Quit RedX Downloader.
2. Keep `%USERPROFILE%\.redx-downloader` and your downloaded files.
3. Replace the old EXE with the new portable EXE. You can keep it in the same folder or move it elsewhere.
4. Launch the new build. RedX reuses the saved history, settings, and resumable partial files where the source supports verified resume.

---

## 🧩 Browser Extension

### Chrome and Edge

1. Start RedX Downloader and open **Browser integration** from the sidebar.
2. Select **Copy extension folder path**.
3. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge.
4. Enable **Developer mode**.
5. Select **Load unpacked** and choose the `extension` folder at the copied path.
6. Reload a supported video page. The RedX **Download** button should appear over supported players.

### Firefox

Firefox uses `extension/manifest.firefox.json`:

1. Open `about:debugging`.
2. Select **This Firefox** and **Load Temporary Add-on**.
3. Choose the appropriate extension manifest/file from the extension directory.

The Firefox build does not include YouTube player hooks; it handles direct media and HLS pages.

### Extension switches

The extension popup has two options:

- **Show the Download button over videos**
- **Send browser downloads to RedX** — off by default

Native messaging registration creates `com.redx.downloader` manifests for browsers found on the machine. If you move the desktop app, restart it so the connector and manifests can be rewritten.

---

## ⚙️ Requirements & Compatibility

- **Supported desktop OS:** Windows 10/11, x64.
- **Development environment:** Node.js 20+ and npm.
- **Resume:** The server must support byte ranges and expose a validator. Without both, RedX restarts the file from zero and reports that resume is unavailable instead of appending incompatible data.
- **DASH (`.mpd`):** Requires a muxing engine that is not included.
- **Live streams, DRM-protected media, private videos, and sign-in-only videos:** Not supported.
- **TikTok:** Availability depends on the page publishing its video data. Private, region-locked, or removed posts may return an error.
- **X / Twitter:** Public metadata may not expose stream heights, so variants are labelled by bitrate rather than an invented resolution.
- **Requested quality:** If the requested resolution is unavailable, RedX uses the nearest lower quality returned by the extractor and records a note explaining the substitution.
- **Speed:** Depends on the source server and network. A speed limit is a ceiling, not a speed guarantee.
- **Signing:** Published builds are unsigned.

---

## 🧑‍💻 Development

### Prerequisites

- Windows 10/11 (x64)
- Node.js 20 or newer
- npm

### Install dependencies and start

```bash
npm ci
npm start          # Launch the desktop app from source
npm test           # Run the automated test suite
npm run icons      # Regenerate PNG/ICO assets from assets/*.svg
npm run preview    # Renderer-only harness with sample data (development only)
```

`vendor/yt-dlp.exe` is required for YouTube in a fresh development clone. Place the official release binary there before running YouTube tests or downloads; otherwise the app reports that the extractor is missing. Packaged builds should include the required tools under their packaged resource paths.

---

## 🧪 Tests

```bash
npm test                                      # Full automated suite
node --test tests/engine.test.mjs             # Engine, ranges, resume, queue
node --test tests/redx-features.test.mjs      # Resume after restart, stalls, ETag, checksums,
                                              # duplicates, speed limit, scheduler, clipboard
node --test tests/extract.test.mjs            # TikTok/X parsing, quality picking, provider wiring
node --test tests/workflow.test.mjs           # Start behavior, per-download limit, completion action
node --test integration/native-host.test.cjs
node --test extension/lifecycle.test.cjs     # Content-script lifecycle and messaging
```

The project documentation describes the full suite as **85 tests**. Engine tests use local HTTP servers that simulate byte ranges, ETags, stalls, and interruptions. Assertions compare the bytes and hashes written to disk rather than relying only on progress counters.

### Network-dependent live checks

These scripts require network access and are not part of `npm test`:

```bash
node scripts/live-check.mjs          # YouTube format list + TikTok page resolution
node scripts/yt-e2e.mjs              # Real 360p YouTube download; validates merged audio/video
node scripts/packaged-youtube.cjs     # Same flow against the built application
node scripts/tiktok-e2e.mjs           # Resolve and download a TikTok page URL
```

---

## 🏗️ Windows Build

Build distributable files from source with:

```bash
npm run dist:all        # NSIS installer + portable executable, x64
npm run dist            # NSIS installer only
npm run dist:portable   # Portable executable only
npm run package         # Unpacked application folder for inspection
```

Build output goes to `release/`:

| Artifact | Purpose |
|---|---|
| `release/RedX-Downloader-Setup.exe` | NSIS per-user installer; choose an install folder |
| `release/RedX-Downloader-Portable.exe` | Single-file portable build |
| `release/win-unpacked/` | Unpacked application for diagnosis |

**Release policy:** The NSIS installer is currently for local testing and is intentionally not published as a GitHub release asset. The public download button targets the portable EXE. If the installer is published in a future release, add the corresponding asset link to this README.

`electron-builder` needs network access the first time to download the NSIS toolchain. Afterward, it is cached in `%LOCALAPPDATA%\electron-builder\Cache`.

The native-messaging launcher is compiled from `integration/NativeHostLauncher.cs` with the .NET Framework compiler on first run into:

```text
%USERPROFILE%\.redx-downloader\BrowserIntegration\integration\native-host.exe
```

---

## 🧯 Troubleshooting

| Problem | What to try |
|---|---|
| **YouTube says the extractor is missing** | In development, check `vendor/yt-dlp.exe`. In a packaged app, check `resources/tools/yt-dlp.exe`. Restore the missing binary or reinstall a complete build. |
| **Extension says the connector is missing** | Open Browser setup and confirm `native-host.exe` exists in `%USERPROFILE%\.redx-downloader\BrowserIntegration\integration`. Then reload the extension and page. |
| **Video button does not appear** | Reload the page after installing the extension. Some players load late, and the button is hidden on very small players by design. |
| **TikTok returns HTTP 403** | A captured CDN URL may have expired. Use the TikTok page URL or the RedX button to resolve a fresh stream, rather than pasting an old CDN URL. If the site requires a session, enable the optional Browser session setting. |
| **A download will not resume** | The server may omit `Accept-Ranges` or `ETag`. RedX reports that resume is unavailable instead of corrupting the partial file. |
| **Need diagnostics** | Open **Settings → Diagnostics** to view versions, paths, and the end of `%USERPROFILE%\.redx-downloader\logs\redx.log`. |
| **History or settings are missing** | Check `%USERPROFILE%\.redx-downloader\downloads.json` and make sure the correct Windows user account is being used. Uninstalling the app does not remove this folder. |

---

## 🔒 Security & Privacy

- RedX does not upload your download history to a project telemetry service. There is no built-in telemetry, analytics, or account system described by this project.
- Only opt-in features access data outside the app: clipboard monitoring (off by default) and browser-session access (off by default).
- Logs rotate at 1 MB in `%USERPROFILE%\.redx-downloader\logs`.
- Cookies, authorization headers, and signed query strings are not written to logs; URLs are truncated.
- Builds are unsigned. Verify the published SHA-256 before running a binary obtained from another location.
- To report a vulnerability, use [GitHub private vulnerability reporting](https://github.com/AbdulRehman19721986/RedXDownloader/security/advisories/new) if enabled for the repository; otherwise contact the repository owner privately.

---

## 📜 License & Credits

**Project:** RedX Downloader  
**Owner & Developer:** Abdur Rehman Rajput  
**Organization:** Team RedX  
**Platform:** Windows 10/11 (x64)  
**License:** [MIT](LICENSE)

Third-party components retain their own licences; review their upstream licence notices before redistribution. FFmpeg and yt-dlp are used under their respective licences, and `googlevideo` retains its own terms. The RedX name, logo, and interface are original project branding.

---

<p align="center">
  <img src="https://readme-typing-svg.demolab.com?font=JetBrains+Mono&weight=700&size=18&duration=2800&pause=1000&color=FF3030&center=true&vCenter=true&width=650&lines=DOWNLOAD+SMARTER.;KEEP+CONTROL.;TEAM+REDX+%F0%9F%94%B4" alt="Animated Team RedX signature" />
</p>

<p align="center">
  <a href="https://github.com/AbdulRehman19721986/RedXDownloader/releases"><b>⬇ View Releases</b></a>
  &nbsp; • &nbsp;
  <a href="https://github.com/AbdulRehman19721986/RedXDownloader"><b>⌘ Source Code</b></a>
  &nbsp; • &nbsp;
  <a href="LICENSE"><b>MIT License</b></a>
</p>

<p align="center"><sub>Built with care by Abdur Rehman Rajput · A Project of Team RedX</sub></p>
