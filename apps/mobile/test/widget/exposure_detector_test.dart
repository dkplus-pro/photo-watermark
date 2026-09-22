// ExposureDetector widget 冒烟(卡 7.3,待 Flutter 环境执行):
// 可见性回调喂入 ≥50% → 300ms 后 onExpose 一次;同 State 内去重。
import 'package:cms_mobile/core/ui/exposure_detector.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:visibility_detector/visibility_detector.dart';

void main() {
  testWidgets('可见性达标持续 300ms → onExpose 一次,重复回调不再报', (
    WidgetTester tester,
  ) async {
    final List<String> exposed = <String>[];
    const Key containerKey = Key('expose-target');

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ExposureDetector(
            trackId: 'home.banner',
            onExpose: exposed.add,
            child: Container(key: containerKey),
          ),
        ),
      ),
    );

    final VisibilityDetector detector = tester.widget<VisibilityDetector>(
      find.byType(VisibilityDetector),
    );
    expect(detector.key, const ValueKey<String>('expose-home.banner'));

    // 直接驱动可见性回调(不依赖真实布局几何)。
    detector.onVisibilityChanged!(
      const VisibilityInfo(key: ValueKey<String>('expose-home.banner'), size: Size(100, 100), visibleFraction: 0.6),
    );
    await tester.pump(const Duration(milliseconds: 300));
    await tester.pump();
    expect(exposed, <String>['home.banner']);

    detector.onVisibilityChanged!(
      const VisibilityInfo(key: ValueKey<String>('expose-home.banner'), size: Size(100, 100), visibleFraction: 1.0),
    );
    await tester.pump(const Duration(milliseconds: 300));
    await tester.pump();
    expect(exposed, <String>['home.banner']);
  });
}
