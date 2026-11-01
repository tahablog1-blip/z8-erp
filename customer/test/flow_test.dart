import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:z8_customer/app.dart';
import 'package:z8_customer/core/geo.dart';
import 'package:z8_customer/core/store.dart';
import 'package:z8_customer/state/app_state.dart';
import 'fake_api.dart';

const riyadh = LatLng(24.7140, 46.6760); // قرب فرع الخليج

Future<(AppState, FakeApi)> boot(WidgetTester t, {bool otp = true, Map<String, String>? seed, FakeLocation? loc}) async {
  final api = FakeApi(otpRequired: otp);
  final store = MemoryStore()..m.addAll(seed ?? {});
  final state = AppState(api: api, store: store, location: loc ?? FakeLocation(fresh: riyadh));
  await t.binding.setSurfaceSize(const Size(420, 900));
  await t.pumpWidget(CustomerApp(state: state));
  await state.init();
  await t.pumpAndSettle();
  return (state, api);
}

void main() {
  test('المسافة ووقت الوصول: Haversine وتقدير القيادة', () {
    final km = haversineKm(const LatLng(24.7136, 46.6753), const LatLng(21.4858, 39.1925)); // الرياض ← جدة تقريباً 850 كم
    expect(km, inInclusiveRange(820, 880));
    expect(haversineKm(riyadh, riyadh), 0);
    expect(estimateDriveMinutes(0.2), 1);                 // لا يقل عن دقيقة
    expect(estimateDriveMinutes(5), 13);                  // 6.5 كم طرقية ÷ 30 كم/س
    expect(estimateDriveMinutes(20), 32);                 // 26 كم ÷ 50 كم/س
    expect(formatKm(0.45), '450 م');
    expect(formatKm(3.24), '3.2 كم');
    expect(formatMinutes(75), '1 ساعة و15 دقيقة');
  });

  testWidgets('أول تشغيل بلا إدخال رابط: كل الفروع مرتّبة بالأقرب مع المسافة والوقت ونوع الفرع', (t) async {
    final (state, _) = await boot(t);
    expect(find.text('اختر الفرع'), findsOneWidget);
    expect(find.byType(TextField), findsNothing);               // لا حقل رابط
    final names = state.branches.map((b) => b.name).toList();
    expect(names, ['فرع الخليج', 'معرض التجزئة', 'فرع الشرق', 'فرع بلا موقع']); // الأقرب أولاً، وبلا موقع آخراً
    expect(find.text('الأقرب إليك'), findsOneWidget);
    expect(find.text('خدمة'), findsNWidgets(3));
    expect(find.text('بيع تجزئة'), findsOneWidget);
    expect(find.textContaining('يصلك خلال'), findsNWidgets(3));
    expect(find.text('بيع بالقطعة — لا يوجد حجز دور في هذا الفرع'), findsOneWidget);
    expect(find.text('احجز من هذا الفرع'), findsNWidgets(3));   // التجزئة بلا زر حجز
    expect(find.text('موقع الفرع غير محدد بعد'), findsOneWidget);
    await t.pumpWidget(const SizedBox());
  });

  testWidgets('بدون إذن الموقع: القائمة تظهر بلا مسافات مع تنبيه، ولا انهيار', (t) async {
    final (state, _) = await boot(t, loc: FakeLocation());
    expect(state.locationDenied, isTrue);
    expect(find.text('فعّل الموقع ليظهر لك أقرب فرع ووقت الوصول إليه'), findsOneWidget);
    expect(find.text('الأقرب إليك'), findsNothing);
    expect(find.textContaining('يصلك خلال'), findsNothing);
    expect(find.text('فرع الخليج'), findsOneWidget);
    await t.pumpWidget(const SizedBox());
  });

  testWidgets('اختيار فرع خدمة يفتح الرئيسية ويُحفظ، وتغيير الفرع من القائمة', (t) async {
    final (state, _) = await boot(t);
    await t.tap(find.text('احجز من هذا الفرع').first);
    await t.pumpAndSettle();
    expect(find.text('احجز دورك الآن'), findsOneWidget);
    expect(state.branchId, branch);
    // إعادة تشغيل التطبيق: يتذكر الفرع ولا يعرض القائمة
    expect(find.text('اختر الفرع'), findsNothing);
    await t.tap(find.byType(PopupMenuButton<String>));
    await t.pumpAndSettle();
    await t.tap(find.text('تغيير الفرع'));
    await t.pumpAndSettle();
    expect(find.text('الفرع الحالي'), findsOneWidget);
    await t.pumpWidget(const SizedBox());
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
