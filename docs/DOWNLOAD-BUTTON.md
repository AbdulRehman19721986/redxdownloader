# Download flow button

One button, one state machine, two runtimes.

| File | Runtime | Role |
| --- | --- | --- |
| `shared/download-button.contract.json` | — | Single source of truth: states, labels, aria text, gradients, timing |
| `extension/download-button.js` | Browser (extends any `<button>`) | Production implementation used by the popup |
| `lib/widgets/download_flow_button.dart` | Flutter | Same component for the Dart interface |
| `extension/download-button.test.cjs` | Node | Contract parity, transitions, formatting, CSS contract |
| `test/download_flow_button_test.dart` | Flutter | Contract parity + widget behaviour |
| `build/ui/flow-visual.cjs` | Chromium | Visual states, hover, press, focus, compact, screenshots |
| `build/ui/popup-flow.cjs` | Chromium + extension | Proves the popup mounts and drives the real component |

## States

```
idle ──▶ preparing ──▶ queued ──▶ downloading ──▶ complete ──▶ idle
                       └──────────────┴──▶ error ──▶ preparing
```

| State | Label | Look |
| --- | --- | --- |
| `idle` | Download with RedX | Blue 3D gradient, download glyph |
| `preparing` | Preparing… | Spinning glyph, sweeping shimmer |
| `queued` | Queued | Muted steel, clock glyph |
| `downloading` | Downloading + `68.4%` | Progress fill in the button body |
| `complete` | Saved | Green gradient, check glyph |
| `error` | Try again | Red gradient, warning glyph, click retries |

`complete` cannot be rewound to `downloading`, so a late engine event cannot make a
finished download look active again. `complete` returns to `idle` after
`timing.completeHoldMs`.

## Browser usage

```html
<script src="download-button.js"></script>
<button id="download">Download selected</button>
```

```js
const flow = RedXFlow.attach(document.getElementById('download'));
flow.begin();              // preparing
flow.setProgress(38.4);    // promotes to downloading, renders 38.4%
flow.succeed();            // complete, then idle after the hold
flow.fail();               // error, activation retries
flow.setLabel('Download 3 selected');   // customises the idle call-to-action only
```

`attach()` never replaces the element, so existing `addEventListener('click', …)`
handlers keep working — that is how the popup wires it with a one-line change.
The button also collapses to an icon-only layout when its *container* is under
132 px (`data-compact`), never by measuring itself.

The popup mounts it in `popup.js`:

```js
window.redxFlowButton = RedXFlow.attach(document.getElementById('selected'), { state: 'idle' });
```

and `sendDownload()` drives `begin()` / `succeed()` / `fail()` around the native
messaging call.

## Flutter usage

```dart
DownloadFlowButton(
  state: DownloadFlowState.downloading,
  progress: 38.4,
  onPressed: startDownload,
)
```

The widget reports `Semantics(button: true, label: 'Downloading, 38 percent')`,
honours `MediaQuery.disableAnimations`, supports Enter/Space activation, and
draws a visible focus ring for keyboard users.

## Tests

```powershell
node --test extension/download-button.test.cjs   # logic + contract parity
node build/ui/flow-visual.cjs                    # Chromium: states, hover, press, focus
node build/ui/popup-flow.cjs                     # extension popup mount + state driving
flutter test test/download_flow_button_test.dart # Dart parity + widget behaviour
```
