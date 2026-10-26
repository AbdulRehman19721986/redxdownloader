// Verifies the Flutter download-flow button against the shared contract and
// exercises every visual state, including the interaction guards.
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:redx_downloader/widgets/download_flow_button.dart';

int _argb(String hex) => int.parse('FF${hex.replaceFirst('#', '')}', radix: 16);

Widget _host(Widget child) => MaterialApp(
      home: Scaffold(
        backgroundColor: const Color(0xFF05080D),
        body: Center(
          child: SizedBox(width: 240, child: child),
        ),
      ),
    );

void main() {
  final Map<String, dynamic> contract =
      jsonDecode(File('shared/download-button.contract.json').readAsStringSync())
          as Map<String, dynamic>;

  group('contract parity with the browser build', () {
    test('states match', () {
      expect(kDownloadFlowStates, List<String>.from(contract['states'] as List<dynamic>));
    });

    test('labels match', () {
      final Map<String, dynamic> labels = contract['labels'] as Map<String, dynamic>;
      expect(kDownloadFlowLabels.keys.toList(), labels.keys.toList());
      for (final String key in labels.keys) {
        expect(kDownloadFlowLabels[key], labels[key]);
      }
    });

    test('aria templates match', () {
      final Map<String, dynamic> aria = contract['aria'] as Map<String, dynamic>;
      for (final String key in aria.keys) {
        expect(kDownloadFlowAria[key], aria[key]);
      }
    });

    test('gradients match', () {
      final Map<String, dynamic> colors = contract['colors'] as Map<String, dynamic>;
      for (final String key in colors.keys) {
        final List<dynamic> pair = colors[key] as List<dynamic>;
        expect(kDownloadFlowColors[key]![0].toARGB32(), _argb(pair[0] as String), reason: '$key start');
        expect(kDownloadFlowColors[key]![1].toARGB32(), _argb(pair[1] as String), reason: '$key end');
      }
    });

    test('transition table matches', () {
      final Map<String, dynamic> transitions = contract['transitions'] as Map<String, dynamic>? ??
          <String, dynamic>{};
      if (transitions.isEmpty) return; // older contract revisions omit the table
      for (final String from in transitions.keys) {
        expect(kDownloadFlowTransitions[from], List<String>.from(transitions[from] as List<dynamic>));
      }
    });
  });

  group('helpers', () {
    test('percent formatting', () {
      expect(formatPercent(0), '0.0%');
      expect(formatPercent(7.84), '7.8%');
      expect(formatPercent(92.36), '92.4%');
      expect(formatPercent(99.95), '100%');
      expect(formatPercent(140), '100%');
      expect(formatPercent(-3), '0.0%');
    });

    test('invalid transitions are refused', () {
      expect(canTransitionTo(DownloadFlowState.idle, DownloadFlowState.preparing), isTrue);
      expect(canTransitionTo(DownloadFlowState.downloading, DownloadFlowState.complete), isTrue);
      expect(canTransitionTo(DownloadFlowState.complete, DownloadFlowState.downloading), isFalse);
      expect(canTransitionTo(DownloadFlowState.idle, DownloadFlowState.complete), isFalse);
    });

    test('semantics carries the rounded percentage', () {
      expect(flowSemantics(DownloadFlowState.downloading, 42.6), 'Downloading, 43 percent');
      expect(flowSemantics(DownloadFlowState.complete, 100), 'Download saved');
    });
  });

  group('widget', () {
    testWidgets('idle shows the contract label and fires onPressed', (WidgetTester tester) async {
      int taps = 0;
      await tester.pumpWidget(_host(DownloadFlowButton(onPressed: () => taps++)));
      expect(find.text('Download with RedX'), findsOneWidget);
      await tester.tap(find.byType(DownloadFlowButton));
      await tester.pump();
      expect(taps, 1);
    });

    testWidgets('downloading shows progress and ignores taps', (WidgetTester tester) async {
      int taps = 0;
      await tester.pumpWidget(_host(DownloadFlowButton(
        state: DownloadFlowState.downloading,
        progress: 61.4,
        onPressed: () => taps++,
      )));
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.text('Downloading'), findsOneWidget);
      expect(find.text('61.4%'), findsOneWidget);
      await tester.tap(find.byType(DownloadFlowButton));
      await tester.pump();
      expect(taps, 0, reason: 'a running transfer must not restart');
    });

    testWidgets('complete swaps to the saved state', (WidgetTester tester) async {
      await tester.pumpWidget(_host(const DownloadFlowButton(state: DownloadFlowState.complete)));
      await tester.pump();
      expect(find.text('Saved'), findsOneWidget);
      expect(find.byIcon(Icons.check_rounded), findsOneWidget);
    });

    testWidgets('error offers retry', (WidgetTester tester) async {
      int taps = 0;
      await tester.pumpWidget(_host(DownloadFlowButton(
        state: DownloadFlowState.error,
        onPressed: () => taps++,
      )));
      expect(find.text('Try again'), findsOneWidget);
      await tester.tap(find.byType(DownloadFlowButton));
      await tester.pump();
      expect(taps, 1);
    });

    testWidgets('compact hides the textual label', (WidgetTester tester) async {
      await tester.pumpWidget(_host(const DownloadFlowButton(compact: true)));
      expect(find.text('Download with RedX'), findsNothing);
      expect(find.byIcon(Icons.download_rounded), findsOneWidget);
    });

    testWidgets('label override wins over the contract text', (WidgetTester tester) async {
      await tester.pumpWidget(_host(const DownloadFlowButton(label: 'Download 3 selected')));
      expect(find.text('Download 3 selected'), findsOneWidget);
    });

    testWidgets('progress fill tracks the value', (WidgetTester tester) async {
      await tester.pumpWidget(_host(const DownloadFlowButton(
        state: DownloadFlowState.downloading,
        progress: 50,
      )));
      await tester.pump(const Duration(milliseconds: 400));
      final FractionallySizedBox fill = tester
          .widgetList<FractionallySizedBox>(find.byType(FractionallySizedBox))
          .first;
      expect(fill.widthFactor, closeTo(0.5, 0.02));
    });
  });
}
