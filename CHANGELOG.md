# Changelog

All notable changes to RedX Downloader are recorded here. The project uses semantic versioning
(`MAJOR.MINOR.PATCH`).

## [2.0.0] — 2026-10-26

Interface release. The download engine, sources and browser integration are unchanged;
the window was rebuilt to the RedX design mockups.

### Interface
- IDM-class chrome: title bar with version badge, Tasks/File/Downloads/View/Help menu bar,
  three-dimensional command ribbon (Add URL, Resume, Stop, Stop All, Delete, Delete Completed,
  Options, Scheduler, Start Queue, Stop Queue) with an LED transfer gauge.
- Categorised sidebar (All Downloads, Unfinished, Finished, Scheduled, Failed plus media types)
  with live counts and a collapse control.
- Data grid with file-type badges, glossy progress bars carrying the percentage inline,
  transfer rate and time-left columns, row hover/selection states.
- Status bar with live speed, visible/total counts, total size, completed bytes and connection state.
- Transfer window rebuilt: tabbed download status, URL/status/size/downloaded/rate/time-left/resume
  rows, large progress bar and numbered per-connection stream bars.
- Network monitor recoloured to the new accent; time-left now reads `2 min 31 sec`.
- Window chrome completes Windows conventions: title-bar double-click maximises, F11 and
  View → Full screen toggle full screen, and maximise/restore/full-screen state is pushed to
  the renderer so the caption buttons stay accurate.
- Toolbar skins (Steel, Midnight, Ice) in Options → Appearance, remembered per machine.
- View → Columns hides Size, Progress, Status, Transfer rate or Time left and persists the choice.
- Long ribbon captions wrap to two lines instead of truncating, matching IDM's "Delete Completed".

### Build
- Version 2.0.0; AppUserModelID `com.teamredx.downloader` and PE metadata unchanged.
- `scripts/verify-ui.cjs` gates every build: the release fails when the packaged asar does not
  contain a byte-identical, complete renderer (this is what previously shipped the older window).
- Progress window default size increased so all eight streams are visible without scrolling.
- `scripts/pack-extension.cjs` builds `dist/RedX-Downloader-Extension.zip` with `manifest.json`
  at the archive root and no test files; it fails when a manifest-referenced file is absent.
- `scripts/ui-e2e.cjs` drives the installed `.exe`: adds a link, checks the live gauge, pauses,
  resumes, opens the transfer window and compares the finished file byte for byte.
- Manifest and popup restyled to the desktop palette; version 2.0.0.

### Extension
- Fixed: every popup request was gated on `!sender.tab`, so opening `popup.html` anywhere other
  than the toolbar popup (including during store review) answered "Unsupported extension request.".
  Panel requests are now recognised by extension origin, and the popup reports the real
  connection state.
- Verified loading unpacked: manifest accepted, MV3 service worker starts, popup renders,
  25 extension tests pass.

## [1.0.0] — 2026-10-26

First public release. Owner & Developer: Abdur Rehman Rajput — A Project of Team RedX.

### Downloading
- Segmented HTTP/HTTPS transfers with byte-range validation and per-connection retries.
- Resume from verified on-disk bytes with ETag/validator checks; incompatible partial data is
  discarded instead of being combined.
- Stall detection that recycles a silent connection without losing completed segments.
- Queue with priorities, reordering, scheduled start times and a configurable concurrency limit.
- SHA-256 verification with explicit `verified` / `mismatch` / `unavailable` / `error` states.
- Duplicate detection by normalised link and destination name; nothing is overwritten silently.
- Smart categories, per-category folders, disk-space checks and Recycle-Bin file deletion.
- Unlimited speed by default; an optional global limit and a per-download limit are opt-in.

### Sources
- YouTube via the bundled `yt-dlp` extractor (formats up to 2160p, audio/video merged with FFmpeg).
- TikTok and X/Twitter page extraction with real, de-duplicated quality choices.
- HLS VOD with an optional separate audio track, muxed to MP4.
- Generic Open Graph / `<video>` fallback for pages that publish a media URL.

### Browser integration
- Chrome, Edge and Firefox extension that hands links and detected video to the desktop app.
- Early interception of direct file links, so the browser never starts its own transfer.
- Safe hand-off: a request id per click, acceptance before takeover, fallback to the browser when
  RedX cannot accept the request.
- Video overlay with an 8-second hover grace period, so the button stays reachable from a thumbnail.

### Application
- Custom frameless window, tray, single instance, saved window bounds and per-download windows.
- Compact monitor with status, speed, remaining time, resume state, per-segment detail, per-download
  speed limit and a completion action.
- Crash recovery: a dead renderer reloads automatically; uncaught main-process errors flush progress
  and restart through Electron with a loop guard; rotating logs in the user-data folder.

### Fixed
- YouTube extraction failed when `yt-dlp` was missing from the build.
- TikTok downloads returned HTTP 403 because an expired CDN link was replayed.
- TikTok quality menus showed repeated "Media" rows and rejected real labels such as `1280p`.
- The video overlay disappeared before the pointer could reach the button.
- A download could be shown as complete before its checksum finished.
- A killed renderer left a blank window with no recovery path.
