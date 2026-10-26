// ==============================================================================
// REDX DOWNLOADER — CORE SEGMENTED DOWNLOAD ENGINE IN PURE DART
// ==============================================================================

import 'dart:async';
import 'dart:io';

class DartDownloadEngine {
  final Map<String, StreamSubscription> _activeTasks = {};

  Future<void> startSegmentedDownload({
    required String url,
    required String savePath,
    required int connections,
    required Function(int downloaded, int total, double speed) onProgress,
    required Function(String error) onError,
    required Function() onComplete,
  }) async {
    try {
      final client = HttpClient();
      final req = await client.headUrl(Uri.parse(url));
      final res = await req.close();
      
      final acceptRanges = res.headers.value('accept-ranges') == 'bytes';
      final contentLength = res.contentLength;

      if (!acceptRanges || contentLength <= 0) {
        // Fallback to sequential stream
        _startSingleStream(url, savePath, onProgress, onError, onComplete);
        return;
      }

      // Segmented Multi-Connection Execution (IDM Parallel TCP Streams)
      final segmentSize = (contentLength / connections).ceil();
      final file = File(savePath);
      final raf = await file.open(mode: FileMode.write);
      await raf.truncate(contentLength);
      await raf.close();

      int totalDownloaded = 0;
      final stopwatch = Stopwatch()..start();

      final futures = <Future>[];
      for (int i = 0; i < connections; i++) {
        final start = i * segmentSize;
        final end = (i == connections - 1) ? contentLength - 1 : (start + segmentSize - 1);

        futures.add(_downloadChunk(url, savePath, start, end, (chunkBytes) {
          totalDownloaded += chunkBytes;
          final elapsed = stopwatch.elapsedMilliseconds / 1000.0;
          final speed = elapsed > 0 ? (totalDownloaded / elapsed) : 0.0;
          onProgress(totalDownloaded, contentLength, speed);
        }));
      }

      await Future.wait(futures);
      stopwatch.stop();
      onComplete();
    } catch (e) {
      onError(e.toString());
    }
  }

  Future<void> _downloadChunk(String url, String path, int start, int end, Function(int bytes) onChunk) async {
    final client = HttpClient();
    final req = await client.getUrl(Uri.parse(url));
    req.headers.add('Range', 'bytes=$start-$end');
    final res = await req.close();

    final file = File(path);
    final raf = await file.open(mode: FileMode.append);
    await raf.setPosition(start);

    await for (var data in res) {
      await raf.writeFrom(data);
      onChunk(data.length);
    }
    await raf.close();
  }

  Future<void> _startSingleStream(String url, String path, Function(int, int, double) onProgress, Function(String) onError, Function() onComplete) async {
    final client = HttpClient();
    final req = await client.getUrl(Uri.parse(url));
    final res = await req.close();
    final file = File(path);
    final sink = file.openWrite();
    int downloaded = 0;
    final total = res.contentLength;
    final sw = Stopwatch()..start();

    res.listen(
      (data) {
        sink.add(data);
        downloaded += data.length;
        final speed = sw.elapsedMilliseconds > 0 ? (downloaded / (sw.elapsedMilliseconds / 1000.0)) : 0.0;
        onProgress(downloaded, total, speed);
      },
      onError: (e) => onError(e.toString()),
      onDone: () async {
        await sink.flush();
        await sink.close();
        sw.stop();
        onComplete();
      },
      cancelOnError: true,
    );
  }
}
