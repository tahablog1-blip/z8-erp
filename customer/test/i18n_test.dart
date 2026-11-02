import 'package:flutter_test/flutter_test.dart';
import 'package:z8_customer/core/i18n.dart';
import 'package:z8_customer/core/translations.dart';

void main() {
  tearDown(() => L.current = AppLang.ar);

  test('tr: العربية هي الأصل، والمتغيرات تُستبدل بعد الترجمة، وغير المترجم يبقى كما هو', () {
    expect(tr('احجز دورك الآن'), 'احجز دورك الآن');
    expect(tr('فاتورة {0}', ['A-1']), 'فاتورة A-1');
    L.current = AppLang.en;
    expect(tr('احجز دورك الآن'), 'Book your turn now');
    expect(tr('{0} ساعة و{1} دقيقة', [2, 15]), '2 h 15 min');
    expect(tr('نص غير مترجم'), 'نص غير مترجم');
    L.current = AppLang.bn;
    expect(tr('احجز دورك الآن'), 'এখনই আপনার সিরিয়াল বুক করুন');
  });

  test('كل القوالب مترجمة للغات الأربع بنفس المتغيرات', () {
    final ph = RegExp(r'\{\d\}');
    expect(kTranslations.length, greaterThan(100));
    kTranslations.forEach((ar, m) {
      for (final lang in ['en', 'bn', 'hi', 'ur']) {
        final v = m[lang];
        expect(v, isNotNull, reason: '$ar → $lang');
        expect(v!.trim(), isNotEmpty, reason: '$ar → $lang');
        expect(ph.allMatches(v).map((x) => x[0]).toList()..sort(), ph.allMatches(ar).map((x) => x[0]).toList()..sort(), reason: '$ar → $lang');
      }
    });
  });

  test('اللغات: أربع مكتوبة من اليسار وأردو/عربية من اليمين', () {
    expect(AppLang.values.map((l) => l.code), ['ar', 'en', 'bn', 'hi', 'ur']);
    expect(AppLang.values.where((l) => l.rtl).map((l) => l.code), ['ar', 'ur']);
    expect(AppLang.fromCode('hi'), AppLang.hi);
    expect(AppLang.fromCode('xx'), isNull);
  });
}
