import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:z8_customer/app.dart';
import 'package:z8_customer/core/config.dart';
import 'package:z8_customer/core/store.dart';
import 'package:z8_customer/state/app_state.dart';
import 'fake_api.dart';

Future<(AppState, FakeApi)> boot(WidgetTester t, {bool otp = true, Map<String, String>? seed}) async {
  final api = FakeApi(otpRequired: otp);
  final store = MemoryStore()..m.addAll(seed ?? {});
  final state = AppState(api: api, store: store);
  await t.binding.setSurfaceSize(const Size(420, 900));
  await t.pumpWidget(CustomerApp(state: state));
  await state.init();
  await t.pumpAndSettle();
  return (state, api);
}

void main() {
  test('parseBranchId يقبل الرابط والمعرّف ويرفض غيرهما', () {
    expect(parseBranchId('https://z8masdr.duckdns.org/booking/$branch?x=1'), branch);
    expect(parseBranchId('  ${branch.toUpperCase()} '), branch);
    expect(parseBranchId('hello'), isNull);
  });

  testWidgets('أول تشغيل: رابط خاطئ يظهر خطأ ثم الرابط الصحيح يفتح الرئيسية', (t) async {
    await boot(t);
    expect(find.text('اختر فرعك'), findsOneWidget);
    await t.enterText(find.byType(TextField), 'xyz');
    await t.tap(find.text('متابعة'));
    await t.pumpAndSettle();
    expect(find.text('الرابط أو الرمز غير صحيح'), findsOneWidget);
    await t.enterText(find.byType(TextField), 'https://z8masdr.duckdns.org/booking/$branch');
    await t.tap(find.text('متابعة'));
    await t.pumpAndSettle();
    expect(find.text('فرع الخليج'), findsOneWidget);
    expect(find.text('احجز دورك الآن'), findsOneWidget);
  });

  testWidgets('رحلة كاملة: OTP ثم حجز سيارة محفوظة ثم تذكرة حية ثم محادثة', (t) async {
    final (state, api) = await boot(t, seed: {'branch': branch});
    await t.tap(find.text('احجز دورك الآن'));
    await t.pumpAndSettle();
    expect(find.text('تأكيد رقم الجوال'), findsOneWidget);

    await t.enterText(find.byType(TextField).first, '0500000000');
    await t.tap(find.text('إرسال الرمز'));
    await t.pumpAndSettle();
    await t.enterText(find.byType(TextField).last, '0000');
    await t.tap(find.text('تحقق'));
    await t.pumpAndSettle();
    expect(find.text('الرمز غير صحيح'), findsOneWidget);
    await t.enterText(find.byType(TextField).last, '١٢٣٤'); // أرقام عربية تُحوَّل
    await t.tap(find.text('تحقق'));
    await t.pumpAndSettle();

    expect(find.text('حجز جديد'), findsOneWidget);
    expect(find.text('تويوتا كامري'), findsOneWidget);
    await t.tap(find.text('تأكيد الحجز'));
    await t.pumpAndSettle();
    expect(api.lastOtpToken, 'tok-1');
    expect(find.text('تذكرتي'), findsOneWidget);
    expect(find.text('بانتظار دورك'), findsOneWidget);
    expect(find.text('4'), findsOneWidget);

    api.state = 'in_service';
    await state.refreshBooking();
    await t.pumpAndSettle();
    expect(find.text('سيارتك الآن في الخدمة'), findsOneWidget);

    await t.tap(find.text('محادثة مع الفرع'));
    await t.pumpAndSettle();
    expect(find.text('أهلاً، سيارتك في الدور'), findsOneWidget);
    await t.enterText(find.byType(TextField), 'متى يجهز؟');
    await t.tap(find.byIcon(Icons.send));
    await t.pumpAndSettle();
    expect(api.sentMessages, ['متى يجهز؟']);
    expect(find.text('متى يجهز؟'), findsOneWidget);
    await t.pumpWidget(const SizedBox());
  });

  testWidgets('حجز بسيارة جديدة يرسل البيانات كاملة (أرقام عربية تُحوَّل)', (t) async {
    final (state, api) = await boot(t, otp: false, seed: {'branch': branch});
    state.profile = state.profile; // بدون OTP ولا جوال مخزَّن: لا سيارات محفوظة
    await t.tap(find.text('احجز دورك الآن'));
    await t.pumpAndSettle();
    final fields = find.byType(TextField);
    await t.enterText(fields.at(0), 'سالم');
    await t.enterText(fields.at(1), '0555555555');
    await t.enterText(fields.at(2), '٥٦٧٨');
    await t.enterText(fields.at(3), 'ر ب ج');
    await t.ensureVisible(find.text('تأكيد الحجز'));
    await t.tap(find.text('تأكيد الحجز'));
    await t.pumpAndSettle();
    expect(api.bookings.single['name'], 'سالم');
    expect((api.bookings.single['car'] as Map)['plateNumbers'], '5678');
    expect(find.text('تذكرتي'), findsOneWidget);
    await t.pumpWidget(const SizedBox());
  });

  testWidgets('انتهاء صلاحية التحقق (401) يمسح الجلسة ويظهر الخطأ', (t) async {
    final (state, api) = await boot(t, seed: {'branch': branch, 'otp': 'old', 'phone': '0500000000'});
    expect(state.verified, isTrue);
    expect(state.profile.cars, isNotEmpty);
    api.expireOtp = true;
    await t.tap(find.text('احجز دورك الآن'));
    await t.pumpAndSettle();
    await t.tap(find.text('تأكيد الحجز'));
    await t.pumpAndSettle();
    expect(find.text('انتهت صلاحية التحقق — أعد التحقق برمز جديد'), findsOneWidget);
    expect(state.verified, isFalse);
    expect(state.profile.cars, isEmpty);
    await t.pumpWidget(const SizedBox());
  });
}
