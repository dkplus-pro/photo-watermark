import 'dart:async';

import 'package:flutter/material.dart';
import 'package:visibility_detector/visibility_detector.dart';

/// 曝光阈值(决策 11,锁定):≥50% 可见持续 300ms。
const double kExposeRatioThreshold = 0.5;
const int kExposeDurationMs = 300;

/// 曝光触发判定(纯函数):比例与时长双阈值;非有限值一律 false。
/// 语义与 miniapp src/core/track/expose-logic.ts 的 shouldExpose 逐行对齐。
bool shouldExpose(double ratio, int durationMs) {
  return ratio.isFinite &&
      ratio >= kExposeRatioThreshold &&
      durationMs >= kExposeDurationMs;
}

/// 页面实例级去重器(决策 11:同页面实例同 trackId 只报一次,重进可再报;
/// 不做会话级/持久化去重)。tryMark 首次 true 并登记;reset 清空(显式重置 API)。
class ExposureDedup {
  final Set<String> _marked = <String>{};

  bool tryMark(String trackId) {
    if (_marked.contains(trackId)) {
      return false;
    }
    _marked.add(trackId);
    return true;
  }

  bool has(String trackId) => _marked.contains(trackId);

  void reset() => _marked.clear();

  int get size => _marked.length;
}

typedef _ExposureStartTimer = void Function(
    void Function() body, Duration delay);
typedef _ExposureCancelTimer = void Function(Object timer);

/// 曝光会话纯逻辑(一个埋点位一个会话;定时器注入,单测无 Flutter):
/// hidden →(ratio≥阈值)pending(起计时)→(持续达标)report 一次 → exposed;
/// pending 中跌回阈值下 → 撤计时回 hidden;dispose 幂等。
/// 语义与 miniapp src/core/track/expose-logic.ts 的 createExposeSession 逐行对齐。
class ExposureSession {
  ExposureSession({
    required String trackId,
    required void Function(String trackId) report,
    required ExposureDedup dedup,
    void Function(void Function() body, Duration delay)? startTimer,
    void Function(Object timer)? cancelTimer,
    double ratioThreshold = kExposeRatioThreshold,
    int durationMs = kExposeDurationMs,
  })  : _trackId = trackId,
        _report = report,
        _dedup = dedup,
        _startTimer = startTimer ?? _defaultStartTimer,
        _cancelTimer = cancelTimer ?? _defaultCancelTimer,
        _ratioThreshold = ratioThreshold,
        _durationMs = durationMs;

  final String _trackId;
  final void Function(String trackId) _report;
  final ExposureDedup _dedup;
  final _ExposureStartTimer _startTimer;
  final _ExposureCancelTimer _cancelTimer;
  final double _ratioThreshold;
  final int _durationMs;

  bool _disposed = false;

  /// hidden → pending → exposed;pending 中跌回阈值下回 hidden。
  bool _exposed = false;
  Object? _timer;
  bool _timing = false;

  static void _defaultStartTimer(void Function() body, Duration delay) {
    Timer(delay, body);
  }

  static void _defaultCancelTimer(Object timer) {
    (timer as Timer).cancel();
  }

  /// visibility_detector 回调喂入当前可见比例(0~1;非法值按 0 处理)。
  void onVisible(double ratio) {
    if (_disposed || _exposed) {
      return;
    }
    final double normalized = ratio.isFinite && ratio >= 0 ? ratio : 0.0;
    if (normalized < _ratioThreshold) {
      _cancelPending();
      return;
    }
    if (_timing) {
      return; // 计时已在跑,不重复起表
    }
    _timing = true;
    _startTimer(_onTimerElapsed, Duration(milliseconds: _durationMs));
  }

  /// 释放:清掉待定计时器;之后 onVisible 不再生效;幂等。
  void dispose() {
    if (_disposed) {
      return;
    }
    _disposed = true;
    _cancelPending();
  }

  void _cancelPending() {
    if (_timer != null) {
      _cancelTimer(_timer!);
      _timer = null;
    }
    _timing = false;
  }

  void _onTimerElapsed() {
    _timer = null;
    _timing = false;
    if (_disposed || _exposed) {
      return;
    }
    _exposed = true;
    if (_dedup.tryMark(_trackId)) {
      _report(_trackId);
    }
  }
}

/// 曝光容器:child 进入可视 ≥50% 持续 300ms → onExpose(trackId) 一次
/// (State 生命周期内去重,页面重进 State 销毁即自然重置)。
///
/// 使用范式(装配方闭包注入,core/ui 不依赖 analytics):
/// ```dart
/// ExposureDetector(
///   trackId: 'home.banner',
///   onExpose: (id) => ref.read(eventTrackerProvider).expose(id),
///   child: …,
/// )
/// ```
class ExposureDetector extends StatefulWidget {
  const ExposureDetector({
    super.key,
    required this.trackId,
    required this.onExpose,
    required this.child,
    this.ratioThreshold = kExposeRatioThreshold,
    this.durationMs = kExposeDurationMs,
  });

  final String trackId;
  final void Function(String trackId) onExpose;
  final Widget child;
  final double ratioThreshold;
  final int durationMs;

  @override
  State<ExposureDetector> createState() => _ExposureDetectorState();
}

class _ExposureDetectorState extends State<ExposureDetector> {
  late final ExposureDedup _dedup = ExposureDedup();
  late ExposureSession _session = _buildSession();

  ExposureSession _buildSession() => ExposureSession(
        trackId: widget.trackId,
        report: widget.onExpose,
        dedup: _dedup,
        ratioThreshold: widget.ratioThreshold,
        durationMs: widget.durationMs,
      );

  @override
  void didUpdateWidget(covariant ExposureDetector oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.trackId != widget.trackId ||
        oldWidget.ratioThreshold != widget.ratioThreshold ||
        oldWidget.durationMs != widget.durationMs ||
        oldWidget.onExpose != widget.onExpose) {
      _session.dispose();
      _session = _buildSession();
    }
  }

  @override
  void dispose() {
    _session.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return VisibilityDetector(
      key: ValueKey<String>('expose-${widget.trackId}'),
      onVisibilityChanged: (VisibilityInfo info) =>
          _session.onVisible(info.visibleFraction),
      child: widget.child,
    );
  }
}
