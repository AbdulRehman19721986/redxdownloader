// ==============================================================================
// REDX DOWNLOADER — IDM-CLASS DESKTOP ARCHITECTURE IN DART & FLUTTER
// Product: RedX Downloader
// Owner & Developer: Abdur Rehman Rajput
// Organization: A Project of Team RedX
// Windows AppUserModelID: com.teamredx.downloader
//
// STATUS: interface reference, not compiled into the Windows build.
// This file specifies the widget tree, palette, ribbon geometry and the
// eight-stream transfer layout. The shipped Windows interface — packaging,
// assets, controls and download functionality — is implemented in
// renderer/index.html, renderer/app.js and renderer/styles.css and is verified
// by scripts/verify-ui.cjs on every release. See docs/UI-PIPELINE.md for why
// the Flutter target is not built here and what moving to it would require.
// ==============================================================================

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const RedXApp());
}

class RedXApp extends StatelessWidget {
  const RedXApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'RedX Downloader',
      debugShowCheckedModeBanner: false,
      themeMode: ThemeMode.dark,
      theme: ThemeData(
        brightness: Brightness.dark,
        scaffoldBackgroundColor: const Color(0xFF090D14),
        colorScheme: const ColorScheme.dark(
          primary: Color(0xFF2563EB),
          secondary: Color(0xFF3B82F6),
          surface: Color(0xFF0F172A),
          error: Color(0xFFEF4444),
        ),
        fontFamily: 'Segoe UI',
      ),
      home: const RedXMainScreen(),
    );
  }
}

// -----------------------------------------------------------------------------
// MODELS & STATE
// -----------------------------------------------------------------------------

enum DownloadStatus {
  queued,
  connecting,
  downloading,
  paused,
  completed,
  error,
  cancelled
}

enum MediaCategory {
  all,
  unfinished,
  finished,
  compressed,
  documents,
  music,
  programs,
  video,
  other
}

class SegmentChunk {
  final int id;
  final int startByte;
  final int endByte;
  double progress; // 0.0 to 1.0
  int downloadedBytes;
  String status;

  SegmentChunk({
    required this.id,
    required this.startByte,
    required this.endByte,
    this.progress = 0.0,
    this.downloadedBytes = 0,
    this.status = 'Receiving data...',
  });
}

class DownloadItem {
  final String id;
  final String filename;
  final String url;
  final String destinationPath;
  final int totalBytes;
  int downloadedBytes;
  double speedBytesPerSec;
  DownloadStatus status;
  final MediaCategory category;
  final DateTime createdAt;
  final bool resumable;
  final List<SegmentChunk> segments;
  String? error;

  DownloadItem({
    required this.id,
    required this.filename,
    required this.url,
    required this.destinationPath,
    required this.totalBytes,
    this.downloadedBytes = 0,
    this.speedBytesPerSec = 0,
    this.status = DownloadStatus.downloading,
    required this.category,
    required this.createdAt,
    this.resumable = true,
    required this.segments,
    this.error,
  });

  double get progress => totalBytes > 0 ? (downloadedBytes / totalBytes).clamp(0.0, 1.0) : 0.0;
  int get percentage => (progress * 100).toInt();

  String get etaString {
    if (status == DownloadStatus.completed) return '—';
    if (speedBytesPerSec <= 0 || totalBytes <= 0) return 'Estimating...';
    final remainingBytes = totalBytes - downloadedBytes;
    final seconds = (remainingBytes / speedBytesPerSec).ceil();
    if (seconds < 60) return '${seconds}s';
    if (seconds < 3600) return '${seconds ~/ 60}m ${seconds % 60}s';
    return '${seconds ~/ 3600}h ${(seconds % 3600) ~/ 60}m';
  }

  String get speedString {
    if (status != DownloadStatus.downloading) return '—';
    return '${formatBytes(speedBytesPerSec.toInt())}/s';
  }

  static String formatBytes(int bytes) {
    if (bytes <= 0) return '0 B';
    const suffixes = ['B', 'KB', 'MB', 'GB', 'TB'];
    var i = (log(bytes) / log(1024)).floor();
    if (i >= suffixes.length) i = suffixes.length - 1;
    return '${(bytes / pow(1024, i)).toStringAsFixed(1)} ${suffixes[i]}';
  }
}

// -----------------------------------------------------------------------------
// MAIN WORKSPACE SCREEN (IDM-GRADE COMMAND RIBBON & CATEGORY TREE)
// -----------------------------------------------------------------------------

class RedXMainScreen extends StatefulWidget {
  const RedXMainScreen({super.key});

  @override
  State<RedXMainScreen> createState() => _RedXMainScreenState();
}

class _RedXMainScreenState extends State<RedXMainScreen> with TickerProviderStateMixin {
  MediaCategory _selectedCategory = MediaCategory.all;
  String _searchQuery = '';
  final Set<String> _selectedIds = {};
  DownloadItem? _activeDialogItem;
  Timer? _simulationTimer;

  final List<DownloadItem> _downloads = [];

  @override
  void initState() {
    super.initState();
    _seedInitialDownloads();
    _startThroughputSimulation();
  }

