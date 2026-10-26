/* =============================================================================
   RedX Download Flow Button — browser implementation
   -----------------------------------------------------------------------------
   Enhances an existing <button> so every download entry point shares one visual
   language and one state machine:

       idle -> preparing -> queued -> downloading -> complete
                                     \-> error -> preparing

   Mirrors shared/download-button.contract.json; the Dart widget in
   lib/widgets/download_flow_button.dart mirrors the same file. No framework and
   no build step: registers window.RedXFlow and exports for Node tests.
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RedXFlow = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CONTRACT = {
    states: ['idle', 'preparing', 'queued', 'downloading', 'complete', 'error'],
    labels: {
      idle: 'Download with RedX',
      preparing: 'Preparing…',
      queued: 'Queued',
      downloading: 'Downloading',
      complete: 'Saved',
      error: 'Try again'
    },
    aria: {
      idle: 'Download with RedX Downloader',
      preparing: 'Preparing the download',
      queued: 'Download queued',
      downloading: 'Downloading, {percent} percent',
      complete: 'Download saved',
      error: 'Download failed. Activate to try again.'
    },
    timing: { sweepMs: 1100, transitionMs: 180, completeHoldMs: 1600 },
    colors: {
      idle: ['#4a9bff', '#1450b8'],
      preparing: ['#3f8bfd', '#1647a8'],
      queued: ['#46536a', '#1d2735'],
      downloading: ['#3f8bfd', '#1647a8'],
      complete: ['#3ad07a', '#127a45'],
      error: ['#ff5d5d', '#8c1a25']
    }
  };

  // Transitions the component will accept. Anything else is ignored so a late
  // or duplicated engine event can never rewind a finished download.
  const TRANSITIONS = {
    idle: ['preparing', 'queued', 'downloading', 'error'],
    preparing: ['queued', 'downloading', 'complete', 'error', 'idle'],
    queued: ['preparing', 'downloading', 'error', 'idle'],
    downloading: ['complete', 'error', 'queued'],
    complete: ['idle'],
    error: ['preparing', 'idle']
  };

  const ICONS = {
    idle: '<path d="M12 3v11m0 0 4-4m-4 4-4-4" /><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />',
    preparing: '<path d="M12 3a9 9 0 1 0 9 9" />',
    queued: '<path d="M12 7v5l3 2" /><circle cx="12" cy="12" r="9" />',
    downloading: '<path d="M12 3v11m0 0 4-4m-4 4-4-4" /><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />',
    complete: '<path d="m5 13 4 4L19 7" />',
    error: '<path d="M12 8v5" /><path d="M12 17h.01" /><path d="M10.3 3.9 2.5 17a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />'
  };

  const isState = value => CONTRACT.states.indexOf(value) > -1;

  function canTransition(from, to) {
    if (!isState(from) || !isState(to)) return false;
    return TRANSITIONS[from].indexOf(to) > -1;
  }

  function clampProgress(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.min(100, Math.max(0, number));
  }

  function formatPercent(value) {
    const percent = clampProgress(value);
    if (percent >= 99.95) return '100%';
    return `${percent.toFixed(1)}%`;
  }

  function ariaFor(state, percent) {
    const template = CONTRACT.aria[state] || CONTRACT.aria.idle;
    return template.replace('{percent}', String(Math.round(clampProgress(percent))));
  }

  const STYLE_ID = 'redx-flow-button-styles';

  const CSS = `
.rx-flow {
  --rx-from: #4a9bff;
  --rx-to: #1450b8;
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-width: 0;
  max-width: 100%;
  height: 34px;
  padding: 0 14px;
  border: 1px solid rgba(0, 0, 0, .55);
  border-radius: 6px;
  overflow: hidden;
  isolation: isolate;
  font: 600 12px/1 "Segoe UI", system-ui, sans-serif;
  color: #fff;
  cursor: pointer;
  background-image: linear-gradient(180deg, var(--rx-from), var(--rx-to));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .28), inset 0 -1px 0 rgba(0, 0, 0, .35), 0 1px 2px rgba(0, 0, 0, .45);
  transition: transform 120ms ease, box-shadow 120ms ease, filter 120ms ease, width 180ms ease;
}
.rx-flow:hover:not([aria-disabled="true"]) { filter: brightness(1.08); box-shadow: inset 0 1px 0 rgba(255, 255, 255, .34), 0 3px 10px rgba(20, 80, 184, .45); }
.rx-flow:active:not([aria-disabled="true"]) { transform: translateY(1px); filter: brightness(.96); box-shadow: inset 0 2px 6px rgba(0, 0, 0, .45); }
.rx-flow:focus-visible { outline: 2px solid #8ec2ff; outline-offset: 2px; }
.rx-flow[aria-disabled="true"] { cursor: not-allowed; filter: grayscale(.35) brightness(.8); }
.rx-flow[data-state="queued"] { color: #d8e2ef; }
.rx-flow[data-state="queued"] .rx-flow-icon { opacity: .8; }
.rx-flow-icon { display: inline-flex; width: 16px; height: 16px; flex: none; }
.rx-flow-icon svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.rx-flow[data-state="preparing"] .rx-flow-icon svg { animation: rx-spin .9s linear infinite; }
/* Explicit child selectors so a host page cannot recolour the label through a
   broader descendant rule. */
