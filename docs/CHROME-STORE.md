# Chrome Web Store submission — RedX Downloader companion

Upload `dist/RedX-Downloader-Extension.zip` at
<https://chrome.google.com/webstore/devconsole>. The archive already has
`manifest.json` at its root and contains only runtime files (the `*.test.cjs`
suites and the Firefox manifest are excluded).

## Listing fields

| Field | Value |
| --- | --- |
| Name | RedX Downloader |
| Short name | RedX |
| Version | 2.0.0 |
| Category | Productivity |
| Language | English |
| Icon | `icons/icon128.png` (from the archive) |

**Short description (132 characters max)**

```
Send links and videos from your browser to RedX Downloader on Windows. Nothing is downloaded inside the browser.
```

**Detailed description**

```
RedX Downloader companion connects your browser to the RedX Downloader desktop app for Windows.

• Hand a link straight to RedX instead of the browser's own downloader
• Detect real video formats on the page you are watching and pick the quality you want
• One-click download for selected links, plus a video button over supported players
• See recent desktop activity and connection status in the popup
• Optional: keep the browser in charge when RedX is not running

RedX Downloader for Windows does the actual transfer: segmented downloads, verified resume, queue and scheduler, checksum verification and per-category folders. This extension only passes links and media information to that desktop app.

The extension does not download files by itself, does not proxy your traffic, and does not send anything to a remote server. Communication is local, to the desktop application on the same computer.
```

## Review notes (permission justification)

| Permission | Why it is needed |
| --- | --- |
| `nativeMessaging` | The only channel to the local RedX application; no remote endpoint exists. |
| `webRequest` | Detect when the page starts a file download so the request can be handed to RedX before the browser saves it. |
| `downloads` | Cancel the browser's own transfer once RedX has accepted the same file, so the file is not downloaded twice. |
| `contextMenus` | "Download with RedX" entries on links, media and selected text. |
| `storage` | Remember the two popup switches and the local connection state. |
| `activeTab` | Read the current tab's media list when the popup opens, without broad tab access. |
| Host permissions `http://*/*`, `https://*/*` | The extension must work on any site the user downloads from; media detection is content-script based and stays in the page. |

**Single purpose statement**

```
Pass download links and detected media from the browser to the RedX Downloader desktop application.
```

**Remote code**

```
No remote code. All scripts are bundled in the package; nothing is fetched and evaluated at runtime.
```

**Data usage**

The extension stores two preferences and the local connection state. It does not
collect browsing history, does not transmit page content, and has no analytics.
Disclose "Website content" as processed locally for media detection, and state
that nothing is sold or transferred to third parties.

## Before you submit

1. Chrome requires a privacy policy URL when the extension handles website
   content — host one on your site and paste the URL in the dashboard.
2. The store listing needs at least one 1280×800 or 640×400 screenshot of the
   popup; capture it at `chrome://extensions` → RedX → popup.
3. `nativeMessaging` still requires the desktop app to register its native host
   (`desktop/browser-setup.cjs`). Store review only checks the permission, not
   the local registration, but the extension stays "not connected" until the
   app is installed and the host is registered.
4. Keep the Firefox variant (`extension/manifest.firefox.json`) out of this
   archive — it is packaged separately if you publish to AMO.
