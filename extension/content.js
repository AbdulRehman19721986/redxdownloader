(() => {
  const api = globalThis.browser || chrome;
  const seen = new WeakSet();
  const records = new Set();
  let pending = false;
  let stopped = false, scanFrame, mutationObserver, scrollTimer, scrolling = false, overlayEnabled = true, interceptEnabled = true;
  const listeners = new AbortController();
  const resizeObserver = new ResizeObserver(() => position());
  const direct = value => { try { const u = new URL(value, location.href); return /^https?:$/.test(u.protocol) ? u.href : null; } catch { return null; } };

  const HOST = String(location.hostname || '').replace(/^www\./, '');
  const PAGE_PROVIDER = /(^|\.)(tiktok|twitter|x)\.com$/i.test(HOST);
  const FILE_LINK = /\.(exe|msi|msix|appx|zip|7z|rar|iso|pdf|dmg|pkg|deb|rpm|apk|tar|gz|tgz|bz2|xz|docx?|xlsx?|pptx?|epub|mp4|mkv|mov|avi|mp3|m4a|flac|wav|bin|img|vhd|vmdk)(?:[?#].*)?$/i;
  const ACTIVATION_MS = 1500;
  const GRACE_MS = 6000;

  const STYLE = `
:host{all:initial}
.bar{display:flex;justify-content:flex-end;align-items:center;gap:6px;font:12px/1 "Segoe UI",Inter,system-ui,sans-serif}
.download{
  display:inline-flex;align-items:center;gap:7px;height:30px;padding:0 12px 0 10px;
  border:1px solid rgba(255,74,90,.75);border-radius:9px;color:#fff;cursor:pointer;
  background:linear-gradient(180deg,#FF4757 0%,#FF2638 55%,#DC1229 100%);
  box-shadow:0 6px 16px rgba(0,0,0,.42),inset 0 1px 0 rgba(255,255,255,.22);
  font:600 12px/1 "Segoe UI",Inter,system-ui,sans-serif;letter-spacing:.01em;
  transition:filter 140ms ease,transform 140ms ease,box-shadow 140ms ease;
  opacity:0;transform:translateY(3px);animation:reveal 180ms cubic-bezier(.2,.75,.3,1) forwards;
}
.download:hover{filter:brightness(1.08);transform:translateY(-1px);opacity:1;box-shadow:0 9px 22px rgba(0,0,0,.5)}
.download:active{transform:translateY(0)}
.download:focus-visible,.dismiss:focus-visible,.row:focus-visible{outline:2px solid #fff;outline-offset:2px}
.download[aria-expanded="true"]{opacity:1}
.download svg{width:14px;height:14px;fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.chev{width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;border-top:5px solid rgba(255,255,255,.9);margin-left:1px}
.dismiss{
  width:24px;height:24px;display:grid;place-items:center;border-radius:7px;cursor:pointer;
  background:rgba(11,13,18,.72);border:1px solid rgba(255,255,255,.16);color:#C9D1DC;
  font:400 14px/1 "Segoe UI",sans-serif;backdrop-filter:blur(6px);
  transition:background 140ms ease,color 140ms ease;
}
.dismiss:hover{background:rgba(255,38,56,.9);color:#fff}
.chooser{
  position:fixed;width:min(340px,calc(100vw - 12px));max-height:min(320px,52vh);overflow:auto;
  background:#12161F;color:#F5F7FA;border:1px solid #293240;border-radius:12px;
  box-shadow:0 22px 50px rgba(0,0,0,.6);padding:6px;font:12px/1.3 "Segoe UI",Inter,system-ui,sans-serif;
  animation:rise 140ms cubic-bezier(.2,.7,.3,1);
}
@keyframes reveal{to{opacity:.96;transform:none}}
@keyframes rise{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
.chooser-head{display:flex;align-items:center;gap:7px;padding:6px 8px 8px;color:#A4ADBB;font-size:11px;letter-spacing:.05em;text-transform:uppercase}
.chooser-head b{width:6px;height:6px;border-radius:50%;background:#FF2638}
.row{
  display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:8px 9px;
  border:0;border-radius:8px;background:transparent;color:#F5F7FA;font:12px/1.3 "Segoe UI",Inter,system-ui,sans-serif;
  cursor:pointer;transition:background 120ms ease;
}
.row:hover:not(:disabled),.row:focus-visible{background:rgba(255,38,56,.16)}
.row:disabled{color:#6F7A8A;cursor:default}
.row .q{font-weight:650;min-width:64px}
.row .fmt{color:#A4ADBB;font-size:11px}
.row .sz{margin-left:auto;color:#A4ADBB;font-size:11px;font-variant-numeric:tabular-nums}
.row .note{color:#F2A03D;font-size:11px;margin-left:auto}
.best{font-size:9px;letter-spacing:.06em;text-transform:uppercase;color:#FF8B96;border:1px solid rgba(255,38,56,.4);border-radius:4px;padding:1px 4px}
.hint{margin:4px 8px 6px;color:#A4ADBB;font-size:11.5px;line-height:1.45}
.hint.err{color:#FF8591}
`;

  function shutdown() {
    if (stopped) return;
    stopped = true;
    listeners.abort();
    clearTimeout(scrollTimer);
    mutationObserver?.disconnect(); resizeObserver.disconnect();
    if (scanFrame !== undefined) cancelAnimationFrame(scanFrame);
    for (const record of records) { clearTimeout(record.activationTimer); clearTimeout(record.hideTimer); record.sourceObserver?.disconnect(); record.host.remove(); }
    records.clear();
    try { api.runtime.onMessage.removeListener(onMessage); } catch { /* context gone */ }
    try { api.storage.onChanged.removeListener(onStorageChanged); } catch { /* context gone */ }
  }
  function connected() {
    if (stopped) return false;
    try { if (api.runtime.id) return true; } catch { /* invalidated */ }
    shutdown(); return false;
  }
  async function send(message) {
    if (!connected()) throw new Error('The extension was reloaded. Refresh this page to reconnect.');
    try { return await api.runtime.sendMessage(message); }
    catch (error) { if (/extension context invalidated/i.test(error?.message || '')) shutdown(); throw error; }
  }

  /* ---------------------------------------------------------------- overlay */
  function mount(video) {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;z-index:2147483647;display:none;pointer-events:auto';
    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `<style>${STYLE}</style>
      <div class="bar">
        <button class="download" type="button" aria-haspopup="true" aria-expanded="false" aria-label="Download this video with RedX Downloader">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v10M7.5 10.5L12 15l4.5-4.5M5 19h14"/></svg>
          <span class="label">Download</span><span class="chev" aria-hidden="true"></span>
        </button>
        <button class="dismiss" type="button" title="Hide this button" aria-label="Hide the RedX download button">×</button>
      </div>`;
    const button = shadow.querySelector('.download');
    const dismiss = shadow.querySelector('.dismiss');
    const record = { video, host, shadow, dismissed: false, hovering: false, sourceHovering: false, active: false, graceUntil: 0, activationTimer: null, hideTimer: null, lastRect: null };
    records.add(record);
    resizeObserver.observe(video);
    document.documentElement.appendChild(host);

    // Keep the control reachable while the pointer travels from a small
    // thumbnail to the button, and while the quality menu is open.
    // Optional chaining keeps minimal/legacy DOM hosts from breaking the mount.
    host.addEventListener?.('mouseenter', () => {
      record.hovering = true;
      record.graceUntil = 0;
      clearTimeout(record.hideTimer);
    });
    host.addEventListener?.('mouseleave', () => {
      record.hovering = false;
      if (!record.shadow.querySelector('.chooser')) armGrace(record);
    });
    video.addEventListener('pointerenter', () => {
      record.sourceHovering = true;
      clearTimeout(record.hideTimer);
      if (record.active || record.activationTimer) return;
      record.activationTimer = setTimeout(() => {
        record.activationTimer = null;
        if (!record.sourceHovering || record.dismissed || stopped) return;
        record.active = true;
        record.graceUntil = 0;
        position();
      }, ACTIVATION_MS);
    }, { signal: listeners.signal });
    video.addEventListener('pointerleave', () => {
      record.sourceHovering = false;
      clearTimeout(record.activationTimer);
      record.activationTimer = null;
      if (record.active && !record.hovering && !record.shadow.querySelector('.chooser')) armGrace(record);
    }, { signal: listeners.signal });

    const report = () => {
      const urls = [video.currentSrc, video.src, ...Array.from(video.querySelectorAll('source'), source => source.src)].map(direct).filter(Boolean);
      if (urls.length) send({ action: 'remember', items: urls.map(url => ({ url, title: document.title })) }).catch(() => {});
    };
    video.addEventListener('loadedmetadata', report, { signal: listeners.signal });
    record.sourceObserver = new MutationObserver(report);
    record.sourceObserver.observe(video, { attributes: true, attributeFilter: ['src'], subtree: true, childList: true });
    report();
    if (stopped) return;
    const initialRect = video.getBoundingClientRect?.();
    if (initialRect && initialRect.width >= 240 && initialRect.height >= 140) record.active = true;

    dismiss.addEventListener('click', event => {
      event.preventDefault(); event.stopPropagation();
      record.dismissed = true; record.active = false; clearTimeout(record.activationTimer);
      shadow.querySelector('.chooser')?.remove();
      button.setAttribute('aria-expanded', 'false');
      host.style.display = 'none';
    });
    button.addEventListener('click', async event => {
      event.preventDefault(); event.stopPropagation();
      const existing = shadow.querySelector('.chooser');
      if (existing) { existing.remove(); button.setAttribute('aria-expanded', 'false'); position(); return; }
      closeChoosers(record);
      record.graceUntil = 0; clearTimeout(record.hideTimer);
      const chooser = document.createElement('div');
      chooser.className = 'chooser';
      const head = document.createElement('div');
      head.className = 'chooser-head';
      head.innerHTML = '<b></b>RedX Downloader';
      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = 'Checking available formats…';
      chooser.append(head, hint);
      shadow.append(chooser);
      button.setAttribute('aria-expanded', 'true');
      position();
      try {
        // TikTok and X publish no usable direct link in the page, so their real
        // formats come from the desktop extractor rather than captured requests.
        const result = PAGE_PROVIDER
          ? await send({ action: 'listForPage', pageUrl: location.href })
          : await send({ action: 'listForFrame' });
        if (!result?.ok) throw new Error(result?.error || 'Could not list video formats.');
        let candidates = result?.items || [];
        if (!PAGE_PROVIDER) {
          const url = direct(video.currentSrc || video.src || video.querySelector('source')?.src);
          if (url && !candidates.some(item => item.url === url)) candidates.unshift({ url, title: document.title });
          candidates = globalThis.mediaChoices(candidates, { url, poster: video.poster });
        }
        if (!candidates.length) {
          hint.textContent = result.notice || (PAGE_PROVIDER ? 'No downloadable video found on this page.' : 'No direct media links detected. Play the video and try again.');
          return;
        }
        hint.remove();
        let bestMarked = false;
        candidates.forEach(item => {
          const row = document.createElement('button');
          row.className = 'row';
          row.type = 'button';
          const usable = !item.unsupported && Boolean(item.quality || item.url);
          row.disabled = !usable;
          row.title = item.reason || item.url || '';
          const quality = document.createElement('span');
          quality.className = 'q';
          quality.textContent = item.quality || 'Best available';
          const detail = document.createElement('span');
          detail.className = 'fmt';
          detail.textContent = [item.format, item.fps ? `${item.fps} fps` : '', item.bitrate ? `${Math.round(item.bitrate / 1000)} kbps` : ''].filter(Boolean).join(' · ');
          row.append(quality, detail);
          if (!bestMarked && usable) {
            const best = document.createElement('span');
            best.className = 'best';
            best.textContent = 'best';
            row.append(best);
            bestMarked = true;
          }
          if (!usable) {
            const note = document.createElement('span');
            note.className = 'note';
            note.textContent = 'Unavailable';
            row.append(note);
          } else if (Number(item.size) > 0) {
            const size = document.createElement('span');
            size.className = 'sz';
            size.textContent = `${(Number(item.size) / 1024 ** 2).toFixed(0)} MB`;
            row.append(size);
          }
          row.onclick = async click => {
            click.preventDefault(); click.stopPropagation();
            row.disabled = true;
            record.graceUntil = 0;
            const note = document.createElement('p');
            note.className = 'hint';
            note.textContent = 'Starting in RedX Downloader…';
            chooser.append(note);
            const payload = PAGE_PROVIDER
              // The canonical page URL lets the extractor mint a fresh signed
              // stream; replaying the captured CDN URL is what returned HTTP 403.
              ? { url: location.href, pageUrl: location.href, title: item.title || document.title, preferredQuality: item.quality || 'best', providerFormat: item.providerFormat, providerNeedsAudio: item.providerNeedsAudio, providerAudioFormat: item.providerAudioFormat, referer: location.href }
              : { ...item };
            try {
              const response = await send({ action: 'download', item: { ...payload, startNow: true, requestId: (crypto.randomUUID?.() || String(Date.now()) + Math.random()) } });
              note.textContent = response.ok
                ? response.mode === 'queue' ? 'Added to the RedX queue.'
                  : response.mode === 'ask' ? 'Opened in RedX Downloader for confirmation.'
                    : 'Download started in RedX Downloader.'
                : friendlyError(response.error);
              note.className = response.ok ? 'hint' : 'hint err';
            } catch (error) { note.textContent = friendlyError(error.message); note.className = 'hint err'; }
          };
          chooser.append(row);
        });
        position();
      } catch (error) {
        hint.textContent = friendlyError(error.message);
        hint.className = 'hint err';
      }
    });
  }

  function armGrace(record) {
    record.graceUntil = Date.now() + GRACE_MS;
    record.graceExpired = false;
    clearTimeout(record.hideTimer);
    record.hideTimer = setTimeout(() => { record.graceUntil = 0; record.graceExpired = true; position(); }, GRACE_MS + 40);
  }

  function scan() {
    pending = false;
    if (!connected()) return;
    for (const video of document.querySelectorAll('video')) {
      if (seen.has(video)) continue;
      seen.add(video);
      mount(video);
      if (stopped) return;
    }
    position();
  }

  function friendlyError(message) {
    return /native messaging host not found/i.test(message || '')
      ? `Chrome cannot find the RedX desktop connector. Open RedX Downloader → Browser setup → refresh, then reload this extension and page. (${message})`
      : message;
  }
  function closeChoosers(except) {
    for (const record of records) {
      if (record === except) continue;
      const chooser = record.shadow.querySelector('.chooser');
      if (chooser) { chooser.remove(); record.shadow.querySelector('.download')?.setAttribute?.('aria-expanded', 'false'); }
    }
    position();
  }
  function visibleFor(record) {
    const chooser = record.shadow.querySelector('.chooser');
    const video = record.video;
    if (record.dismissed || !overlayEnabled || scrolling || !record.active) return false;
    if (chooser || record.hovering || record.sourceHovering) return true;
    if (Date.now() < record.graceUntil) return true;
    if (!video.isConnected) return false;
    const rect = video.getBoundingClientRect();
    return rect.width > 160 && rect.height > 90 && rect.top >= 0 && rect.top < innerHeight - 40 && rect.right > 0 && rect.left < innerWidth;
  }
  function position() {
    if (!connected()) return;
    const now = Date.now();
    for (const record of records) {
      if (!record.video.isConnected) {
        clearTimeout(record.activationTimer);
        // A disappearing thumbnail always gets one full grace window, measured
        // from the moment it went away, so earlier hover timers cannot cut it short.
        if (!record.disconnectedAt) {
          record.disconnectedAt = now;
          // Re-check once the window closes so a detached control is removed even
          // when no further DOM mutation happens.
          clearTimeout(record.hideTimer);
          record.hideTimer = setTimeout(position, GRACE_MS + 60);
        }
        if (now - record.disconnectedAt < GRACE_MS || record.hovering) {
          const held = record.lastRect;
          if (held) {
            record.host.style.display = 'block';
            record.host.style.top = `${Math.max(6, Math.min(innerHeight - 36, held.top + 6))}px`;
            record.host.style.left = `${Math.max(6, Math.min(innerWidth - 156, held.right - 150))}px`;
          }
          continue;
        }
        resizeObserver.unobserve(record.video);
        record.sourceObserver.disconnect();
        clearTimeout(record.hideTimer);
        record.host.remove();
        records.delete(record);
        continue;
      }
      const fullscreen = document.fullscreenElement;
      const parent = fullscreen && fullscreen !== record.video && fullscreen.contains(record.video) ? fullscreen : document.documentElement;
      if (record.host.parentNode !== parent) parent.appendChild(record.host);
      const rect = record.video.isConnected ? record.video.getBoundingClientRect() : record.lastRect;
      if (record.video.isConnected) record.lastRect = rect;
      if (!rect) { record.host.style.display = 'none'; continue; }
      const visible = visibleFor(record);
      record.host.style.display = visible ? 'block' : 'none';
      if (!visible) continue;
      const label = record.shadow.querySelector('.label');
      if (label?.style) label.style.display = rect.width < 300 ? 'none' : '';
      const width = record.host.offsetWidth || 150, height = record.host.offsetHeight || 30;
      const above = rect.top >= height + 10;
      record.host.style.top = `${Math.max(6, Math.min(innerHeight - height - 6, above ? rect.top - height - 6 : rect.top + 6))}px`;
      record.host.style.left = `${Math.max(6, Math.min(innerWidth - width - 6, rect.right - width - 10))}px`;
      const chooser = record.shadow.querySelector('.chooser');
      if (chooser) {
        const chooserWidth = Math.min(340, innerWidth - 12), chooserHeight = Math.min(chooser.scrollHeight || 320, Math.min(320, innerHeight * 0.52));
        const hostRect = record.host.getBoundingClientRect?.() || { right: 0, bottom: 0, top: 0 };
        chooser.style.left = `${Math.max(6, Math.min(innerWidth - chooserWidth - 6, hostRect.right - chooserWidth))}px`;
        const below = hostRect.bottom + 6, aboveMenu = hostRect.top - chooserHeight - 6;
        chooser.style.top = `${below + chooserHeight <= innerHeight - 6 ? below : Math.max(6, aboveMenu)}px`;
      }
    }
  }

  /* --------------------------------------------------- early link interception */
  function wantsFile(anchor) {
    if (!anchor) return null;
    if (/^(blob:|data:)/i.test(anchor.href || '')) return null;
    const href = direct(anchor.href);
    if (!href) return null;
    const hasDownload = anchor.hasAttribute('download');
    if (!hasDownload && !FILE_LINK.test(href)) return null;
    return href;
  }
  function onLinkClick(event) {
    if (!interceptEnabled || stopped) return;
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const anchor = event.target?.closest?.('a[href]');
    const href = wantsFile(anchor);
    if (!href) return;
    if (anchor.target && !['', '_self'].includes(anchor.target)) return;
    // Take over before Chrome creates its own download item.
    event.preventDefault();
    event.stopImmediatePropagation();
    const requestId = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    send({ action: 'download', item: { url: href, referer: location.href, title: (anchor.textContent || '').trim().slice(0, 120), startNow: false, requestId } })
      .then(response => {
        if (response?.ok) return;
        // Never lose the user's download: continue with the browser instead.
        location.href = href;
      })
      .catch(() => { location.href = href; });
  }

  function onStorageChanged(changes, area) {
    if (area !== 'local') return;
    if (changes.overlayEnabled) { overlayEnabled = changes.overlayEnabled.newValue !== false; position(); }
    if (changes.interceptDownloads) interceptEnabled = changes.interceptDownloads.newValue === true;
  }

  mutationObserver = new MutationObserver(() => { if (!stopped && !pending) { pending = true; scanFrame = requestAnimationFrame(scan); } });
  mutationObserver.observe(document.documentElement, { subtree: true, childList: true });
  document.addEventListener('pointerdown', event => {
    const path = event.composedPath();
    if (![...records].some(record => path.includes(record.host))) closeChoosers();
  }, { capture: true, signal: listeners.signal });
  document.addEventListener('click', onLinkClick, { capture: true, signal: listeners.signal });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeChoosers(); }, { capture: true, signal: listeners.signal });
  function onScroll(event) {
    if (event?.composedPath?.().some(node => [...records].some(record => node === record.host))) return;
    scrolling = true; closeChoosers(); clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => { scrolling = false; position(); }, 140);
  }
  addEventListener('scroll', onScroll, { capture: true, signal: listeners.signal });
  addEventListener('resize', position, { signal: listeners.signal });
  document.addEventListener('fullscreenchange', position, { signal: listeners.signal });

  function onMessage(message, sender, respond) {
    if (!connected() || sender.id !== api.runtime.id || message.action !== 'collectLinks') return;
    const items = Array.from(document.querySelectorAll('a[href]')).slice(0, 1000).map(a => ({ url: direct(a.href), title: a.textContent.trim() })).filter(item => item.url);
    send({ action: 'remember', items: items.slice(0, 100) }).then(respond, error => { try { respond({ ok: false, error: error.message }); } catch { /* channel closed */ } }).catch(() => {});
    return true;
  }
  api.runtime.onMessage.addListener(onMessage);
  try { api.storage.onChanged.addListener(onStorageChanged); } catch { /* older engine */ }
  try {
    api.storage.local.get({ overlayEnabled: true, interceptDownloads: true }).then(value => {
      overlayEnabled = value.overlayEnabled !== false;
      interceptEnabled = value.interceptDownloads === true;
      position();
    }).catch(() => {});
  } catch { /* storage unavailable */ }
  scan();
})();
