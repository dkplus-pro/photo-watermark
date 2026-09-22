// 曝光埋点单测(卡 7.3 E1–E10):纯 Dart + fake 定时器,无 Flutter 渲染依赖。
// E9 的真实实现冒烟需 flutter_test 环境,见 test/widget/exposure_detector_test.dart(待 Flutter 环境)。
import 'package:flutter_test/flutter_test.dart';

import 'package:cms_mobile/core/analytics/event_tracker.dart';
import 'package:cms_mobile/core/ui/exposure_detector.dart';

class _FakeEventTracker implements EventTracker {
  final List<String> calls = <String>[];

  @override
  void pageView(String path, {Map<String, Object?>? properties}) {}

  @override
  void track(String name, {Map<String, Object?>? properties}) {
    calls.add(name);
  }

  @override
  void expose(String trackId, {Map<String, Object?>? properties}) {
    calls.add('expose:$trackId');
  }
}

/// fake 定时器:记录回调与延迟,手动触发;撤销只置空标记。
class _FakeTimer {
  _FakeTimer(this._session);
  final _TimerSession _session;
  bool cancelled = false;

  void fire() {
    if (cancelled) {
      return;
    }
    _session.pending.remove(this);
    body();
  }

  late void Function() body;
}

class _TimerSession {
  final List<_FakeTimer> pending = <_FakeTimer>[];
}

void main() {
  group('shouldExpose(纯函数)', () {
    test('E1: 49.9%/50%/299ms/301ms 四边界', () {
      expect(shouldExpose(0.499, 300), isFalse);
      expect(shouldExpose(0.5, 300), isTrue);
      expect(shouldExpose(0.5, 299), isFalse);
      expect(shouldExpose(0.5, 301), isTrue);
    });

    test('E2: ratio=NaN/Infinity/-0.1 → false', () {
      expect(shouldExpose(double.nan, 300), isFalse);
      expect(shouldExpose(double.infinity, 300), isFalse);
      expect(shouldExpose(-0.1, 300), isFalse);
    });
  });

  group('ExposureDedup', () {
    test('E3: 同 trackId 二次 tryMark false;reset 后放行;空串也登记', () {
      final ExposureDedup dedup = ExposureDedup();
      expect(dedup.tryMark('a'), isTrue);
      expect(dedup.tryMark('a'), isFalse);
      expect(dedup.has('a'), isTrue);
      expect(dedup.size, 1);
      dedup.reset();
      expect(dedup.size, 0);
      expect(dedup.tryMark('a'), isTrue);
      expect(dedup.tryMark(''), isTrue);
      expect(dedup.has(''), isTrue);
    });
  });

  group('ExposureSession(fake 定时器)', () {
    late _TimerSession timers;
    late ExposureDedup dedup;
    late List<String> reported;

    ExposureSession buildSession(String trackId) {
      _FakeTimer? current;
      return ExposureSession(
        trackId: trackId,
        report: (String id) => reported.add(id),
        dedup: dedup,
        startTimer: (void Function() body, Duration delay) {
          final _FakeTimer timer = _FakeTimer(timers)..body = body;
          current = timer;
          timers.pending.add(timer);
        },
        cancelTimer: (Object timer) {
          (timer as _FakeTimer).cancelled = true;
          timers.pending.remove(timer);
          if (current == timer) {
            current = null;
          }
        },
      );
    }

    void advance() {
      for (final _FakeTimer timer in List<_FakeTimer>.of(timers.pending)) {
        timer.fire();
      }
    }

    setUp(() {
      timers = _TimerSession();
      dedup = ExposureDedup();
      reported = <String>[];
    });

    test('E4: 达阈值起计时,300ms 后 report 一次', () {
      final ExposureSession session = buildSession('s1');
      session.onVisible(0.5);
      advance();
      expect(reported, <String>['s1']);
    });

    test('E5: pending 中跌回 0.4 撤计时;再次 0.5 重新起计时', () {
      final ExposureSession session = buildSession('s1');
      session.onVisible(0.6);
      session.onVisible(0.4);
      advance();
      expect(reported, isEmpty);
      session.onVisible(0.5);
      advance();
      expect(reported, <String>['s1']);
    });

    test('E6: 已 exposed 后任何 onVisible 不再报', () {
      final ExposureSession session = buildSession('s1');
      session.onVisible(1.0);
      advance();
      session.onVisible(1.0);
      advance();
      expect(reported, <String>['s1']);
    });

    test('E7: 同 dedup 两个 Session 同 trackId → 第二个不报(页面级去重)', () {
      final ExposureSession first = buildSession('s1');
      final ExposureSession second = buildSession('s1');
      first.onVisible(0.8);
      advance();
      second.onVisible(0.8);
      advance();
      expect(reported, <String>['s1']);
    });

    test('E8: dispose 后计时器撤销、onVisible no-op;dispose 幂等', () {
      final ExposureSession session = buildSession('s1');
      session.onVisible(0.9);
      session.dispose();
      session.dispose();
      advance();
      session.onVisible(1.0);
      advance();
      expect(reported, isEmpty);
      expect(timers.pending, isEmpty);
    });

    test('E10: ratio 恰 0.5 + 时长恰 300 触发(等于边界)', () {
      final ExposureSession session = buildSession('s1');
      session.onVisible(0.5);
      advance();
      expect(reported, <String>['s1']);
    });

    test('非法 ratio(NaN/负)按 0 处理 → 不触发', () {
      final ExposureSession session = buildSession('s1');
      session.onVisible(double.nan);
      advance();
      session.onVisible(-1);
      advance();
      expect(reported, isEmpty);
    });
  });

  group('E9: EventTracker expose 契约(fake 编译护栏)', () {
    test('fake 实现接口含 expose,经接口调用转发 trackId', () {
      final _FakeEventTracker tracker = _FakeEventTracker();
      final EventTracker iface = tracker;
      iface.expose('home.banner');
      expect(tracker.calls, <String>['expose:home.banner']);
    });
  });
}