.rx-flow .rx-flow-label { color: inherit; text-transform: none; letter-spacing: normal; position: relative; z-index: 2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rx-flow-pct { position: relative; z-index: 2; font-variant-numeric: tabular-nums; opacity: .95; }
.rx-flow-pct:empty { display: none; }
.rx-flow-fill {
  position: absolute;
  inset: 0 auto 0 0;
  width: 0;
  z-index: 1;
  background: linear-gradient(180deg, rgba(255, 255, 255, .34), rgba(255, 255, 255, .12));
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .18);
  transition: width 260ms cubic-bezier(.22, .61, .36, 1);
}
.rx-flow[data-state="complete"] .rx-flow-fill,
.rx-flow[data-state="error"] .rx-flow-fill { display: none; }
.rx-flow-sweep {
  position: absolute;
  inset: 0;
  z-index: 1;
  opacity: 0;
  background: linear-gradient(100deg, transparent 20%, rgba(255, 255, 255, .35) 50%, transparent 80%);
  pointer-events: none;
}
.rx-flow[data-state="preparing"] .rx-flow-sweep,
.rx-flow[data-state="queued"] .rx-flow-sweep { opacity: 1; animation: rx-sweep 1100ms ease-in-out infinite; }
.rx-flow[data-compact="true"] { padding: 0 10px; gap: 6px; }
.rx-flow[data-compact="true"] .rx-flow-label { display: none; }
.rx-flow[data-compact="true"] .rx-flow-pct { display: none; }
.rx-flow[data-compact="true"]:not([data-state="downloading"]) .rx-flow-icon { margin: 0; }
@keyframes rx-sweep { from { transform: translateX(-100%); } to { transform: translateX(100%); } }
@keyframes rx-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .rx-flow, .rx-flow-fill { transition: none; }
  .rx-flow[data-state="preparing"] .rx-flow-sweep,
  .rx-flow[data-state="queued"] .rx-flow-sweep,
  .rx-flow[data-state="preparing"] .rx-flow-icon svg { animation: none; }
}
`;

  function ensureStyles(doc) {
    if (!doc || !doc.head) return;
    if (doc.getElementById(STYLE_ID)) return;
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    doc.head.appendChild(style);
  }

  function iconMarkup(state) {
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[state] || ICONS.idle}</svg>`;
  }

  /**
   * Turns an existing button into a download-flow button.
   * Existing click handlers keep working: the element itself is not replaced.
   */
  function attach(button, options) {
    if (!button || button.nodeType !== 1) throw new Error('attach() needs a <button> element');
    const settings = Object.assign({ state: 'idle', progress: 0, label: '', holdCompleteMs: CONTRACT.timing.completeHoldMs }, options || {});
    const doc = button.ownerDocument;
    ensureStyles(doc);

    button.classList.add('rx-flow');
    button.setAttribute('type', button.getAttribute('type') || 'button');
    button.innerHTML = `<span class="rx-flow-fill"></span><span class="rx-flow-sweep"></span>`
      + `<span class="rx-flow-icon">${iconMarkup(settings.state)}</span>`
      + `<span class="rx-flow-label"></span><span class="rx-flow-pct"></span>`;

    const labelNode = button.querySelector('.rx-flow-label');
    const pctNode = button.querySelector('.rx-flow-pct');
    const iconNode = button.querySelector('.rx-flow-icon');
    const fillNode = button.querySelector('.rx-flow-fill');

    let state = isState(settings.state) ? settings.state : 'idle';
    let progress = clampProgress(settings.progress);
    let labelOverride = settings.label || '';
    let holdTimer = null;

    // Collapse on the space *offered* to the button, never on its own width:
    // measuring the button would shrink it, which re-triggers compact forever.
    const slot = button.parentElement || button;
    if (settings.compact === true) button.dataset.compact = 'true';
    else if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(entries => {
        for (const entry of entries) {
          button.dataset.compact = String(entry.contentRect.width < 132);
        }
      });
      observer.observe(slot);
    }

    function paint() {
      const colors = CONTRACT.colors[state];
      button.dataset.state = state;
      button.style.setProperty('--rx-from', colors[0]);
      button.style.setProperty('--rx-to', colors[1]);
      iconNode.innerHTML = iconMarkup(state);
      // A custom label only replaces the call-to-action; state feedback such as
      // "Saved" or "Try again" must always reach the user.
      labelNode.textContent = (state === 'idle' && labelOverride) ? labelOverride : CONTRACT.labels[state];
      pctNode.textContent = state === 'downloading' ? formatPercent(progress) : (state === 'queued' && progress > 0 ? formatPercent(progress) : '');
      if (state === 'downloading') fillNode.style.width = `${clampProgress(progress)}%`;
      else if (state === 'queued') fillNode.style.width = `${clampProgress(progress) * 0.4}%`;
      else fillNode.style.width = '0%';
      button.setAttribute('aria-label', ariaFor(state, progress));
      button.setAttribute('aria-live', 'polite');
      button.setAttribute('aria-busy', String(state === 'preparing' || state === 'queued'));
    }

    const controller = {
      element: button,
      get state() { return state; },
      get progress() { return progress; },
      canTransition(to) { return canTransition(state, to); },
      setState(next, detail) {
        if (!isState(next)) return controller;
        if (next !== state && !canTransition(state, next)) return controller;
        if (holdTimer && next !== 'complete') { clearTimeout(holdTimer); holdTimer = null; }
        if (detail && Number.isFinite(Number(detail.progress))) progress = clampProgress(detail.progress);
        if (next === 'complete') progress = 100;
        state = next;
        paint();
        if (next === 'complete' && settings.holdCompleteMs > 0) {
          holdTimer = setTimeout(() => { holdTimer = null; controller.setState('idle'); }, settings.holdCompleteMs);
        }
        return controller;
      },
      setProgress(value) {
        progress = clampProgress(value);
        // Progress is proof the transfer started, so promote the flow instead of
        // waiting for a separate "downloading" event from the engine.
        if (progress > 0 && (state === 'idle' || state === 'preparing' || state === 'queued')) {
          state = 'downloading';
        }
        paint();
        return controller;
      },
      setLabel(text) {
        labelOverride = String(text || '');
        paint();
        return controller;
      },
      begin() { return controller.setState('preparing', { progress: 0 }); },
      succeed() { return controller.setState('complete'); },
      fail() { return controller.setState('error'); },
      destroy() {
        if (holdTimer) clearTimeout(holdTimer);
        button.classList.remove('rx-flow');
        button.removeAttribute('data-state');
        button.removeAttribute('data-compact');
        button.innerHTML = '';
      }
    };

    paint();
    return controller;
  }

  return { CONTRACT, TRANSITIONS, attach, canTransition, formatPercent, clampProgress, ariaFor, CSS };
});
