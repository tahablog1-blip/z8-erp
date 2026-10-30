import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:z8_pos/core/api.dart';
import 'package:z8_pos/state/app_state.dart';
import 'fake_api.dart';
import 'helpers.dart';

void main() {
  setUpAll(loadFonts);

  testWidgets('تفعيل الجهاز: رمز خاطئ ثم رمز الفرع يعرض بطاقات الكاشيرين', (t) async {
    final (app, _, _) = await make(t);
    expect(app.phase, Phase.needsCode);
    expect(find.text('تفعيل الجهاز'), findsOneWidget);
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/01_entry.png'));
    await tapDigits(t, '999999999'); await t.pumpAndSettle();
    expect(find.text('الرمز غير صحيح'), findsOneWidget);         // يمسح الرمز ويعرض الخطأ
    await tapDigits(t, '123456789'); await t.pumpAndSettle();
    expect(app.phase, Phase.cards);
    expect(find.text('أحمد العتيبي'), findsOneWidget);
    expect(find.text('سارة الحربي'), findsOneWidget);
    expect(find.text('فرع فرع الخليج'), findsOneWidget);
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/02_cards.png'));
  });

  testWidgets('بطاقة كاشير ثم رمزه: خطأ ثم دخول ثم فتح الجلسة والبيع والدفع', (t) async {
    final (app, box, api) = await make(t, activated: true);
    expect(app.phase, Phase.cards);
    await t.tap(find.text('خالد بلا رمز')); await t.pumpAndSettle();
    expect(app.phase, Phase.cards);                               // بلا رمز: لا يدخل
    await t.tap(find.text('أحمد العتيبي')); await t.pumpAndSettle();
    expect(app.phase, Phase.pin);
    await tapDigits(t, '0000'); await t.tap(find.text('دخول')); await t.pumpAndSettle();
    expect(find.text('الرمز غير صحيح'), findsOneWidget);
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/03_pin.png'));
    await tapDigits(t, '1234'); await t.tap(find.text('دخول')); await t.pumpAndSettle();
    expect(app.phase, Phase.pos);
    expect(api.token, 'utok');
    // لا جلسة على الجهاز: تظهر بطاقة فتح الجلسة
    expect(find.text('افتح جلسة'), findsOneWidget);
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/04_open_shift.png'));
    await t.tap(find.text('فتح الجلسة')); await t.pumpAndSettle();
    expect(box.shiftOpen, true);
    expect(find.text('الجلسة: نشطة'), findsWidgets);
    expect(find.text('الفاتورة فارغة'), findsOneWidget);
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/05_pos_empty.png'));
    // نفد: p2 مخزونه صفر → لا يضاف
    expect(find.text('نفد'), findsOneWidget);
    await t.tap(find.text('فلتر زيت تويوتا 1').first); await t.pump();
    await t.tap(find.text('فلتر زيت تويوتا 1').first); await t.pump();
    expect(find.text('2 صنف'), findsNWidgets(2));
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/06_pos_cart.png'));
    await t.tap(find.text('ادفع الآن')); await t.pumpAndSettle();
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/07_pay.png'));
    await t.tap(find.text('إصدار الفاتورة')); await t.pumpAndSettle();
    expect(find.text('تم إصدار الفاتورة'), findsOneWidget);
    expect(find.text('INV-000007'), findsOneWidget);
    final body = box.invoiceBody!;
    expect(body['branchId'], 'b1'); expect(body['source'], 'pos'); expect(body['carId'], isNull);
    expect((body['items'] as List).single['qty'], 2);
    expect((body['payments'] as List).single, {'method': 'cash', 'amount': 230.0});
    expect(body['idempotencyKey'], isNotEmpty);
  });

  testWidgets('تسجيل الخروج يعيد البطاقات ويبقي الجلسة؛ كاشير آخر يكملها', (t) async {
    final (app, box, _) = await make(t, activated: true);
    box.shiftOpen = true;
    await t.tap(find.text('أحمد العتيبي')); await t.pumpAndSettle();
    await tapDigits(t, '1234'); await t.tap(find.text('دخول')); await t.pumpAndSettle();
    expect(app.phase, Phase.pos);
    expect(find.text('الجلسة: نشطة'), findsWidgets);
    await t.tap(find.byIcon(Icons.settings_rounded)); await t.pumpAndSettle();
    expect(find.text('استمرار الجلسة'), findsOneWidget);
    expect(find.text('إغلاق الجلسة'), findsOneWidget);
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/08_gear.png'));
    await t.tap(find.text('تسجيل الخروج')); await t.pumpAndSettle();
    expect(box.loggedOut, true);
    expect(app.phase, Phase.cards);
    expect(box.shiftOpen, true);                                  // الجلسة لم تُغلق
    expect(app.api.token, isNull);
    // سارة تدخل وتكمل نفس الجلسة (لا بطاقة فتح جلسة)
    await t.tap(find.text('سارة الحربي')); await t.pumpAndSettle();
    await tapDigits(t, '1234'); await t.tap(find.text('دخول')); await t.pumpAndSettle();
    expect(app.phase, Phase.pos);
    expect(find.text('افتح جلسة'), findsNothing);
    expect(find.text('الجلسة: نشطة'), findsWidgets);
  });

  testWidgets('رمز قسم آخر يفتح قسماً بتوكنه المقيَّد', (t) async {
    final (app, _, api) = await make(t, activated: true);
    await t.tap(find.text('رمز قسم آخر')); await t.pumpAndSettle();
    expect(find.text('رمز قسم'), findsOneWidget);
    await tapDigits(t, '555555555'); await t.pumpAndSettle();
    expect(app.phase, Phase.section);
    expect(app.sectionKind, 'service_notes');
    expect(api.token, 'stok');
  });
}