  @override
  void dispose() {
    _simulationTimer?.cancel();
    super.dispose();
  }

  void _seedInitialDownloads() {
    _downloads.addAll([
      DownloadItem(
        id: '1',
        filename: 'VSCode-win32-x64-1.92.2.exe',
        url: 'https://update.code.visualstudio.com/commit/release/win32-x64',
        destinationPath: r'C:\Users\User\Downloads\Programs\VSCode-win32-x64-1.92.2.exe',
        totalBytes: 119327129, // ~113.8 MB
        downloadedBytes: 93075160, // 78%
        speedBytesPerSec: 25800000, // 24.6 MB/s
        status: DownloadStatus.downloading,
        category: MediaCategory.programs,
        createdAt: DateTime.now().subtract(const Duration(seconds: 4)),
        segments: List.generate(8, (i) => SegmentChunk(
          id: i + 1,
          startByte: i * 14915891,
          endByte: (i + 1) * 14915891,
          progress: i < 5 ? 1.0 : (i == 5 ? 0.85 : (i == 6 ? 0.70 : 0.52)),
          downloadedBytes: (14915891 * (i < 5 ? 1.0 : 0.7)).toInt(),
        )),
      ),
      DownloadItem(
        id: '2',
        filename: 'Ubuntu-24.04-desktop-amd64.iso',
        url: 'https://releases.ubuntu.com/24.04/ubuntu-24.04-desktop-amd64.iso',
        destinationPath: r'C:\Users\User\Downloads\Compressed\Ubuntu-24.04-desktop-amd64.iso',
        totalBytes: 5153960755, // ~4.8 GB
        downloadedBytes: 1649267441, // 32%
        speedBytesPerSec: 19100000, // 18.2 MB/s
        status: DownloadStatus.downloading,
        category: MediaCategory.compressed,
        createdAt: DateTime.now().subtract(const Duration(minutes: 2)),
        segments: List.generate(8, (i) => SegmentChunk(
          id: i + 1,
          startByte: i * 644245094,
          endByte: (i + 1) * 644245094,
          progress: 0.32,
        )),
      ),
      DownloadItem(
        id: '3',
        filename: 'Blender_Studio_AssetPack_4K.zip',
        url: 'https://download.blender.org/demo/assets/Blender_Studio_4K.zip',
        destinationPath: r'C:\Users\User\Downloads\Compressed\Blender_Studio_AssetPack_4K.zip',
        totalBytes: 1488977920, // 1.42 GB
        downloadedBytes: 1488977920,
        speedBytesPerSec: 0,
        status: DownloadStatus.completed,
        category: MediaCategory.compressed,
        createdAt: DateTime.now().subtract(const Duration(hours: 1)),
        segments: [],
      ),
    ]);
  }

  void _startThroughputSimulation() {
    _simulationTimer = Timer.periodic(const Duration(milliseconds: 400), (timer) {
      if (!mounted) return;
      setState(() {
        for (var item in _downloads) {
          if (item.status == DownloadStatus.downloading) {
            final increment = (item.speedBytesPerSec * 0.4).toInt();
            item.downloadedBytes = (item.downloadedBytes + increment).clamp(0, item.totalBytes);
            if (item.downloadedBytes >= item.totalBytes) {
              item.status = DownloadStatus.completed;
              item.speedBytesPerSec = 0;
            }
          }
        }
      });
    });
  }

