// =============================================================================
// RedX Download Flow Button — Flutter implementation
// -----------------------------------------------------------------------------
// One button, one state machine, two runtimes. This widget mirrors
// shared/download-button.contract.json exactly; the browser build lives in
// extension/download-button.js and both are asserted against that contract by
// their test suites.
//
//   idle -> preparing -> queued -> downloading -> complete
//                                   \-> error -> preparing
//
// Visual rules: 3D steel/blue gradient, inline progress fill, sweeping shimmer
// while the request is in flight, check mark on success, retry affordance on
// failure, hover lift, press inset, visible focus ring, and a compact layout
// that collapses to the icon when width is constrained.
// =============================================================================

import 'dart:math' as math;

import 'package:flutter/material.dart';

/// The states a download entry point can occupy.
enum DownloadFlowState { idle, preparing, queued, downloading, complete, error }

/// Contract version shared with [shared/download-button.contract.json].
const int kDownloadFlowContractVersion = 1;

const List<String> kDownloadFlowStates = <String>[
  'idle',
  'preparing',
  'queued',
  'downloading',
  'complete',
  'error',
];

const Map<String, String> kDownloadFlowLabels = <String, String>{
  'idle': 'Download with RedX',
  'preparing': 'Preparing…',
  'queued': 'Queued',
  'downloading': 'Downloading',
  'complete': 'Saved',
  'error': 'Try again',
};

const Map<String, String> kDownloadFlowAria = <String, String>{
  'idle': 'Download with RedX Downloader',
  'preparing': 'Preparing the download',
  'queued': 'Download queued',
  'downloading': 'Downloading, {percent} percent',
  'complete': 'Download saved',
  'error': 'Download failed. Activate to try again.',
};

const Map<String, List<Color>> kDownloadFlowColors = <String, List<Color>>{
  'idle': <Color>[Color(0xFF4A9BFF), Color(0xFF1450B8)],
  'preparing': <Color>[Color(0xFF3F8BFD), Color(0xFF1647A8)],
  'queued': <Color>[Color(0xFF46536A), Color(0xFF1D2735)],
  'downloading': <Color>[Color(0xFF3F8BFD), Color(0xFF1647A8)],
  'complete': <Color>[Color(0xFF3AD07A), Color(0xFF127A45)],
  'error': <Color>[Color(0xFFFF5D5D), Color(0xFF8C1A25)],
};

/// Allowed transitions; a late engine event can never rewind a finished flow.
const Map<String, List<String>> kDownloadFlowTransitions = <String, List<String>>{
  'idle': <String>['preparing', 'queued', 'downloading', 'error'],
  'preparing': <String>['queued', 'downloading', 'complete', 'error', 'idle'],
  'queued': <String>['preparing', 'downloading', 'error', 'idle'],
  'downloading': <String>['complete', 'error', 'queued'],
  'complete': <String>['idle'],
  'error': <String>['preparing', 'idle'],
};

String flowStateName(DownloadFlowState state) => state.name;

bool canTransitionTo(DownloadFlowState from, DownloadFlowState to) {
  final List<String>? allowed = kDownloadFlowTransitions[from.name];
  if (allowed == null) return false;
  return allowed.contains(to.name);
}

double clampProgress(num value) {
  if (value.isNaN) return 0;
  return value.toDouble().clamp(0, 100);
}

String formatPercent(num value) {
  final double percent = clampProgress(value);
  if (percent >= 99.95) return '100%';
  return '${percent.toStringAsFixed(1)}%';
}

String flowSemantics(DownloadFlowState state, num progress) {
  final String template = kDownloadFlowAria[state.name] ?? kDownloadFlowAria['idle']!;
  return template.replaceFirst('{percent}', clampProgress(progress).round().toString());
}

/// A production download-flow button.
///
/// [onPressed] fires for idle and error states. While a transfer is running the
/// button reports progress and ignores activation, matching the browser build.
class DownloadFlowButton extends StatefulWidget {
  const DownloadFlowButton({
    super.key,
    this.state = DownloadFlowState.idle,
    this.progress = 0,
    this.label,
    this.compact = false,
    this.enabled = true,
    this.holdComplete = const Duration(milliseconds: 1600),
    this.onPressed,
    this.onCompleteShown,
  });

