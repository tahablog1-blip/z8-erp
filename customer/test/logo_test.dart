import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:z8_customer/core/brand.dart';

void main() {
  test('هيكل الشعار: خط واحد متصل يبدأ من أعلى يسار الـ Z وينتهي عند ذيل الثمانية', () {
    final pts = logoSkeleton();
    expect(pts.first, const Offset(70, 55));                       // بداية الخط عند السهم (أعلى يسار Z)
    expect(pts.last.dx, greaterThan(650));                          // ينتهي عند ذيل الحلقة العليا يميناً
    var gap = 0.0;
    for (var i = 1; i < pts.length; i++) {
      gap = gap > (pts[i] - pts[i - 1]).distance ? gap : (pts[i] - pts[i - 1]).distance;
    }
    expect(gap, lessThan(60));                                      // لا قفزات كبيرة بين النقاط (يُوصل بينها بخط مستقيم)
    for (final p in pts) {
      expect(p.dx, inInclusiveRange(0, 832));
      expect(p.dy, inInclusiveRange(0, 868));
    }
  });

  testWidgets('الرسم بالتقدم ثم اللمعة: لا أخطاء في كل المراحل', (t) async {
    late ui.Image img;
    await t.runAsync(() async {
      final data = await rootBundle.load('assets/images/logo-white.png');
      img = (await (await ui.instantiateImageCodec(data.buffer.asUint8List())).getNextFrame()).image;
    });
    for (final f in [(0.0, -1.0), (0.3, -1.0), (0.99, -1.0), (1.0, -1.0), (1.0, 0.0), (1.0, 0.5), (1.0, 1.0)]) {
      await t.pumpWidget(Directionality(textDirection: TextDirection.ltr, child: SizedBox(width: 200, height: 210, child: CustomPaint(painter: LogoPainter(img, f.$1, f.$2)))));
    }
    expect(tester(t), isTrue);
  });
}

bool tester(WidgetTester t) => t.takeException() == null;