  List<DownloadItem> get _filteredDownloads {
    return _downloads.where((item) {
      final matchesSearch = item.filename.toLowerCase().contains(_searchQuery.toLowerCase()) ||
          item.url.toLowerCase().contains(_searchQuery.toLowerCase());
      if (!matchesSearch) return false;

      switch (_selectedCategory) {
        case MediaCategory.all:
          return true;
        case MediaCategory.unfinished:
          return item.status != DownloadStatus.completed;
        case MediaCategory.finished:
          return item.status == DownloadStatus.completed;
        case MediaCategory.compressed:
          return item.category == MediaCategory.compressed;
        case MediaCategory.documents:
          return item.category == MediaCategory.documents;
        case MediaCategory.music:
          return item.category == MediaCategory.music;
        case MediaCategory.programs:
          return item.category == MediaCategory.programs;
        case MediaCategory.video:
          return item.category == MediaCategory.video;
        case MediaCategory.other:
          return item.category == MediaCategory.other;
      }
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF080C14),
      body: Column(
        children: [
          _buildWindowChrome(),
          _buildMenuBar(),
          _buildTactileCommandRibbon(),
          Expanded(
            child: Row(
              children: [
                _buildLeftCategorySidebar(),
                Expanded(child: _buildMainDownloadGrid()),
              ],
            ),
          ),
          _buildFooterStatusBar(),
        ],
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // WINDOW CHROME & MENU BAR
  // ---------------------------------------------------------------------------

  Widget _buildWindowChrome() {
    return Container(
      height: 32,
      padding: const EdgeInsets.symmetric(horizontal: 10),
      decoration: const BoxDecoration(
        color: Color(0xFF111A2E),
        border: Border(bottom: BorderSide(color: Color(0xFF1E2A42))),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Row(
            children: [
              Container(
                width: 14,
                height: 14,
                decoration: BoxDecoration(
                  color: const Color(0xFF2563EB),
                  borderRadius: BorderRadius.circular(3),
                  boxShadow: const [BoxShadow(color: Color(0xFF3B82F6), blurRadius: 4)],
                ),
                child: const Center(
                  child: Text('R', style: TextStyle(color: Colors.white, fontSize: 9, fontWeight: FontWeight.bold)),
                ),
              ),
              const SizedBox(width: 8),
              const Text('RedX Downloader 2.0', style: TextStyle(color: Color(0xFFCBD5E1), fontSize: 11, fontWeight: FontWeight.w600)),
              const SizedBox(width: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                decoration: BoxDecoration(
                  color: const Color(0xFF1E293B),
                  borderRadius: BorderRadius.circular(4),
                ),
                child: const Text('IDM Pro Architecture', style: TextStyle(color: Color(0xFF94A3B8), fontSize: 9, fontWeight: FontWeight.bold)),
              ),
            ],
          ),
          Row(
            children: [
              _buildWinControlButton(Icons.remove, () {}),
              _buildWinControlButton(Icons.crop_square, () {}),
              _buildWinControlButton(Icons.close, () {}, isClose: true),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildWinControlButton(IconData icon, VoidCallback onTap, {bool isClose = false}) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(4),
      child: Container(
        width: 26,
        height: 22,
        alignment: Alignment.center,
        child: Icon(icon, size: 13, color: isClose ? const Color(0xFFEF4444) : const Color(0xFF94A3B8)),
      ),
    );
  }

  Widget _buildMenuBar() {
    final menus = ['Tasks', 'File', 'Downloads', 'View', 'Help'];
    return Container(
      height: 24,
      padding: const EdgeInsets.symmetric(horizontal: 10),
      decoration: const BoxDecoration(
        color: Color(0xFF0F1728),
        border: Border(bottom: BorderSide(color: Color(0xFF1A263C))),
      ),
      child: Row(
        children: menus.map((m) => Padding(
          padding: const EdgeInsets.only(right: 14),
          child: Text(m, style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 11, fontWeight: FontWeight.w500)),
        )).toList(),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // TACTILE 3D COMMAND RIBBON (EXACT IDM STRUCTURE)
  // ---------------------------------------------------------------------------

  Widget _buildTactileCommandRibbon() {
    return Container(
      height: 58,
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [Color(0xFF18243A), Color(0xFF0F1728)],
        ),
        border: Border(bottom: BorderSide(color: Color(0xFF1F2E47))),
      ),
      child: Row(
        children: [
          _buildTactileRibbonButton('Add URL', Icons.add_circle, isPrimary: true, onTap: _showAddUrlDialog),
          _buildTactileRibbonButton('Resume', Icons.play_arrow, onTap: _resumeSelected),
          _buildTactileRibbonButton('Stop', Icons.pause, onTap: _pauseSelected),
          _buildTactileRibbonButton('Stop All', Icons.stop, onTap: _stopAll),
          _buildTactileRibbonButton('Delete', Icons.delete, onTap: _deleteSelected),
          _buildTactileRibbonButton('Delete Comp.', Icons.cleaning_services, onTap: _deleteCompleted),
          _buildTactileRibbonButton('Options', Icons.settings, onTap: () {}),
          _buildTactileRibbonButton('Scheduler', Icons.schedule, onTap: () {}),
          _buildTactileRibbonButton('Start Queue', Icons.rocket_launch, onTap: _resumeSelected),
          _buildTactileRibbonButton('Stop Queue', Icons.pause_circle_outline, onTap: _pauseSelected),
          const Spacer(),
          // Speedometer Metric
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
            decoration: BoxDecoration(
              color: const Color(0xFF090D18),
              border: Border.all(color: const Color(0xFF1E2D47)),
              borderRadius: BorderRadius.circular(6),
            ),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                const Text('TOTAL SPEED', style: TextStyle(color: Color(0xFF64748B), fontSize: 8, fontWeight: FontWeight.w700)),
                Text(
                  DownloadItem.formatBytes(_downloads.fold(0, (sum, i) => sum + i.speedBytesPerSec.toInt())) + '/s',
                  style: const TextStyle(color: Color(0xFF34D399), fontSize: 13, fontWeight: FontWeight.w800, fontFamily: 'monospace'),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTactileRibbonButton(String label, IconData icon, {bool isPrimary = false, required VoidCallback onTap}) {
    return Container(
      margin: const EdgeInsets.only(right: 6),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(6),
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 120),
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            constraints: const BoxConstraints(minWidth: 58),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: isPrimary
                    ? [const Color(0xFF3B82F6), const Color(0xFF1D4ED8)]
                    : [const Color(0xFF222F46), const Color(0xFF162032)],
              ),
              border: Border.all(color: isPrimary ? const Color(0xFF1E40AF) : const Color(0xFF324362)),
              borderRadius: BorderRadius.circular(6),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withOpacity(0.3),
                  offset: const Offset(0, 2),
                  blurRadius: 3,
                ),
              ],
            ),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(icon, size: 16, color: isPrimary ? Colors.white : const Color(0xFFE2E8F0)),
                const SizedBox(height: 2),
                Text(label, style: TextStyle(color: isPrimary ? Colors.white : const Color(0xFFCBD5E1), fontSize: 9.5, fontWeight: FontWeight.w600)),
              ],
            ),
          ),
        ),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // LEFT CATEGORY TREE (IDM TAXONOMY)
  // ---------------------------------------------------------------------------

  Widget _buildLeftCategorySidebar() {
    return Container(
      width: 160,
      decoration: const BoxDecoration(
        color: Color(0xFF0B101D),
        border: Border(right: BorderSide(color: Color(0xFF1C2A42))),
      ),
      child: ListView(
        padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 6),
        children: [
          _buildCategoryHeader('Categories'),
          _buildCategoryItem(MediaCategory.all, 'All Downloads', Icons.folder, _downloads.length),
          _buildCategoryItem(MediaCategory.unfinished, 'Unfinished', Icons.hourglass_top, _downloads.where((i) => i.status != DownloadStatus.completed).length),
          _buildCategoryItem(MediaCategory.finished, 'Finished', Icons.check_circle_outline, _downloads.where((i) => i.status == DownloadStatus.completed).length),
          const SizedBox(height: 8),
          _buildCategoryHeader('Media Types'),
          _buildCategoryItem(MediaCategory.compressed, 'Compressed', Icons.archive, _downloads.where((i) => i.category == MediaCategory.compressed).length),
          _buildCategoryItem(MediaCategory.documents, 'Documents', Icons.description, _downloads.where((i) => i.category == MediaCategory.documents).length),
          _buildCategoryItem(MediaCategory.music, 'Music', Icons.music_note, _downloads.where((i) => i.category == MediaCategory.music).length),
          _buildCategoryItem(MediaCategory.programs, 'Programs', Icons.settings_applications, _downloads.where((i) => i.category == MediaCategory.programs).length),
          _buildCategoryItem(MediaCategory.video, 'Video', Icons.movie, _downloads.where((i) => i.category == MediaCategory.video).length),
        ],
      ),
    );
  }

  Widget _buildCategoryHeader(String title) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(8, 8, 8, 4),
      child: Text(title.toUpperCase(), style: const TextStyle(color: Color(0xFF64748B), fontSize: 9.5, fontWeight: FontWeight.w700, letterSpacing: 0.5)),
    );
  }

  Widget _buildCategoryItem(MediaCategory category, String label, IconData icon, int count) {
    final isSelected = _selectedCategory == category;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: () => setState(() => _selectedCategory = category),
        borderRadius: BorderRadius.circular(4),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
          decoration: BoxDecoration(
            color: isSelected ? const Color(0xFF182844) : Colors.transparent,
            border: Border(left: BorderSide(color: isSelected ? const Color(0xFF3B82F6) : Colors.transparent, width: 2.5)),
            borderRadius: BorderRadius.circular(4),
          ),
          child: Row(
            children: [
              Icon(icon, size: 14, color: isSelected ? const Color(0xFF60A5FA) : const Color(0xFF94A3B8)),
              const SizedBox(width: 8),
              Expanded(child: Text(label, style: TextStyle(color: isSelected ? Colors.white : const Color(0xFF94A3B8), fontSize: 11, fontWeight: isSelected ? FontWeight.w600 : FontWeight.w400))),
              Text('$count', style: TextStyle(color: isSelected ? const Color(0xFF60A5FA) : const Color(0xFF64748B), fontSize: 10, fontWeight: FontWeight.bold)),
            ],
          ),
        ),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // MAIN DOWNLOAD DATA GRID (TABLE)
  // ---------------------------------------------------------------------------

  Widget _buildMainDownloadGrid() {
    final list = _filteredDownloads;
    return Container(
      color: const Color(0xFF090E1A),
      child: Column(
        children: [
          // Table Header
          Container(
            height: 28,
            padding: const EdgeInsets.symmetric(horizontal: 10),
            decoration: const BoxDecoration(
              color: Color(0xFF111A2C),
              border: Border(bottom: BorderSide(color: Color(0xFF1E2D47))),
            ),
            child: const Row(
              children: [
                Expanded(flex: 3, child: Text('File Name', style: TextStyle(color: Color(0xFF94A3B8), fontSize: 10, fontWeight: FontWeight.w700))),
                Expanded(flex: 1, child: Text('Size', style: TextStyle(color: Color(0xFF94A3B8), fontSize: 10, fontWeight: FontWeight.w700))),
                Expanded(flex: 2, child: Text('Progress', style: TextStyle(color: Color(0xFF94A3B8), fontSize: 10, fontWeight: FontWeight.w700))),
                Expanded(flex: 1, child: Text('Status', style: TextStyle(color: Color(0xFF94A3B8), fontSize: 10, fontWeight: FontWeight.w700))),
                Expanded(flex: 1, child: Text('Transfer rate', style: TextStyle(color: Color(0xFF94A3B8), fontSize: 10, fontWeight: FontWeight.w700))),
                Expanded(flex: 1, child: Text('Time Left', style: TextStyle(color: Color(0xFF94A3B8), fontSize: 10, fontWeight: FontWeight.w700))),
              ],
            ),
          ),
          Expanded(
            child: list.isEmpty
                ? const Center(child: Text('No downloads in this category', style: TextStyle(color: Color(0xFF64748B), fontSize: 12)))
                : ListView.builder(
                    itemCount: list.length,
                    itemBuilder: (context, index) {
                      final item = list[index];
                      final isSelected = _selectedIds.contains(item.id);
                      return _buildTableRow(item, isSelected);
                    },
                  ),
          ),
        ],
      ),
    );
  }

  Widget _buildTableRow(DownloadItem item, bool isSelected) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: () {
          setState(() {
            _selectedIds.clear();
            _selectedIds.add(item.id);
          });
        },
        onDoubleTap: () => _openProgressDialog(item),
        child: Container(
          height: 32,
          padding: const EdgeInsets.symmetric(horizontal: 10),
          decoration: BoxDecoration(
            color: isSelected ? const Color(0xFF14243F) : (item.status == DownloadStatus.downloading ? const Color(0xFF0D1422) : Colors.transparent),
            border: Border(
              left: BorderSide(color: isSelected ? const Color(0xFF3B82F6) : Colors.transparent, width: 2),
              bottom: const BorderSide(color: Color(0xFF111928)),
            ),
          ),
          child: Row(
            children: [
              Expanded(
                flex: 3,
                child: Row(
                  children: [
                    Icon(_getIconForCategory(item.category), size: 14, color: const Color(0xFF60A5FA)),
                    const SizedBox(width: 6),
                    Expanded(child: Text(item.filename, style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w500), overflow: TextOverflow.ellipsis)),
                  ],
                ),
              ),
              Expanded(
                flex: 1,
                child: Text(DownloadItem.formatBytes(item.totalBytes), style: const TextStyle(color: Color(0xFFCBD5E1), fontSize: 11)),
              ),
              Expanded(
                flex: 2,
                child: Padding(
                  padding: const EdgeInsets.only(right: 12),
                  child: Row(
                    children: [
                      Expanded(
                        child: Container(
                          height: 7,
                          decoration: BoxDecoration(
                            color: const Color(0xFF070B14),
                            border: Border.all(color: const Color(0xFF1E2B42)),
                            borderRadius: BorderRadius.circular(3),
                          ),
                          child: FractionallySizedBox(
                            alignment: Alignment.centerLeft,
                            widthFactor: item.progress,
                            child: Container(
                              decoration: BoxDecoration(
                                gradient: LinearGradient(
                                  colors: item.status == DownloadStatus.completed
                                      ? [const Color(0xFF059669), const Color(0xFF10B981)]
                                      : [const Color(0xFF2563EB), const Color(0xFF60A5FA)],
                                ),
                                borderRadius: BorderRadius.circular(2),
                              ),
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Text('${item.percentage}%', style: TextStyle(color: item.status == DownloadStatus.completed ? const Color(0xFF34D399) : const Color(0xFF60A5FA), fontSize: 10, fontWeight: FontWeight.bold)),
                    ],
                  ),
                ),
              ),
              Expanded(
                flex: 1,
                child: Text(_statusText(item.status), style: TextStyle(color: _statusColor(item.status), fontSize: 10.5, fontWeight: FontWeight.w600)),
              ),
              Expanded(
                flex: 1,
                child: Text(item.speedString, style: const TextStyle(color: Color(0xFF34D399), fontSize: 11, fontFamily: 'monospace', fontWeight: FontWeight.bold)),
              ),
              Expanded(
                flex: 1,
                child: Text(item.etaString, style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 11)),
              ),
            ],
          ),
        ),
      ),
    );
  }

