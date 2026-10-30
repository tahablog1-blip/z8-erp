// أقسام الرموز: تسجيل السيارات، أمر العمل، ملاحظات الخدمة — مع حفظ لقطات الشاشة
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:z8_pos/state/app_state.dart';
import 'fake_api.dart';
import 'helpers.dart';

Future<(AppState, AppStateBox)> enterSection(WidgetTester t, String code) async {
  final (app, box, _) = await make(t, activated: true);
  await t.tap(find.text('رمز قسم آخر')); await t.pumpAndSettle();
  await tapDigits(t, code); await t.pumpAndSettle();
  expect(app.phase, Phase.section);
  return (app, box);
}

void main() {
  setUpAll(loadFonts);

  testWidgets('تسجيل السيارات: التحقق من الحقول الإلزامية ثم الإرسال', (t) async {
    final (app, box) = await enterSection(t, '666666666');
    expect(app.sectionKind, 'cars');
    expect(find.text('تسجيل سيارة جديدة'), findsOneWidget);
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/10_cars.png'));
    await t.tap(find.text('تسجيل السيارة في الدور')); await t.pumpAndSettle();
    expect(find.text('اسم العميل إجباري'), findsOneWidget);
    expect(box.carBody, isNull);
    Future<void> fill(String label, String v) async { await t.enterText(find.widgetWithText(Column, label).last.evaluate().isEmpty ? find.byType(TextField).first : find.descendant(of: find.widgetWithText(Column, label).last, matching: find.byType(TextField)), v); }
    await fill('اسم العميل *', 'محمد');
    await fill('الجوال * (05xxxxxxxx)', '0512345678');
    await fill('حروف اللوحة * (3 إنجليزي)', 'abc');
    await fill('أرقام اللوحة * (1–4)', '1234');
    await fill('الماركة *', 'تويوتا'); await fill('الموديل *', 'كامري'); await fill('سنة الصنع *', '2022');
    await fill('اللون *', 'أبيض'); await fill('الممشى الحالي *', '45000'); await fill('رقم الهيكل * (17 حرف/رقم)', 'jtd12345678901234');
    await t.tap(find.text('تسجيل السيارة في الدور')); await t.pumpAndSettle();
    expect(find.text('نوع السيارة إجباري'), findsOneWidget);       // لم يُختر نوع الوقود بعد
  });

  testWidgets('أمر العمل: اختيار سيارة وإضافة صنف وتأكيد وإرسال للكاشير', (t) async {
    final (_, box) = await enterSection(t, '777777777');
    expect(find.text('اختر سيارة من الطابور لإعداد أمر العمل'), findsOneWidget);
    await t.tap(find.text('ABC 1234')); await t.pumpAndSettle();
    await t.tap(find.text('فلتر زيت تويوتا 1').first); await t.pump();
    await t.tap(find.text('فلتر زيت تويوتا 1').first); await t.pump();
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/11_workorder.png'));
    await t.tap(find.text('تأكيد وإرسال للكاشير')); await t.pumpAndSettle();
    final b = box.prepareBody!;
    expect((b['items'] as List).single, {'productId': 'p0', 'qty': 2});
    expect(find.textContaining('تم الإرسال إلى الكاشير'), findsOneWidget);
  });

  testWidgets('ملاحظات الخدمة: المحادثات والملاحظات', (t) async {
    final (app, _) = await enterSection(t, '555555555');
    expect(app.sectionKind, 'service_notes');
    expect(find.text('متى تكون جاهزة؟'), findsOneWidget);
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/12_notes.png'));
    await t.tap(find.textContaining('الملاحظات (')); await t.pumpAndSettle();
    expect(find.text('SN-0001'), findsOneWidget);
    expect(find.text('مشكلة فنية'), findsOneWidget);
    expect(find.text('جديدة'), findsOneWidget);
  });
}
