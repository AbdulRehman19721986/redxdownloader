# Interface pipeline

How the RedX Downloader window that users see is produced, and what the release
gate checks before an installer is published.

## What ships

`renderer/index.html`, `renderer/app.js` and `renderer/styles.css` are the
production interface. They are packaged **inside** `app.asar` by
`electron-builder` and loaded by `desktop/main.cjs` with
`window.loadFile(path.join(root, 'renderer', 'index.html'))`. There is no
second window, no external UI folder and no runtime download of interface
files: the `.exe` cannot start without them, and `node scripts/verify-ui.cjs
--packaged dist/win-unpacked` proves the archived bytes are identical to the
ones in this checkout.

The Electron runtime is deliberate. It hosts the parts of the product that
cannot be re-implemented without losing behaviour:

- `core/engine.mjs` — segmented transfers, verified resume, retries, stall
  recovery, queue/scheduler, SHA-256, duplicate detection.
- `core/hls.mjs`, `core/mux.mjs`, `core/ytdlp.mjs` — HLS and yt-dlp/FFmpeg
  extraction.
- `core/bridge.mjs` + `extension/` + `integration/` — the browser hand-off.
- `desktop/main.cjs` — AppUserModelID, tray, single instance, notifications,
  per-download windows.

## Mapping to the design mockups

| Mockup element | Implementation |
| --- | --- |
| Title bar, brand, version badge | `.titlebar`, `#brand-version` (`app.getVersion()`) |
| Tasks / File / Downloads / View / Help | `#menubar`, `wireMenus()` in `renderer/app.js` |
| 3D command ribbon (10 commands) | `.ribbon`, `.cmd`, `.ribbon-sep` |
| LED transfer gauge | `#speed-gauge`, `updateGauge()` |
| Categorised sidebar with counts | `.sidebar`, `.nav-item`, `#count-*` |
| Data grid (name/size/progress/status/rate/time left) | `.grid-head`, `.row`, CSS `order` on cells |
| Glossy progress bars with inline percentage | `.bar`, `.pct` inside the fill track |
| Per-file type badges | `badgeFor()` extension → tone + glyph |
| Status bar totals | `.statusbar`, `#list-count`, `#completed-count`, `#conn-state` |
| Transfer window with tabs, detail rows, numbered streams | `#progress-view`, `.p-rows`, `.stream` |

## The Dart files in `lib/`

`lib/redx_downloader_app.dart` and `lib/core/engine.dart` are the Flutter
**design reference** for this interface: the widget tree, colours, ribbon
geometry and the eight-stream layout in the transfer window were taken from
them. They are not compiled into the Windows build, because:

1. No Flutter SDK, Dart SDK or Visual Studio C++ toolchain is present in the
   build environment, so `flutter build windows` cannot run here.
2. `lib/core/engine.dart` is a 109-line segmented HTTP sketch. It has no
   pause/resume, queue, scheduler, checksums, HLS, yt-dlp or browser bridge.
   Shipping it would silently remove most of the product's functionality.

To move the interface onto Flutter later, the engine must first be reachable
from Dart (the local HTTP bridge in `core/bridge.mjs` is the natural seam), and
`pubspec.yaml` needs the desktop target plus `flutter create --platforms=windows .`
to generate the `windows/` runner. Until that work is done, the renderer
described above is the shipped interface, and these files stay as the spec.

## Release gate

`scripts/verify-ui.cjs` runs twice per release (`npm run dist:all`):

1. **Before packaging** — the working tree must contain the ribbon, gauge,
   menu bar, data grid, status bar and transfer-window stream panel; every
   selector `app.js` queries must exist in the markup; referenced assets must
   resolve.
2. **After packaging** — the asar must contain `renderer/*`, those bytes must
   be identical to the sources, the shell markers must still be present, and
   `assets/app-icon.ico` must be inside the package.

A mismatch prints the differing files and exits non-zero, so an installer built
from an older renderer cannot be published. `build/ui-manifest.json` records the
SHA-256 of each interface file for the build.