  IconData _getIconForCategory(MediaCategory cat) {
    switch (cat) {
      case MediaCategory.compressed:
        return Icons.archive;
      case MediaCategory.documents:
        return Icons.description;
      case MediaCategory.music:
        return Icons.music_note;
      case MediaCategory.programs:
        return Icons.settings_applications;
      case MediaCategory.video:
        return Icons.movie;
      default:
        return Icons.insert_drive_file;
    }
  }

  String _statusText(DownloadStatus status) {
    switch (status) {
      case DownloadStatus.downloading: return 'Receiving...';
      case DownloadStatus.completed: return 'Complete';
      case DownloadStatus.paused: return 'Paused';
      case DownloadStatus.queued: return 'Queued';
      case DownloadStatus.error: return 'Failed';
      default: return 'Idle';
    }
  }

  Color _statusColor(DownloadStatus status) {
    switch (status) {
      case DownloadStatus.downloading: return const Color(0xFF60A5FA);
      case DownloadStatus.completed: return const Color(0xFF34D399);
      case DownloadStatus.paused: return const Color(0xFFF59E0B);
      case DownloadStatus.error: return const Color(0xFFEF4444);
      default: return const Color(0xFF94A3B8);
    }
  }

  Widget _buildFooterStatusBar() {
    return Container(
      height: 26,
      padding: const EdgeInsets.symmetric(horizontal: 10),
      decoration: const BoxDecoration(
        color: Color(0xFF0B101D),
        border: Border(top: BorderSide(color: Color(0xFF1C2A42))),
      ),
      child: Row(
        children: [
          Text('${_downloads.length} downloads', style: const TextStyle(color: Color(0xFF64748B), fontSize: 10.5)),
          const SizedBox(width: 14),
          Text('Total size: ${DownloadItem.formatBytes(_downloads.fold(0, (sum, i) => sum + i.totalBytes))}', style: const TextStyle(color: Color(0xFF64748B), fontSize: 10.5)),
          const Spacer(),
          const Icon(Icons.shield, size: 12, color: Color(0xFF10B981)),
          const SizedBox(width: 4),
          const Text('Browser Interception Active', style: TextStyle(color: Color(0xFF10B981), fontSize: 10, fontWeight: FontWeight.w600)),
        ],
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // ACTIONS & DIALOG TRIGGERS
  // ---------------------------------------------------------------------------

  void _resumeSelected() {
    setState(() {
      for (var id in _selectedIds) {
        final item = _downloads.firstWhere((i) => i.id == id);
        if (item.status == DownloadStatus.paused || item.status == DownloadStatus.queued) {
          item.status = DownloadStatus.downloading;
          item.speedBytesPerSec = 24000000;
        }
      }
    });
  }

  void _pauseSelected() {
    setState(() {
      for (var id in _selectedIds) {
        final item = _downloads.firstWhere((i) => i.id == id);
        if (item.status == DownloadStatus.downloading) {
          item.status = DownloadStatus.paused;
          item.speedBytesPerSec = 0;
        }
      }
    });
  }

  void _stopAll() {
    setState(() {
      for (var item in _downloads) {
        if (item.status == DownloadStatus.downloading) {
          item.status = DownloadStatus.paused;
          item.speedBytesPerSec = 0;
        }
      }
    });
  }

  void _deleteSelected() {
    setState(() {
      _downloads.removeWhere((i) => _selectedIds.contains(i.id));
      _selectedIds.clear();
    });
  }

  void _deleteCompleted() {
    setState(() {
      _downloads.removeWhere((i) => i.status == DownloadStatus.completed);
      _selectedIds.clear();
    });
  }

  void _showAddUrlDialog() {
    showDialog(
      context: context,
      builder: (context) => const RedXAddUrlDialog(),
    ).then((newItem) {
      if (newItem != null && newItem is DownloadItem) {
        setState(() => _downloads.insert(0, newItem));
      }
    });
  }

  void _openProgressDialog(DownloadItem item) {
    showDialog(
      context: context,
      builder: (context) => RedXProgressMonitorDialog(item: item),
    );
  }
}

// -----------------------------------------------------------------------------
// IN-FLIGHT DOWNLOAD MONITOR DIALOG (IDM TELEMETRY & 8-STREAM CHUNK MAP)
// -----------------------------------------------------------------------------

class RedXProgressMonitorDialog extends StatefulWidget {
  final DownloadItem item;
  const RedXProgressMonitorDialog({super.key, required this.item});

  @override
  State<RedXProgressMonitorDialog> createState() => _RedXProgressMonitorDialogState();
}

class _RedXProgressMonitorDialogState extends State<RedXProgressMonitorDialog> {
  int _currentTab = 0;

  @override
  Widget build(BuildContext context) {
    final item = widget.item;
    return Dialog(
      backgroundColor: Colors.transparent,
      child: Container(
        width: 540,
        decoration: BoxDecoration(
          color: const Color(0xFF0D1424),
          border: Border.all(color: const Color(0xFF23324D)),
          borderRadius: BorderRadius.circular(10),
          boxShadow: [
            BoxShadow(color: Colors.black.withOpacity(0.7), blurRadius: 40, spreadRadius: 5),
          ],
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // Titlebar
            Container(
              height: 34,
              padding: const EdgeInsets.symmetric(horizontal: 12),
              decoration: const BoxDecoration(
                color: Color(0xFF111A2E),
                border: Border(bottom: BorderSide(color: Color(0xFF1E2A42))),
                borderRadius: BorderRadius.vertical(top: Radius.circular(9)),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    '${item.percentage}% · ${item.filename}',
                    style: const TextStyle(color: Color(0xFFE2E8F0), fontSize: 11, fontWeight: FontWeight.w600),
                  ),
                  InkWell(
                    onTap: () => Navigator.of(context).pop(),
                    child: const Icon(Icons.close, size: 14, color: Color(0xFFEF4444)),
                  ),
                ],
              ),
            ),
            // Tabs Strip
            Container(
              height: 28,
              decoration: const BoxDecoration(
                color: Color(0xFF0D1628),
                border: Border(bottom: BorderSide(color: Color(0xFF1F2E47))),
              ),
              child: Row(
                children: [
                  _buildTabItem(0, 'Download status'),
                  _buildTabItem(1, 'Speed Limiter'),
                  _buildTabItem(2, 'Options on completion'),
                ],
              ),
            ),
            // Main Telemetry Body
            Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                children: [
                  // IDM Key-Value Matrix
                  Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: const Color(0xFF070B14),
                      border: Border.all(color: const Color(0xFF19263C)),
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Column(
                      children: [
                        _buildKvRow('URL:', item.url),
                        _buildKvRow('Status:', item.status == DownloadStatus.completed ? 'Finished & Verified' : 'Receiving data...', isStatus: true),
                        _buildKvRow('File size:', DownloadItem.formatBytes(item.totalBytes)),
                        _buildKvRow('Downloaded:', '${DownloadItem.formatBytes(item.downloadedBytes)} (${item.percentage}%)'),
                        _buildKvRow('Transfer rate:', item.speedString, isSpeed: true),
                        _buildKvRow('Time left:', item.etaString),
                        _buildKvRow('Resume capability:', item.resumable ? 'Yes' : 'No', isResume: true),
                      ],
                    ),
                  ),
                  const SizedBox(height: 10),
                  // Progress Bar
                  Container(
                    height: 14,
                    decoration: BoxDecoration(
                      color: const Color(0xFF070B14),
                      border: Border.all(color: const Color(0xFF1E2B42)),
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: FractionallySizedBox(
                      alignment: Alignment.centerLeft,
                      widthFactor: item.progress,
                      child: Container(
                        decoration: BoxDecoration(
                          gradient: LinearGradient(
                            colors: item.status == DownloadStatus.completed
                                ? [const Color(0xFF059669), const Color(0xFF10B981)]
                                : [const Color(0xFF2563EB), const Color(0xFF60A5FA)],
                          ),
                          borderRadius: BorderRadius.circular(5),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 10),
                  // Multi-Connection Chunk Stream Map (IDM-Exclusive Feature)
                  Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: const Color(0xFF060912),
                      border: Border.all(color: const Color(0xFF18243A)),
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Text('Start positions and download progress by connections', style: TextStyle(color: Color(0xFF94A3B8), fontSize: 9.5, fontWeight: FontWeight.bold)),
                            Text('8 TCP Streams', style: TextStyle(color: Color(0xFF60A5FA), fontSize: 9.5, fontWeight: FontWeight.bold)),
                          ],
                        ),
                        const SizedBox(height: 6),
                        Row(
                          children: List.generate(8, (i) {
                            final p = i < item.segments.length ? item.segments[i].progress : 0.8;
                            return Expanded(
                              child: Container(
                                height: 12,
                                margin: const EdgeInsets.symmetric(horizontal: 1.5),
                                decoration: BoxDecoration(
                                  color: const Color(0xFF10192A),
                                  border: Border.all(color: const Color(0xFF1C2C47)),
                                  borderRadius: BorderRadius.circular(2),
                                ),
                                child: FractionallySizedBox(
                                  alignment: Alignment.centerLeft,
                                  widthFactor: p,
                                  child: Container(color: const Color(0xFF2563EB)),
                                ),
                              ),
                            );
                          }),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 12),
                  // Action Buttons
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      ElevatedButton(
                        onPressed: () {},
                        style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF1A263C), foregroundColor: const Color(0xFFCBD5E1), padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6)),
                        child: const Text('« Details', style: TextStyle(fontSize: 11)),
                      ),
                      Row(
                        children: [
                          if (item.status == DownloadStatus.downloading)
                            ElevatedButton(
                              onPressed: () {
                                setState(() {
                                  item.status = DownloadStatus.paused;
                                  item.speedBytesPerSec = 0;
                                });
                              },
                              style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF1E293B), foregroundColor: Colors.white, padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6)),
                              child: const Text('Pause', style: TextStyle(fontSize: 11)),
                            )
                          else if (item.status == DownloadStatus.paused)
                            ElevatedButton(
                              onPressed: () {
                                setState(() {
                                  item.status = DownloadStatus.downloading;
                                  item.speedBytesPerSec = 24000000;
                                });
                              },
                              style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF2563EB), foregroundColor: Colors.white, padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6)),
                              child: const Text('Resume', style: TextStyle(fontSize: 11)),
                            ),
                          const SizedBox(width: 8),
                          ElevatedButton(
                            onPressed: () => Navigator.of(context).pop(),
                            style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF1E293B), foregroundColor: const Color(0xFFEF4444), padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6)),
                            child: const Text('Cancel', style: TextStyle(fontSize: 11)),
                          ),
                        ],
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildTabItem(int index, String title) {
    final active = _currentTab == index;
    return InkWell(
      onTap: () => setState(() => _currentTab = index),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12),
        alignment: Alignment.center,
        decoration: BoxDecoration(
          border: Border(bottom: BorderSide(color: active ? const Color(0xFF3B82F6) : Colors.transparent, width: 2)),
        ),
        child: Text(title, style: TextStyle(color: active ? const Color(0xFF60A5FA) : const Color(0xFF94A3B8), fontSize: 10.5, fontWeight: FontWeight.w600)),
      ),
    );
  }

  Widget _buildKvRow(String key, String value, {bool isStatus = false, bool isSpeed = false, bool isResume = false}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        children: [
          SizedBox(width: 110, child: Text(key, style: const TextStyle(color: Color(0xFF64748B), fontSize: 10.5, fontWeight: FontWeight.w600))),
          Expanded(
            child: Text(
              value,
              style: TextStyle(
                color: isSpeed
                    ? const Color(0xFF34D399)
                    : (isStatus ? const Color(0xFF60A5FA) : (isResume ? const Color(0xFF34D399) : const Color(0xFFF1F5F9))),
                fontSize: isSpeed ? 11.5 : 10.5,
                fontWeight: isSpeed || isResume ? FontWeight.bold : FontWeight.w500,
                fontFamily: isSpeed ? 'monospace' : null,
              ),
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }
}

// -----------------------------------------------------------------------------
// DOWNLOAD FILE INFO DIALOG (NEW DOWNLOAD CAPTURE MODAL)
// -----------------------------------------------------------------------------

class RedXAddUrlDialog extends StatefulWidget {
  const RedXAddUrlDialog({super.key});

  @override
  State<RedXAddUrlDialog> createState() => _RedXAddUrlDialogState();
}

class _RedXAddUrlDialogState extends State<RedXAddUrlDialog> {
  final _urlController = TextEditingController(text: 'https://cdn.example.com/releases/RedX-Installer-x64.exe');
  final _savePathController = TextEditingController(text: r'C:\Users\User\Downloads\Programs\RedX-Installer-x64.exe');
  MediaCategory _category = MediaCategory.programs;

  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: Colors.transparent,
      child: Container(
        width: 480,
        decoration: BoxDecoration(
          color: const Color(0xFF0D1424),
          border: Border.all(color: const Color(0xFF23324D)),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              height: 32,
              padding: const EdgeInsets.symmetric(horizontal: 12),
              decoration: const BoxDecoration(
                color: Color(0xFF111A2E),
                border: Border(bottom: BorderSide(color: Color(0xFF1E2A42))),
                borderRadius: BorderRadius.vertical(top: Radius.circular(9)),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text('Download File Info', style: TextStyle(color: Color(0xFFE2E8F0), fontSize: 11, fontWeight: FontWeight.w600)),
                  InkWell(onTap: () => Navigator.of(context).pop(), child: const Icon(Icons.close, size: 14, color: Color(0xFFEF4444))),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                children: [
                  _buildFormField('URL:', _urlController),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      const SizedBox(width: 70, child: Text('Category:', style: TextStyle(color: Color(0xFF94A3B8), fontSize: 11))),
                      DropdownButton<MediaCategory>(
                        value: _category,
                        dropdownColor: const Color(0xFF0F172A),
                        style: const TextStyle(color: Colors.white, fontSize: 11),
                        items: const [
                          DropdownMenuItem(value: MediaCategory.programs, child: Text('Programs')),
                          DropdownMenuItem(value: MediaCategory.compressed, child: Text('Compressed')),
                          DropdownMenuItem(value: MediaCategory.documents, child: Text('Documents')),
                          DropdownMenuItem(value: MediaCategory.music, child: Text('Music')),
                          DropdownMenuItem(value: MediaCategory.video, child: Text('Video')),
                        ],
                        onChanged: (val) {
                          if (val != null) setState(() => _category = val);
                        },
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  _buildFormField('Save As:', _savePathController),
                  const SizedBox(height: 14),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      ElevatedButton(
                        onPressed: () => _submit(isLater: true),
                        style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF1A263C), foregroundColor: const Color(0xFFE2E8F0)),
                        child: const Text('Download Later', style: TextStyle(fontSize: 11)),
                      ),
                      Row(
                        children: [
                          ElevatedButton(
                            onPressed: () => _submit(isLater: false),
                            style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF2563EB), foregroundColor: Colors.white),
                            child: const Text('Start Download', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold)),
                          ),
                          const SizedBox(width: 8),
                          ElevatedButton(
                            onPressed: () => Navigator.of(context).pop(),
                            style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF1E293B), foregroundColor: const Color(0xFFCBD5E1)),
                            child: const Text('Cancel', style: TextStyle(fontSize: 11)),
                          ),
                        ],
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildFormField(String label, TextEditingController controller) {
    return Row(
      children: [
        SizedBox(width: 70, child: Text(label, style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 11))),
        Expanded(
          child: TextField(
            controller: controller,
            style: const TextStyle(color: Colors.white, fontSize: 11),
            decoration: InputDecoration(
              isDense: true,
              contentPadding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
              filled: true,
              fillColor: const Color(0xFF070B14),
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(4), borderSide: const BorderSide(color: Color(0xFF1E2D47))),
            ),
          ),
        ),
      ],
    );
  }

  void _submit({required bool isLater}) {
    final filename = _savePathController.text.split(r'\').last;
    final item = DownloadItem(
      id: DateTime.now().millisecondsSinceEpoch.toString(),
      filename: filename.isEmpty ? 'download.file' : filename,
      url: _urlController.text,
      destinationPath: _savePathController.text,
      totalBytes: 85000000,
      downloadedBytes: 0,
      speedBytesPerSec: isLater ? 0 : 22000000,
      status: isLater ? DownloadStatus.queued : DownloadStatus.downloading,
      category: _category,
      createdAt: DateTime.now(),
      segments: List.generate(8, (i) => SegmentChunk(id: i + 1, startByte: i * 10625000, endByte: (i + 1) * 10625000)),
    );
    Navigator.of(context).pop(item);
  }
}
