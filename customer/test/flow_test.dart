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
    await t.tap(find.text('التالي: اختيار الخدمة'));
    await t.pumpAndSettle();
    expect(find.text('اختر الخدمة'), findsOneWidget);
    await t.tap(find.text('احجز دون تحديد الزيت (يحدده الفني)'));
    await t.pumpAndSettle();
    expect(api.lastOtpToken, 'tok-1');
    expect(api.lastSelection, isNull);
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
    await t.ensureVisible(find.text('التالي: اختيار الخدمة'));
    await t.tap(find.text('التالي: اختيار الخدمة'));
    await t.pumpAndSettle();
    await t.tap(find.text('احجز دون تحديد الزيت (يحدده الفني)'));
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
    await t.tap(find.text('التالي: اختيار الخدمة'));
    await t.pumpAndSettle();
    await t.tap(find.text('احجز دون تحديد الزيت (يحدده الفني)'));
    await t.pumpAndSettle();
    expect(find.text('انتهت صلاحية التحقق — أعد التحقق برمز جديد'), findsOneWidget);
    expect(state.verified, isFalse);
    expect(state.profile.cars, isEmpty);
    await t.pumpWidget(const SizedBox());
  });

  testWidgets('اختيار أكثر من خدمة: شركات ثم زيوت، أجرة الخدمة، الإجمالي، وتنبيه السعر غير النهائي', (t) async {
    final (_, api) = await boot(t, seed: {'branch': branch, 'otp': 'old', 'phone': '0500000000'});
    await t.tap(find.text('احجز دورك الآن'));
    await t.pumpAndSettle();
    await t.tap(find.text('التالي: اختيار الخدمة'));
    await t.pumpAndSettle();
    for (final k in ['تغيير زيت ماكينة', 'تغيير زيت جير', 'تغيير زيت دفرنس', 'تغيير زيت دبل']) {
      expect(find.text(k), findsOneWidget);
    }

    // الماكينة: مرحلة الشركات ثم زيوت الشركة
    await t.tap(find.text('تغيير زيت ماكينة'));
    await t.pumpAndSettle();
    await t.tap(find.text('اختر الزيت'));
    await t.pumpAndSettle();
    expect(find.text('اختر شركة الزيت'), findsOneWidget);
    expect(find.text('شل'), findsOneWidget);
    expect(find.text('كاسترول'), findsNothing);                    // لا زيت ماكينة لها
    await t.tap(find.text('شل'));
    await t.pumpAndSettle();
    expect(find.text('شل هيلكس'), findsOneWidget);
    expect(find.text('5W-30'), findsOneWidget);
    await t.tap(find.text('شل هيلكس'));
    await t.pumpAndSettle();
    expect(find.text('اختر الخدمة'), findsOneWidget);              // عاد لشاشة الخدمات
    await t.tap(find.byIcon(Icons.add_circle_outline));            // 4.5 لتر
    await t.pumpAndSettle();

    await t.scrollUntilVisible(find.text('مع تغيير فلتر الزيت'), 200, scrollable: find.byType(Scrollable).first);
    await t.drag(find.byType(ListView).first, const Offset(0, -250));
    await t.pumpAndSettle();
    await t.tap(find.text('مع تغيير فلتر الزيت'));
    await t.pumpAndSettle();

    await t.drag(find.byType(ListView).first, const Offset(0, 600));
    await t.pumpAndSettle();
    await t.tap(find.text('تغيير زيت جير'));
    await t.pumpAndSettle();
    await t.tap(find.text('اختر الزيت'));
    await t.pumpAndSettle();
    await t.tap(find.text('كاسترول'));
    await t.pumpAndSettle();
    await t.tap(find.text('كاسترول قير'));
    await t.pumpAndSettle();

    await t.scrollUntilVisible(find.text('تغيير زيت دبل'), 200, scrollable: find.byType(Scrollable).first);
    await t.tap(find.text('تغيير زيت دبل'));                       // لا زيت مصنّف دبل → كل الزيوت
    await t.pumpAndSettle();
    await t.tap(find.text('اختر الزيت'));
    await t.pumpAndSettle();
    expect(find.text('كل الزيوت المتاحة'), findsOneWidget);
    await t.tap(find.text('أخرى'));
    await t.pumpAndSettle();
    await t.tap(find.text('زيت عام'));
    await t.pumpAndSettle();

    // ملخص الفاتورة: كل البنود وأجرة الخدمة والإجمالي + تنبيه غير نهائي
    await t.scrollUntilVisible(find.text('ملخص الفاتورة'), 200, scrollable: find.byType(Scrollable).first);
    expect(find.text('خدمة تغيير زيت'), findsOneWidget);
    expect(find.text('أجرة تغيير زيت قير'), findsNothing);          // الجير والدفرنس والدبل: الأجرة تُحدَّد في الفرع
    expect(find.textContaining('يُحدَّد سعرها داخل الفرع'), findsOneWidget);
    expect(find.text('365.00 ر.س'), findsWidgets);                  // 180 + 30 + 110 + 20 + 25
    expect(find.textContaining('هذا السعر غير نهائي'), findsOneWidget);
    expect(find.text('السعر غير نهائي — قد تُضاف أصناف داخل الفرع'), findsOneWidget);   // نفس التنبيه في الشريط السفلي

    await t.tap(find.text('تأكيد الحجز'));
    await t.pumpAndSettle();
    final items = (api.lastSelection!['items'] as List).cast<Map<String, dynamic>>();
    expect(items.map((e) => e['productId']), ['o-eng', 'svc1', 'o-gear', 'o-misc', 'f1']);
    expect(items.first['qty'], 4.5);
    expect(items.first['label'], 'تغيير زيت ماكينة: شل هيلكس 5W-30');
    expect(api.lastSelection!['withFilter'], true);
    expect(find.text('تذكرتي'), findsOneWidget);
    await t.pumpWidget(const SizedBox());
  });

  testWidgets('سيارة جديدة: نوع الوقود ثلاثة فقط (ديزل/بنزين/هايبرد)', (t) async {
    await boot(t, otp: false, seed: {'branch': branch});
    await t.tap(find.text('احجز دورك الآن'));
    await t.pumpAndSettle();
    expect(find.text('ديزل'), findsOneWidget);
    expect(find.text('بنزين'), findsOneWidget);
    expect(find.text('هايبرد'), findsOneWidget);
    expect(find.textContaining('بنزين 9'), findsNothing);
    expect(find.text('كهرباء'), findsNothing);
    await t.pumpWidget(const SizedBox());
  });

  testWidgets('صفحة السيارة: فواتير هذه السيارة فقط، وفواتيري تعرض كل السيارات', (t) async {
    final (_, api) = await boot(t, seed: {'branch': branch, 'otp': 'old', 'phone': '0500000000'});
    await t.tap(find.text('تويوتا كامري'));
    await t.pumpAndSettle();
    expect(find.text('سجل التغييرات'), findsOneWidget);
    expect(find.text('فاتورة A-100'), findsOneWidget);
    expect(find.text('فاتورة A-101'), findsOneWidget);
    expect(find.text('فاتورة B-200'), findsNothing);                // سيارة أخرى
    expect(api.invoiceCalls.last, 'car-1');
    expect(find.textContaining('80,000 كم'), findsOneWidget);
    await t.tap(find.text('فاتورة A-100'));
    await t.pumpAndSettle();
    expect(find.text('فلتر زيت'), findsOneWidget);                  // أصناف الفاتورة
    expect(find.text('عرض الفاتورة PDF'), findsOneWidget);

    await t.tap(find.byType(BackButton));
    await t.pumpAndSettle();
    await t.tap(find.text('فواتيري'));
    await t.pumpAndSettle();
    expect(api.invoiceCalls.last, isNull);
    expect(find.text('فاتورة B-200'), findsOneWidget);
    expect(find.text('فاتورة A-100'), findsOneWidget);
    await t.pumpWidget(const SizedBox());
  });
}