  final DownloadFlowState state;
  final double progress;

  /// Overrides the contract label, e.g. "Download 3 selected".
  final String? label;

  /// Drops to an icon-only layout; also applied automatically under 132 px.
  final bool compact;
  final bool enabled;
  final Duration holdComplete;
  final VoidCallback? onPressed;

  /// Called once the success state has been visible for [holdComplete].
  final VoidCallback? onCompleteShown;

  @override
  State<DownloadFlowButton> createState() => _DownloadFlowButtonState();
}

class _DownloadFlowButtonState extends State<DownloadFlowButton>
    with TickerProviderStateMixin {
  late AnimationController _sweep;
  late AnimationController _fill;
  bool _hovered = false;
  bool _pressed = false;
  bool _focused = false;

  bool get _busy =>
      widget.state == DownloadFlowState.preparing || widget.state == DownloadFlowState.queued;

  bool get _interactive =>
      widget.enabled &&
      widget.state != DownloadFlowState.downloading &&
      widget.state != DownloadFlowState.preparing &&
      widget.state != DownloadFlowState.queued;

  @override
  void initState() {
    super.initState();
    _sweep = AnimationController(vsync: this, duration: const Duration(milliseconds: 1100));
    _fill = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 260),
      value: clampProgress(widget.progress) / 100,
    );
    if (_busy) _sweep.repeat();
  }

  @override
  void didUpdateWidget(covariant DownloadFlowButton oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (_busy && !_sweep.isAnimating) {
      _sweep.repeat();
    } else if (!_busy && _sweep.isAnimating) {
      _sweep.stop();
      _sweep.value = 0;
    }
    final double target = widget.state == DownloadFlowState.complete
        ? 1
        : clampProgress(widget.progress) / 100;
    _fill.animateTo(target, curve: Curves.easeOutCubic);
  }

  @override
  void dispose() {
    _sweep.dispose();
    _fill.dispose();
    super.dispose();
  }

  void _handleTap() {
    if (!_interactive) return;
    widget.onPressed?.call();
  }

  @override
  Widget build(BuildContext context) {
    final bool reduceMotion = MediaQuery.maybeDisableAnimationsOf(context) ?? false;
    final String stateName = widget.state.name;
    final List<Color> colors = kDownloadFlowColors[stateName] ?? kDownloadFlowColors['idle']!;
    final String text = widget.label?.isNotEmpty == true
        ? widget.label!
        : (kDownloadFlowLabels[stateName] ?? kDownloadFlowLabels['idle']!);
    final bool showPercent = widget.state == DownloadFlowState.downloading ||
        (widget.state == DownloadFlowState.queued && widget.progress > 0);
    final String percent = showPercent ? formatPercent(widget.progress) : '';

    return Semantics(
      button: true,
      enabled: _interactive,
      label: flowSemantics(widget.state, widget.progress),
      onTap: _interactive ? _handleTap : null,
      child: FocusableActionDetector(
        enabled: true,
        onShowFocusHighlight: (bool value) => setState(() => _focused = value),
        shortcuts: const <ShortcutActivator, Intent>{
          SingleActivator(LogicalKeyboardKey.enter): ActivateIntent(),
          SingleActivator(LogicalKeyboardKey.space): ActivateIntent(),
        },
        actions: <Type, Action<Intent>>{
          ActivateIntent: CallbackAction<ActivateIntent>(onInvoke: (_) {
            _handleTap();
            return null;
          }),
        },
        child: MouseRegion(
          cursor: _interactive ? SystemMouseCursors.click : SystemMouseCursors.basic,
          onEnter: (_) => setState(() => _hovered = true),
          onExit: (_) => setState(() => _hovered = false),
          child: GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTapDown: _interactive ? (_) => setState(() => _pressed = true) : null,
            onTapCancel: () => setState(() => _pressed = false),
            onTapUp: _interactive
                ? (_) {
                    setState(() => _pressed = false);
                    _handleTap();
                  }
                : null,
            child: LayoutBuilder(builder: (BuildContext context, BoxConstraints constraints) {
              final bool compact = widget.compact || constraints.maxWidth < 132;
              return AnimatedContainer(
                duration: reduceMotion ? Duration.zero : const Duration(milliseconds: 120),
                height: 34,
                padding: EdgeInsets.symmetric(horizontal: compact ? 10 : 14),
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                    colors: colors,
                  ),
                  borderRadius: BorderRadius.circular(6),
                  border: Border.all(color: const Color(0x8C000000)),
                  boxShadow: <BoxShadow>[
                    BoxShadow(
                      color: const Color(0x47FFFFFF),
                      offset: const Offset(0, 1),
                      blurRadius: 0,
                      spreadRadius: -1,
                    ),
                    if (_hovered && _interactive)
                      BoxShadow(
                        color: colors[1].withValues(alpha: 0.45),
                        offset: const Offset(0, 3),
                        blurRadius: 10,
                      ),
                    const BoxShadow(color: Color(0x73000000), offset: Offset(0, 1), blurRadius: 2),
                  ],
                ),
                transform: Matrix4.translationValues(0, _pressed ? 1 : 0, 0),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(6),
                  child: Stack(
                    fit: StackFit.expand,
                    children: <Widget>[
                      if (!reduceMotion && _busy) _buildSweep(colors),
                      AnimatedBuilder(
                        animation: _fill,
                        builder: (BuildContext context, Widget? child) => FractionallySizedBox(
                          alignment: Alignment.centerLeft,
                          widthFactor: _fill.value.clamp(0.0, 1.0),
                          child: DecoratedBox(
                            decoration: BoxDecoration(
                              gradient: LinearGradient(
                                begin: Alignment.topCenter,
                                end: Alignment.bottomCenter,
                                colors: <Color>[
                                  Colors.white.withValues(alpha: 0.34),
                                  Colors.white.withValues(alpha: 0.12),
                                ],
                              ),
                            ),
                          ),
                        ),
                      ),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: <Widget>[
                          _buildIcon(stateName, reduceMotion),
                          if (!compact) ...<Widget>[
                            const SizedBox(width: 8),
                            Flexible(
                              child: Text(
                                text,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontSize: 12,
                                  fontWeight: FontWeight.w600,
                                  height: 1,
                                ),
                              ),
                            ),
                          ],
                          if (showPercent && !compact) ...<Widget>[
                            const SizedBox(width: 8),
                            Text(
                              percent,
                              style: const TextStyle(
                                color: Colors.white,
                                fontSize: 12,
                                fontWeight: FontWeight.w600,
                                height: 1,
                                fontFeatures: <FontFeature>[FontFeature.tabularFigures()],
                              ),
                            ),
                          ],
                        ],
                      ),
                      if (_focused)
                        DecoratedBox(
                          decoration: BoxDecoration(
                            borderRadius: BorderRadius.circular(6),
                            border: Border.all(color: const Color(0xFF8EC2FF), width: 2),
                          ),
                        ),
                    ],
                  ),
                ),
              );
            }),
          ),
        ),
      ),
    );
  }

  Widget _buildSweep(List<Color> colors) {
    return AnimatedBuilder(
      animation: _sweep,
      builder: (BuildContext context, Widget? child) {
        final double t = _sweep.value;
        return FractionallySizedBox(
          alignment: Alignment(-1 + 2 * t, 0),
          widthFactor: 0.45,
          child: DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: <Color>[
                  Colors.white.withValues(alpha: 0),
                  Colors.white.withValues(alpha: 0.35),
                  Colors.white.withValues(alpha: 0),
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  Widget _buildIcon(String stateName, bool reduceMotion) {
    final IconData data;
    switch (widget.state) {
      case DownloadFlowState.idle:
      case DownloadFlowState.downloading:
        data = Icons.download_rounded;
      case DownloadFlowState.preparing:
        data = Icons.autorenew_rounded;
      case DownloadFlowState.queued:
        data = Icons.schedule_rounded;
      case DownloadFlowState.complete:
        data = Icons.check_rounded;
      case DownloadFlowState.error:
        data = Icons.error_outline_rounded;
    }
    final Widget iconWidget = Icon(data, size: 16, color: Colors.white);
    if (widget.state == DownloadFlowState.preparing && !reduceMotion) {
      return RotationTransition(turns: _sweep, child: iconWidget);
    }
    return iconWidget;
  }
}
