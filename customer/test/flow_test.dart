import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:z8_customer/app.dart';
import 'package:z8_customer/core/brand.dart';
import 'package:z8_customer/core/car_brands.dart';
import 'package:z8_customer/core/geo.dart';
import 'package:z8_customer/core/location.dart';
import 'package:z8_customer/core/i18n.dart';
import 'package:z8_customer/core/store.dart';
import 'package:z8_customer/core/widgets.dart';
import 'package:z8_customer/state/app_state.dart';
import 'fake_api.dart';

const riyadh = LatLng(24.7140, 46.6760); // قرب فرع الخليج

Future<(AppState, FakeApi)> boot(WidgetTester t, {bool otp = true, Map<String, String>? seed, FakeLocation? loc, bool geofence = false, double near = 30}) async {
  final api = FakeApi(otpRequired: otp, geofence: geofence)..nearMeters = near;
  final store = MemoryStore()..m.addAll({'lang': 'ar', ...?seed});
  final state = AppState(api: api, store: store, location: loc ?? FakeLocation(fresh: riyadh));
  await t.binding.setSurfaceSize(const Size(420, 900));
  await t.pumpWidget(CustomerApp(state: state, showSplash: false));
  await state.init();
  await t.pumpAndSettle();
  return (state, api);
}

void main() {
  Motion.enabled = false;   // الحركات المستمرة تمنع استقرار الشاشة في الاختبار
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
    expect(find.text('حجز جديد'), findsOneWidget);
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
    await t.tap(find.text('حجز جديد'));
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
    await t.tap(find.text('حجز جديد'));
    await t.pumpAndSettle();
    await t.binding.setSurfaceSize(const Size(420, 1800));   // يُبنى النموذج كاملاً فلا تتغيّر فهارس الحقول بالتمرير
    await t.pumpAndSettle();
    final fields = find.byType(TextField);
    await t.enterText(fields.at(0), 'سالم');
    await t.enterText(fields.at(1), '0555555555');
    await t.enterText(fields.at(2), '٥٦٧٨');
    await t.enterText(fields.at(3), 'ر ب ج');
    await t.scrollUntilVisible(find.text('التالي: اختيار الخدمة'), 200, scrollable: find.byType(Scrollable).first);
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
    await t.tap(find.text('حجز جديد'));
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
    await t.tap(find.text('حجز جديد'));
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
    expect(find.text('الكمية (عدد القطع)'), findsOneWidget);
    await t.tap(find.byIcon(Icons.add_circle_outline));            // 4 → 5 قطع (أعداد صحيحة فقط)
    await t.pumpAndSettle();
    expect(find.text('5'), findsOneWidget);
    expect(find.text('200.00 ر.س'), findsWidgets);                 // 40 × 5

    await t.scrollUntilVisible(find.text('مع تغيير فلتر الزيت'), 200, scrollable: find.byType(Scrollable).first);
    await t.drag(find.byType(ListView).first, const Offset(0, -250));
    await t.pumpAndSettle();
    await t.tap(find.text('مع تغيير فلتر الزيت'));
    await t.pumpAndSettle();

    await t.drag(find.byType(ListView).first, const Offset(0, 600));
    await t.pumpAndSettle();
    await t.tap(find.text('تغيير زيت جير'));
    await t.pumpAndSettle();
    await t.scrollUntilVisible(find.text('اختر الزيت'), 200, scrollable: find.byType(Scrollable).first);
    await t.ensureVisible(find.text('اختر الزيت'));
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
    await t.scrollUntilVisible(find.text('اختر الزيت'), 200, scrollable: find.byType(Scrollable).first);
    await t.ensureVisible(find.text('اختر الزيت'));
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
    expect(find.text('385.00 ر.س'), findsWidgets);                  // 200 + 30 + 110 + 20 + 25
    expect(find.textContaining('هذا السعر غير نهائي'), findsOneWidget);
    expect(find.text('السعر غير نهائي — قد تُضاف أصناف داخل الفرع'), findsOneWidget);   // نفس التنبيه في الشريط السفلي

    await t.tap(find.text('تأكيد الحجز'));
    await t.pumpAndSettle();
    final items = (api.lastSelection!['items'] as List).cast<Map<String, dynamic>>();
    expect(items.map((e) => e['productId']), ['o-eng', 'svc1', 'o-gear', 'o-misc', 'f1']);
    expect(items.first['qty'], 5);                                   // عدد قطع صحيح
    expect(items.first['label'], 'تغيير زيت ماكينة: شل هيلكس 5W-30');
    expect(api.lastSelection!['withFilter'], true);
    expect(find.text('تذكرتي'), findsOneWidget);
    await t.pumpWidget(const SizedBox());
  });

  testWidgets('منتج نافد: تظهر «غير متوفر الآن» على بطاقته، والضغط عليه يُنبّه ولا يُختار', (t) async {
    await boot(t, seed: {'branch': branch, 'otp': 'old', 'phone': '0500000000'});
    await t.tap(find.text('حجز جديد'));
    await t.pumpAndSettle();
    await t.tap(find.text('التالي: اختيار الخدمة'));
    await t.pumpAndSettle();
    await t.tap(find.text('تغيير زيت ماكينة'));
    await t.pumpAndSettle();
    await t.tap(find.text('اختر الزيت'));
    await t.pumpAndSettle();
    await t.tap(find.text('شل'));
    await t.pumpAndSettle();
    expect(find.text('غير متوفر الآن'), findsNWidgets(2));            // شارة البطاقة + مكان السعر
    expect(find.text('90.00 ر.س'), findsNothing);                    // لا سعر لمنتج غير متوفر
    await t.tap(find.text('شل ألترا'));
    await t.pump();
    expect(find.text('هذا المنتج غير متوفر الآن'), findsOneWidget);   // رسالة التنبيه
    expect(find.text('شل هيلكس'), findsOneWidget);                   // ما زلنا في قائمة الشركة (لم يُختر)
    await t.tap(find.text('شل هيلكس'));                               // المتوفر يُختار عادياً
    await t.pumpAndSettle();
    expect(find.text('اختر الخدمة'), findsOneWidget);
    await t.pumpWidget(const SizedBox());
  });

  testWidgets('أجرة الزيت الخارجي تختلف عن العادية (37.9 مقابل 30)، وتتبدّل بتبديل المصدر', (t) async {
    final (_, api) = await boot(t, seed: {'branch': branch, 'otp': 'old', 'phone': '0500000000'});
    await t.tap(find.text('حجز جديد'));
    await t.pumpAndSettle();
    await t.tap(find.text('التالي: اختيار الخدمة'));
    await t.pumpAndSettle();
    await t.tap(find.text('تغيير زيت ماكينة'));
    await t.pumpAndSettle();
    await t.tap(find.text('زيت خارجي (أحضره بنفسي)'));
    await t.pumpAndSettle();
    expect(find.text('37.90 ر.س'), findsWidgets);                     // أجرة الخارجي
    await t.tap(find.text('زيت من الفرع'));
    await t.pumpAndSettle();
    await t.tap(find.text('اختر الزيت'));
    await t.pumpAndSettle();
    await t.tap(find.text('شل'));
    await t.pumpAndSettle();
    await t.tap(find.text('شل هيلكس'));
    await t.pumpAndSettle();
    await t.scrollUntilVisible(find.text('ملخص الفاتورة'), 200, scrollable: find.byType(Scrollable).first);
    expect(find.text('خدمة تغيير زيت'), findsOneWidget);                // أجرة العادية 30.00
    expect(find.text('خدمة تغيير زيت خارجي'), findsNothing);
    expect(api.noExternalService, false);
    await t.pumpWidget(const SizedBox());
  });

  testWidgets('خدمة الزيت الخارجي غير مضبوطة: لا نحمّله أجرة العادية، وتُحدَّد بالفرع', (t) async {
    final api = FakeApi()..noExternalService = true;
    final state = AppState(api: api, store: MemoryStore()..m.addAll({'lang': 'ar', 'branch': branch, 'otp': 'old', 'phone': '0500000000'}), location: FakeLocation(fresh: riyadh));
    await t.binding.setSurfaceSize(const Size(420, 900));
    await t.pumpWidget(CustomerApp(state: state, showSplash: false));
    await state.init();
    await t.pumpAndSettle();
    await t.tap(find.text('حجز جديد'));
    await t.pumpAndSettle();
    await t.tap(find.text('التالي: اختيار الخدمة'));
    await t.pumpAndSettle();
    await t.tap(find.text('تغيير زيت ماكينة'));
    await t.pumpAndSettle();
    await t.tap(find.text('زيت خارجي (أحضره بنفسي)'));
    await t.pumpAndSettle();
    await t.scrollUntilVisible(find.text('ملخص الفاتورة'), 200, scrollable: find.byType(Scrollable).first);
    expect(find.text('خدمة تغيير زيت'), findsNothing);                  // لا أجرة العادية
    expect(find.textContaining('يُحدَّد سعرها داخل الفرع'), findsOneWidget);
    await t.tap(find.text('تأكيد الحجز'));
    await t.pumpAndSettle();
    expect((api.lastSelection!['items'] as List), isEmpty);
    expect(api.lastSelection!['customerNote'], contains('زيت من العميل (خارجي)'));   // الموظف يعرف ويحدد الأجرة
    await t.pumpWidget(const SizedBox());
  });

  testWidgets('زيت خارجي: بلا اختيار زيت، الأجرة فقط، وملاحظة تصل الموظف', (t) async {
    final (_, api) = await boot(t, seed: {'branch': branch, 'otp': 'old', 'phone': '0500000000'});
    await t.tap(find.text('حجز جديد'));
    await t.pumpAndSettle();
    await t.tap(find.text('التالي: اختيار الخدمة'));
    await t.pumpAndSettle();
    await t.tap(find.text('تغيير زيت ماكينة'));
    await t.pumpAndSettle();
    await t.tap(find.text('زيت خارجي (أحضره بنفسي)'));
    await t.pumpAndSettle();
    expect(find.text('اختر الزيت'), findsNothing);                    // لا اختيار زيت
    expect(find.textContaining('سيحضر الزيت من عندك'), findsOneWidget);
    await t.tap(find.text('تغيير زيت جير'));
    await t.pumpAndSettle();
    await t.tap(find.text('زيت خارجي (أحضره بنفسي)').last);
    await t.pumpAndSettle();
    await t.scrollUntilVisible(find.text('ملخص الفاتورة'), 200, scrollable: find.byType(Scrollable).first);
    expect(find.text('37.90 ر.س'), findsWidgets);                     // أجرة الماكينة الخارجية (خدمتها وأسعارها مستقلة)
    expect(find.text('خدمة تغيير زيت خارجي'), findsOneWidget);
    expect(find.textContaining('زيت من العميل (خارجي) — الأجرة فقط'), findsNWidgets(2));
    await t.tap(find.text('تأكيد الحجز'));
    await t.pumpAndSettle();
    final sel = api.lastSelection!;
    expect((sel['items'] as List).map((e) => (e as Map)['productId']), ['svc-ext']);   // أجرة الخارجي بلا زيت
    expect(sel['customerNote'], 'زيت من العميل (خارجي) — الأجرة فقط: تغيير زيت ماكينة + تغيير زيت جير');
    expect(find.text('تذكرتي'), findsOneWidget);
    await t.pumpWidget(const SizedBox());
  });

  testWidgets('أكثر من فلتر زيت للسيارة: يختار العميل بينها والنافد معطّل', (t) async {
    final (_, api) = await boot(t, seed: {'branch': branch, 'otp': 'old', 'phone': '0500000000'});
    await t.tap(find.text('حجز جديد'));
    await t.pumpAndSettle();
    await t.tap(find.text('التالي: اختيار الخدمة'));
    await t.pumpAndSettle();
    await t.tap(find.text('تغيير زيت ماكينة'));
    await t.pumpAndSettle();
    await t.tap(find.text('زيت خارجي (أحضره بنفسي)'));
    await t.pumpAndSettle();
    await t.scrollUntilVisible(find.text('مع تغيير فلتر الزيت'), 200, scrollable: find.byType(Scrollable).first);
    await t.ensureVisible(find.text('مع تغيير فلتر الزيت'));
    await t.pumpAndSettle();
    await t.tap(find.text('مع تغيير فلتر الزيت'));
    await t.pumpAndSettle();
    await t.scrollUntilVisible(find.text('فلتر كامري وكالة'), 200, scrollable: find.byType(Scrollable).first);
    expect(find.text('فلتر كامري بديل e2'), findsOneWidget);          // الخيارات الثلاثة ظاهرة
    expect(find.text('فلتر كامري وكالة'), findsOneWidget);
    expect(find.text('غير متوفر الآن'), findsOneWidget);              // الوكالة نافدة
    await t.tap(find.text('فلتر كامري وكالة'));                         // النافد لا يُختار
    await t.pumpAndSettle();
    await t.tap(find.text('فلتر كامري بديل e2'));
    await t.pumpAndSettle();
    await t.tap(find.text('تأكيد الحجز'));
    await t.pumpAndSettle();
    final items = (api.lastSelection!['items'] as List).cast<Map<String, dynamic>>();
    expect(items.map((e) => e['productId']), ['svc-ext', 'f2']);       // أجرة الخارجي + الفلتر المختار (لا الافتراضي f1)
    expect(find.text('تذكرتي'), findsOneWidget);
    await t.pumpWidget(const SizedBox());
  });

  /// يفتح قائمة منسدلة بنص الحقل الظاهر ثم يختار منها (الكتابة في الماركة/الموديل ممنوعة)
  Future<void> pick(WidgetTester t, String hint, String option) async {
    await t.ensureVisible(find.text(hint));
    await t.pumpAndSettle();
    await t.tap(find.text(hint));
    await t.pumpAndSettle();
    final opt = find.descendant(of: find.byType(ListTile), matching: find.text(option));
    if (opt.evaluate().isEmpty) await t.scrollUntilVisible(opt, 300, scrollable: find.byType(Scrollable).last);
    await t.tap(opt.first);
    await t.pumpAndSettle();
  }

  Future<FakeApi> toServicesWithNewCar(WidgetTester t, String brandName) async {
    final (_, api) = await boot(t, otp: false, seed: {'branch': branch});
    await t.tap(find.text('حجز جديد'));
    await t.pumpAndSettle();
    await t.binding.setSurfaceSize(const Size(420, 1800));   // يُبنى النموذج كاملاً فلا تتغيّر فهارس الحقول بالتمرير
    await t.pumpAndSettle();
    final fields = find.byType(TextField);
    await t.enterText(fields.at(0), 'سالم');
    await t.enterText(fields.at(1), '0555555555');
    await t.enterText(fields.at(2), '1234');
    await pick(t, 'اختر الماركة (مثل تويوتا)', brandName);
    await pick(t, 'اختر الموديل (مثل كامري)', 'كامري');
    await t.ensureVisible(find.text('اختر السنة'));
    await t.pumpAndSettle();
    await t.tap(find.text('اختر السنة'));
    await t.pumpAndSettle();
    await t.scrollUntilVisible(find.text('2020'), 300, scrollable: find.byType(Scrollable).last);
    await t.tap(find.text('2020'));
    await t.pumpAndSettle();
    await t.scrollUntilVisible(find.text('التالي: اختيار الخدمة'), 200, scrollable: find.byType(Scrollable).first);
    await t.tap(find.text('التالي: اختيار الخدمة'));
    await t.pumpAndSettle();
    return api;
  }

  testWidgets('محرك مجهول والموديل له محركان: يسأل العميل ولا يعرض فلتر محرك لم يخترْه', (t) async {
    final api = await toServicesWithNewCar(t, 'هيونداي');
    await t.tap(find.text('تغيير زيت ماكينة'));
    await t.pumpAndSettle();
    expect(find.text('لسيارتك أكثر من محرك — ما هو محرك سيارتك؟'), findsOneWidget);
    expect(find.text('مع تغيير فلتر الزيت'), findsNothing);              // لا فلتر قبل اختيار المحرك
    expect(api.filterCalls, ['']);
    await t.scrollUntilVisible(find.text('4 سلندر'), 200, scrollable: find.byType(Scrollable).first);
    await t.pumpAndSettle();
    await t.tap(find.text('4 سلندر'));
    await t.pumpAndSettle();
    expect(api.filterCalls, ['', '4']);                                 // أُعيد الاستعلام بالمحرك المختار
    expect(find.text('لسيارتك أكثر من محرك — ما هو محرك سيارتك؟'), findsOneWidget);
    expect(find.text('مع تغيير فلتر الزيت'), findsOneWidget);
    expect(find.textContaining('فلتر هيونداي 4 سلندر'), findsOneWidget);   // فلتر المحرك المختار فقط
    expect(find.textContaining('6 سلندر'), findsOneWidget);               // خيار 6 سلندر ما زال متاحاً للتغيير
    await t.pumpWidget(const SizedBox());
  });

  testWidgets('عدد السلندرات المحدد عند التسجيل يُرسل ويحصر الفلتر في محركه فقط', (t) async {
    final (_, api) = await boot(t, otp: false, seed: {'branch': branch});
    await t.tap(find.text('حجز جديد'));
    await t.pumpAndSettle();
    await t.binding.setSurfaceSize(const Size(420, 1800));   // يُبنى النموذج كاملاً فلا تتغيّر فهارس الحقول بالتمرير
    await t.pumpAndSettle();
    final fields = find.byType(TextField);
    await t.enterText(fields.at(0), 'سالم');
    await t.enterText(fields.at(1), '0555555555');
    await t.enterText(fields.at(2), '1234');
    await pick(t, 'اختر الماركة (مثل تويوتا)', 'هيونداي');
    await pick(t, 'اختر الموديل (مثل كامري)', 'كامري');
    await t.ensureVisible(find.text('اختر السنة'));
    await t.pumpAndSettle();
    await t.tap(find.text('اختر السنة'));
    await t.pumpAndSettle();
    await t.scrollUntilVisible(find.text('2020'), 300, scrollable: find.byType(Scrollable).last);
    await t.tap(find.text('2020'));
    await t.pumpAndSettle();
    await pick(t, 'اختر العدد', '4');
    await t.scrollUntilVisible(find.text('التالي: اختيار الخدمة'), 200, scrollable: find.byType(Scrollable).first);
    await t.tap(find.text('التالي: اختيار الخدمة'));
    await t.pumpAndSettle();
    await t.tap(find.text('تغيير زيت ماكينة'));
    await t.pumpAndSettle();
    expect(api.filterCalls, ['4']);                                       // الاستعلام بالمحرك المحدد
    expect(find.text('لسيارتك أكثر من محرك — ما هو محرك سيارتك؟'), findsNothing);   // لا يُسأل
    await t.scrollUntilVisible(find.text('مع تغيير فلتر الزيت'), 200, scrollable: find.byType(Scrollable).first);
    expect(find.textContaining('فلتر هيونداي 4 سلندر'), findsOneWidget);   // فلتر الـ4 سلندر فقط
    expect(find.textContaining('6 سلندر'), findsNothing);
    await t.tap(find.text('احجز دون تحديد الزيت (يحدده الفني)'));
    await t.pumpAndSettle();
    expect((api.bookings.single['car'] as Map)['cylinders'], '4');          // يُحفظ مع السيارة
    await t.pumpWidget(const SizedBox());
  });

  testWidgets('الماركة والموديل من قوائم منسدلة فقط (لا كتابة)، والسنة وحجم الماكينة من قوائم، ويُرسل الحجم للمطابقة', (t) async {
    final (_, api) = await boot(t, otp: false, seed: {'branch': branch});
    await t.tap(find.text('حجز جديد'));
    await t.pumpAndSettle();
    await t.binding.setSurfaceSize(const Size(420, 1800));
    await t.pumpAndSettle();
    final fields = find.byType(TextField);
    await t.enterText(fields.at(0), 'سالم');
    await t.enterText(fields.at(1), '0555555555');
    await t.enterText(fields.at(2), '1234');
    expect(fields, findsNWidgets(5));                                     // اسم، جوال، أرقام، حروف، عداد — لا حقل ماركة/موديل
    await pick(t, 'اختر الماركة (مثل تويوتا)', 'هيونداي');
    expect(find.text('هيونداي'), findsOneWidget);
    await pick(t, 'اختر الموديل (مثل كامري)', 'كامري');
    await t.tap(find.text('اختر السنة'));
    await t.pumpAndSettle();
    await t.scrollUntilVisible(find.text('2020'), 300, scrollable: find.byType(Scrollable).last);
    await t.tap(find.text('2020'));
    await t.pumpAndSettle();
    expect(find.text('2020'), findsOneWidget);                            // السنة ظهرت في الحقل
    await t.scrollUntilVisible(find.text('اختر حجم الماكينة'), 200, scrollable: find.byType(Scrollable).first);
    await t.tap(find.text('اختر حجم الماكينة'));
    await t.pumpAndSettle();
    await t.scrollUntilVisible(find.text('2.5'), 300, scrollable: find.byType(Scrollable).last);
    await t.tap(find.text('2.5'));
    await t.pumpAndSettle();
    await pick(t, 'اختر العدد', '4');
    await t.scrollUntilVisible(find.text('التالي: اختيار الخدمة'), 200, scrollable: find.byType(Scrollable).first);
    await t.tap(find.text('التالي: اختيار الخدمة'));
    await t.pumpAndSettle();
    await t.tap(find.text('تغيير زيت ماكينة'));
    await t.pumpAndSettle();
    expect(api.filterEngines, ['2.5']);                                   // حجم الماكينة وصل للمطابقة
    await t.tap(find.text('احجز دون تحديد الزيت (يحدده الفني)'));
    await t.pumpAndSettle();
    final car = api.bookings.single['car'] as Map;
    expect([car['modelYear'], car['engineSize'], car['cylinders'], car['brand']], ['2020', '2.5', '4', 'هيونداي']);
    await t.pumpWidget(const SizedBox());
  });

  testWidgets('أول تشغيل: اختيار اللغة (5 لغات) ثم تتحول الواجهة للإنجليزية بالاتجاه من اليسار', (t) async {
    final api = FakeApi();
    final state = AppState(api: api, store: MemoryStore(), location: FakeLocation(fresh: riyadh));
    await t.binding.setSurfaceSize(const Size(420, 900));
    await t.pumpWidget(CustomerApp(state: state, showSplash: false));
    await state.init();
    await t.pumpAndSettle();
    for (final n in ['العربية', 'English', 'বাংলা', 'हिन्दी', 'اردو']) {
      expect(find.text(n), findsOneWidget);
    }
    await t.tap(find.byKey(const ValueKey('lang-en')));
    await t.pumpAndSettle();
    expect(find.text('Choose the branch'), findsOneWidget);               // شاشة الفروع بالإنجليزية
    expect(find.text('Nearest to you'), findsOneWidget);
    expect(Directionality.of(t.element(find.text('Choose the branch'))), TextDirection.ltr);
    expect(L.current, AppLang.en);
    expect(await state.store.read('lang'), 'en');                         // تُحفظ للمرات القادمة
    await t.pumpWidget(const SizedBox());
    L.current = AppLang.ar;
  });

  testWidgets('تغيير اللغة من داخل التطبيق: أردو (من اليمين) ثم هندي', (t) async {
    final (state, _) = await boot(t, seed: {'branch': branch});
    await t.tap(find.byType(PopupMenuButton<String>));
    await t.pumpAndSettle();
    await t.tap(find.text('اللغة'));
    await t.pumpAndSettle();
    await t.tap(find.byKey(const ValueKey('lang-hi')));
    await t.pumpAndSettle();
    expect(find.text('नई बुकिंग'), findsOneWidget);          // الرئيسية بالهندية
    expect(Directionality.of(t.element(find.text('नई बुकिंग'))), TextDirection.ltr);
    await t.tap(find.byType(PopupMenuButton<String>));
    await t.pumpAndSettle();
    await t.tap(find.text('भाषा'));
    await t.pumpAndSettle();
    await t.tap(find.byKey(const ValueKey('lang-ur')));
    await t.pumpAndSettle();
    expect(find.text('نئی بکنگ'), findsOneWidget);          // أردو
    expect(Directionality.of(t.element(find.text('نئی بکنگ'))), TextDirection.rtl);
    expect(state.lang, AppLang.ur);
    await t.pumpWidget(const SizedBox());
    L.current = AppLang.ar;
  });

  testWidgets('شاشة الافتتاح: الشعار بالحركة ثم اللمس يتخطاها إلى التطبيق', (t) async {
    final state = AppState(api: FakeApi(), store: MemoryStore()..m['lang'] = 'ar'..m['branch'] = branch, location: FakeLocation(fresh: riyadh));
    await t.binding.setSurfaceSize(const Size(420, 900));
    await t.pumpWidget(CustomerApp(state: state));                         // splash مفعّل
    await state.init();
    await t.pump(const Duration(milliseconds: 300));
    expect(find.byType(SnakeLogo), findsOneWidget);
    expect(find.text('حجز جديد'), findsNothing);
    await t.tapAt(const Offset(200, 450));                                // تخطّي باللمس
    await t.pumpAndSettle();
    expect(find.text('حجز جديد'), findsOneWidget);
    await t.pumpWidget(const SizedBox());
  });

  testWidgets('«لا أعرف» المحرك: لا فلتر، ورسالة أن الفني يحدده', (t) async {
    await toServicesWithNewCar(t, 'هيونداي');
    await t.tap(find.text('تغيير زيت ماكينة'));
    await t.pumpAndSettle();
    await t.ensureVisible(find.text('لا أعرف'));
    await t.pumpAndSettle();
    await t.tap(find.text('لا أعرف'));
    await t.pumpAndSettle();
    expect(find.text('سيحدد الفني فلتر الزيت المناسب لمحرك سيارتك عند الفحص.'), findsOneWidget);
    expect(find.text('مع تغيير فلتر الزيت'), findsNothing);
    expect(find.text('لسيارتك أكثر من محرك — ما هو محرك سيارتك؟'), findsNothing);
    await t.pumpWidget(const SizedBox());
  });

  testWidgets('سيارة جديدة: نوع الوقود ثلاثة فقط (ديزل/بنزين/هايبرد)', (t) async {
    await boot(t, otp: false, seed: {'branch': branch});
    await t.tap(find.text('حجز جديد'));
    await t.pumpAndSettle();
    await t.ensureVisible(find.text('اختر نوع الوقود'));
    await t.tap(find.text('اختر نوع الوقود'));
    await t.pumpAndSettle();
    final opts = find.descendant(of: find.byType(ListTile), matching: find.byType(Text));
    expect([for (final w in opts.evaluate()) (w.widget as Text).data], ['ديزل', 'بنزين', 'هايبرد']);
    await t.pumpWidget(const SizedBox());
  });

  testWidgets('صفحة السيارة: من تبويب السيارات تُفتح السيارة وفيها فواتيرها فقط، وتبويب فواتيري يعرض الكل', (t) async {
    final (_, api) = await boot(t, seed: {'branch': branch, 'otp': 'old', 'phone': '0500000000'});
    await t.tap(find.text('سيارة جديدة'));                           // تبويب السيارات
    await t.pumpAndSettle();
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
    await t.tap(find.text('فواتيري'));                              // تبويب كل الفواتير
    await t.pumpAndSettle();
    expect(api.invoiceCalls.last, isNull);
    expect(find.text('فاتورة B-200'), findsOneWidget);
    expect(find.text('فاتورة A-100'), findsOneWidget);
    await t.pumpWidget(const SizedBox());
  });

  testWidgets('شريط التبويبات: الرئيسية، فواتيري، سيارة جديدة، الحجوزات، المحادثات', (t) async {
    await boot(t, seed: {'branch': branch, 'otp': 'old', 'phone': '0500000000'});
    expect(find.byType(NavigationBar), findsOneWidget);
    for (final x in ['الرئيسية', 'فواتيري', 'سيارة جديدة', 'الحجوزات', 'المحادثات']) {
      expect(find.descendant(of: find.byType(NavigationBar), matching: find.text(x)), findsOneWidget, reason: x);
    }
    expect(find.byIcon(Icons.notifications_none), findsOneWidget);     // جرس الإشعارات في هيدر الرئيسية
    await t.pumpWidget(const SizedBox());
  });

  testWidgets('الرئيسية: إعلانات + تتبع الحجز الجاري (وبدونه دعوة للحجز)', (t) async {
    final seed = {'branch': branch, 'otp': 'old', 'phone': '0500000000'};
    await boot(t, seed: seed);
    expect(find.text('خصم 20% على تغيير الزيت'), findsOneWidget);       // إعلان
    expect(find.text('لا توجد حجوزات جارية الآن'), findsOneWidget);
    await t.pumpWidget(const SizedBox());
    final api = FakeApi()..seedActive = true;
    final state = AppState(api: api, store: MemoryStore()..m.addAll({'lang': 'ar', ...seed}), location: FakeLocation(fresh: riyadh));
    await t.binding.setSurfaceSize(const Size(420, 900));
    await t.pumpWidget(CustomerApp(state: state, showSplash: false));
    await state.init();
    await t.pumpAndSettle();
    expect(find.text('بانتظار دورك'), findsOneWidget);                  // كارت التتبع
    expect(find.text('لا توجد حجوزات جارية الآن'), findsNothing);
    await t.pumpWidget(const SizedBox());
  });

  testWidgets('تبويب الحجوزات: الجارية والسابقة وإلغاء الدور المنتظر', (t) async {
    final api = FakeApi()..seedActive = true;
    final state = AppState(api: api, store: MemoryStore()..m.addAll({'lang': 'ar', 'branch': branch, 'otp': 'old', 'phone': '0500000000'}), location: FakeLocation(fresh: riyadh));
    await t.binding.setSurfaceSize(const Size(420, 1200));
    await t.pumpWidget(CustomerApp(state: state, showSplash: false));
    await state.init();
    await t.pumpAndSettle();
    await t.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text('الحجوزات')));
    await t.pumpAndSettle();
    expect(find.text('حجوزات جارية'), findsOneWidget);
    expect(find.text('حجوزات سابقة'), findsOneWidget);
    expect(find.text('مكتمل'), findsOneWidget);
    await t.tap(find.text('إلغاء'));
    await t.pumpAndSettle();
    await t.tap(find.text('إلغاء الحجز').last);                          // تأكيد في الحوار
    await t.pumpAndSettle();
    expect(api.cancelCalls, ['bk-1']);
    expect(find.text('ملغي'), findsOneWidget);                           // انتقل للسابقة
    await t.pumpWidget(const SizedBox());
  });

  testWidgets('تغيير الفرع: قائمة الفروع تظهر فوراً بلا تحديث يدوي', (t) async {
    final (state, _) = await boot(t, seed: {'branch': branch, 'otp': 'old', 'phone': '0500000000'});
    expect(state.branches, isEmpty);                                   // لم تُحمَّل في بدء التشغيل لأن الفرع محفوظ
    await t.tap(find.byType(PopupMenuButton<String>));
    await t.pumpAndSettle();
    await t.tap(find.text('تغيير الفرع'));
    await t.pumpAndSettle();
    expect(find.text('معرض التجزئة'), findsOneWidget);                  // ظهرت دون سحب للتحديث
    expect(find.text('فرع الشرق'), findsOneWidget);
    await t.pumpWidget(const SizedBox());
  });

  testWidgets('الجرس: شارة غير المقروء، والضغط على رسالة الفرع يفتح المحادثة مباشرة', (t) async {
    final (state, api) = await boot(t, seed: {'branch': branch, 'otp': 'old', 'phone': '0500000000'});
    expect(state.unreadNotices, 2);
    expect(find.text('2'), findsWidgets);                            // شارة الجرس
    await t.tap(find.byIcon(Icons.notifications_none));
    await t.pumpAndSettle();
    expect(find.text('رسالة جديدة من الفرع'), findsOneWidget);
    expect(find.text('سيارتك جاهزة'), findsOneWidget);
    expect(find.text('تم تسجيل سيارتك'), findsOneWidget);
    await t.tap(find.text('رسالة جديدة من الفرع'));
    await t.pumpAndSettle();
    expect(find.text('محادثة الفرع'), findsOneWidget);               // دخل المحادثة مباشرة
    expect(find.text('أهلاً، سيارتك في الدور'), findsOneWidget);
    expect(api.readCalls.single, ['n1']);
    expect(state.unreadNotices, 1);
    await t.pumpWidget(const SizedBox());
  });

  testWidgets('المحادثات: قائمة بين العميل والفرع، والضغط يفتح المحادثة', (t) async {
    final (state, _) = await boot(t, seed: {'branch': branch, 'otp': 'old', 'phone': '0500000000'});
    expect(state.unreadChats, 1);
    await t.tap(find.text('المحادثات'));
    await t.pumpAndSettle();
    expect(find.text('أهلاً، سيارتك في الدور'), findsOneWidget);
    expect(find.textContaining('فرع الخليج'), findsWidgets);
    await t.tap(find.text('أهلاً، سيارتك في الدور'));
    await t.pumpAndSettle();
    expect(find.text('محادثة الفرع'), findsOneWidget);
    await t.pumpWidget(const SizedBox());
  });

  testWidgets('تسجيل سيارة جديدة: يحفظها في سياراتي بدون اختيار خدمة أو حجز', (t) async {
    final (_, api) = await boot(t, seed: {'branch': branch, 'otp': 'old', 'phone': '0500000000'});
    await t.tap(find.text('سيارة جديدة'));
    await t.pumpAndSettle();
    await t.tap(find.text('تسجيل سيارة جديدة'));
    await t.pumpAndSettle();
    expect(find.text('سياراتي'), findsNothing);                      // لا قائمة سيارات محفوظة هنا
    await t.scrollUntilVisible(find.text('حفظ السيارة'), 300, scrollable: find.byType(Scrollable).first);
    await t.tap(find.text('حفظ السيارة'));
    await t.pumpAndSettle();
    expect(find.text('أدخل رقم جوال صحيح'), findsNothing);           // الاسم/الجوال معبّآن مسبقاً
    expect(find.text('أدخل أرقام اللوحة'), findsOneWidget);          // ينقصه اللوحة
    expect(api.registered, isEmpty);
    await t.pumpWidget(const SizedBox());
  });

  testWidgets('AppState.registerCar يرسل البيانات ويحدّث الملف والإشعارات', (t) async {
    final (state, api) = await boot(t, seed: {'branch': branch, 'otp': 'old', 'phone': '0500000000'});
    final e = await state.registerCar(name: 'أحمد', phoneNo: '0500000000', car: {'plateNumbers': '7777', 'plateLetters': 'KSA', 'brand': 'تويوتا', 'carName': 'كامري'});
    expect(e, isNull);
    expect(api.registered.single['car']['plateNumbers'], '7777');
    await t.pumpWidget(const SizedBox());
  });

  test('لوجو الماركة: أسماء عربية وإنجليزية وإملائيات مختلفة تصل لنفس الملف، والمجهول بلا لوجو', () {
    expect(carBrandAsset('تويوتا'), 'assets/car_brands/toyota.png');
    expect(carBrandAsset('Toyota'), 'assets/car_brands/toyota.png');
    expect(carBrandAsset('شيفروليه'), 'assets/car_brands/chevrolet.png');
    expect(carBrandAsset('مرسيدس'), 'assets/car_brands/mercedes-benz.png');
    expect(carBrandAsset('ماركة غريبة'), isNull);
  });

  testWidgets('سياراتي: كارت لكل سيارة بالاسم واللوحة وآخر ممشى وباقي البيانات، وفي الحجز تُختار من الكروت', (t) async {
    await boot(t, seed: {'branch': branch, 'otp': 'old', 'phone': '0500000000'});
    await t.tap(find.text('سيارة جديدة'));
    await t.pumpAndSettle();
    for (final x in ['تويوتا كامري', '1234 ABC', 'موديل 2020', 'بنزين', '4 سلندر', '2.5 L', 'أبيض', 'آخر قراءة عداد: 80000 كم']) {
      expect(find.text(x), findsOneWidget, reason: x);
    }
    expect(find.byType(CarBrandLogo), findsOneWidget);
    await t.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text('الرئيسية')));
    await t.pumpAndSettle();
    await t.tap(find.text('حجز جديد'));
    await t.pumpAndSettle();
    expect(find.text('1234 ABC'), findsOneWidget);                   // سيارته ظاهرة للاختيار
    expect(find.text('آخر قراءة عداد: 80000 كم'), findsOneWidget);
    await t.tap(find.text('التالي: اختيار الخدمة'));
    await t.pumpAndSettle();
    expect(find.text('اختر الخدمة'), findsOneWidget);
    await t.pumpWidget(const SizedBox());
  });

  group('الحجز لا يتم إلا أمام الفرع', () {
    final seed = {'branch': branch, 'otp': 'old', 'phone': '0500000000'};

    testWidgets('قريب: يمر بلا تعطيل ويصل توكن الموقع مع الحجز', (t) async {
      final (_, api) = await boot(t, seed: seed, geofence: true, near: 40);
      await t.tap(find.text('حجز جديد'));
      await t.pumpAndSettle();
      expect(find.text('التالي: اختيار الخدمة'), findsOneWidget);       // عبر بوابة القرب إلى نموذج الحجز
      await t.tap(find.text('التالي: اختيار الخدمة'));
      await t.pumpAndSettle();
      await t.tap(find.text('تغيير زيت ماكينة'));
      await t.pumpAndSettle();
      await t.tap(find.text('احجز دون تحديد الزيت (يحدده الفني)'));
      await t.pumpAndSettle();
      expect(api.lastGeoToken, startsWith('geo-'));                       // التوكن أُرفق
      expect(api.geoCalls, 2);                                            // عند الدخول وعند الإرسال
      await t.pumpWidget(const SizedBox());
    });

    testWidgets('بعيد: يُمنع الحجز مع المسافة وإعادة المحاولة', (t) async {
      final (_, api) = await boot(t, seed: seed, geofence: true, near: 420);
      await t.tap(find.text('حجز جديد'));
      await t.pumpAndSettle();
      expect(find.text('أنت بعيد عن الفرع — اقترب لتتمكن من الحجز'), findsOneWidget);
      expect(find.text('أنت على بعد 420 م من الفرع'), findsOneWidget);
      expect(find.text('التالي: اختيار الخدمة'), findsNothing);
      api.nearMeters = 25;                                                // اقترب
      await t.tap(find.text('إعادة المحاولة'));
      await t.pumpAndSettle();
      expect(find.text('التالي: اختيار الخدمة'), findsOneWidget);
      await t.pumpWidget(const SizedBox());
    });

    testWidgets('الموقع (GPS) مغلق: يطلب التفعيل ويفتح الإعدادات', (t) async {
      final loc = FakeLocation(fresh: riyadh, status: GeoStatus.serviceOff);
      final (_, _) = await boot(t, seed: seed, geofence: true, loc: loc);
      await t.tap(find.text('حجز جديد'));
      await t.pumpAndSettle();
      expect(find.text('خدمة الموقع (GPS) مغلقة — فعّلها لتتمكن من الحجز'), findsOneWidget);
      await t.tap(find.text('فتح إعدادات الموقع'));
      expect(loc.settingsOpened, [GeoStatus.serviceOff]);
      await t.pumpWidget(const SizedBox());
    });

    testWidgets('موقع وهمي مرفوض', (t) async {
      final loc = FakeLocation(fresh: riyadh, mocked: true);
      await boot(t, seed: seed, geofence: true, loc: loc);
      await t.tap(find.text('حجز جديد'));
      await t.pumpAndSettle();
      expect(find.textContaining('موقع وهمي'), findsOneWidget);
      await t.pumpWidget(const SizedBox());
    });

    testWidgets('الفحص غير مفعّل للفرع: لا يُطلب الموقع أصلاً', (t) async {
      final (_, api) = await boot(t, seed: seed, near: 9000);
      await t.tap(find.text('حجز جديد'));
      await t.pumpAndSettle();
      expect(find.text('التالي: اختيار الخدمة'), findsOneWidget);
      expect(api.geoCalls, 0);
      await t.pumpWidget(const SizedBox());
    });
  });
}
