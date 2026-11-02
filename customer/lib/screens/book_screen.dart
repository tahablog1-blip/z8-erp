import 'package:flutter/material.dart';
import '../core/api.dart';
import '../core/car_brands.dart';
import '../core/i18n.dart';
import '../core/theme.dart';
import '../core/widgets.dart';
import '../models.dart';
import '../state/app_state.dart';
import 'cars_screen.dart';
import 'services_screen.dart';

/// حجز جديد: سيارة محفوظة بضغطة، أو سيارة جديدة بنموذج مختصر. يرجع true عند إنشاء الحجز.
class BookScreen extends StatefulWidget {
  const BookScreen({super.key, required this.state, this.registerOnly = false});
  final AppState state;
  final bool registerOnly;     // تسجيل سيارة جديدة في «سياراتي» بدون حجز دور
  @override
  State<BookScreen> createState() => _BookScreenState();
}

const fuelTypes = ['ديزل', 'بنزين', 'هايبرد'];   // قيم تُرسل للخادم بالعربية؛ العرض مترجم
const cylinderOptions = ['3', '4', '5', '6', '8', '10', '12'];
const engineSizes = ['1.0', '1.2', '1.3', '1.4', '1.5', '1.6', '1.8', '2.0', '2.2', '2.4', '2.5', '2.7', '3.0', '3.3', '3.5', '3.6', '4.0', '4.6', '5.0', '5.3', '5.7', '6.2'];

List<String> yearOptions() {
  final now = DateTime.now().year;
  return [for (var y = now + 1; y >= 1990; y--) '$y'];
}

class _BookScreenState extends State<BookScreen> {
  final name = TextEditingController(), phone = TextEditingController(), letters = TextEditingController(), numbers = TextEditingController(),
      brand = TextEditingController(), model = TextEditingController(), odo = TextEditingController();
  String fuel = '', cyl = '', yr = '', eng = '';
  List<String> brands = const [], models = const [];
  SavedCar? picked;
  bool newCar = false;
  String? err;

  AppState get s => widget.state;

  @override
  void initState() {
    super.initState();
    name.text = s.profile.name;
    phone.text = s.phone;
    newCar = s.profile.cars.isEmpty || widget.registerOnly;
    if (s.profile.cars.isNotEmpty) picked = s.profile.cars.first;
    s.api.brands(s.branchId!).then((b) { if (mounted) setState(() => brands = b); }).catchError((_) {});
  }

  Future<void> _loadModels(String b) async {
    try {
      final m = await s.api.models(s.branchId!, b);
      if (mounted) setState(() => models = m);
    } on ApiException {
      if (mounted) setState(() => models = const []);
    }
  }

  /// التالي: نتحقق من بيانات السيارة ثم ننتقل لاختيار الخدمات
  Future<void> _next() async {
    setState(() => err = null);
    final nav = Navigator.of(context);
    if (widget.registerOnly) return _register();
    ServicesScreen screen;
    if (!newCar && picked != null) {
      final c = picked!;
      final odometer = arabicDigitsToLatin(odo.text.trim()).isEmpty ? null : arabicDigitsToLatin(odo.text.trim());
      screen = ServicesScreen(
        state: s, carTitle: '${c.title.isEmpty ? 'سيارة' : c.title} · ${c.plate}', brand: c.brand, model: c.name, year: c.year,
        cylinders: c.cylinders, engineSize: c.engineSize,
        submit: (selection, _) => s.bookSaved(c, odometer: odometer, selection: selection),
      );
    } else {
      final n = arabicDigitsToLatin(numbers.text.trim());
      if (name.text.trim().length < 2) return setState(() => err = tr('اكتب اسمك'));
      if (arabicDigitsToLatin(phone.text).replaceAll(RegExp(r'[^0-9]'), '').length < 9) return setState(() => err = tr('أدخل رقم جوال صحيح'));
      if (n.isEmpty) return setState(() => err = tr('أدخل أرقام اللوحة'));
      final car = {
        'plateLetters': letters.text.trim(), 'plateNumbers': n,
        'brand': brand.text.trim().isEmpty ? null : brand.text.trim(),
        'carName': model.text.trim().isEmpty ? null : model.text.trim(),
        'modelYear': yr.isEmpty ? null : yr,
        'odometer': arabicDigitsToLatin(odo.text.trim()),
        'fuelType': fuel.isEmpty ? null : fuel,
        'cylinders': cyl.isEmpty ? null : cyl,
        'engineSize': eng.isEmpty ? null : eng,
      };
      screen = ServicesScreen(
        state: s, carTitle: '${[brand.text.trim(), model.text.trim()].where((e) => e.isNotEmpty).join(' ')} · $n ${letters.text.trim()}'.trim(),
        brand: brand.text.trim(), model: model.text.trim(), year: yr, cylinders: cyl, engineSize: eng,
        submit: (selection, _) => s.bookNew(name: name.text.trim(), phoneNo: arabicDigitsToLatin(phone.text).trim(), car: car, selection: selection),
      );
    }
    final ok = await nav.push<bool>(MaterialPageRoute(builder: (_) => screen));
    if (ok == true && mounted) nav.pop(true);
  }

  /// تسجيل السيارة فقط: يحفظها في سياراتي ويرجع بدون اختيار خدمة
  Future<void> _register() async {
    final n = arabicDigitsToLatin(numbers.text.trim());
    if (name.text.trim().length < 2) return setState(() => err = tr('اكتب اسمك'));
    if (arabicDigitsToLatin(phone.text).replaceAll(RegExp(r'[^0-9]'), '').length < 9) return setState(() => err = tr('أدخل رقم جوال صحيح'));
    if (n.isEmpty || letters.text.trim().length != 3) return setState(() => err = tr('أدخل أرقام اللوحة'));
    if (brand.text.trim().isEmpty || model.text.trim().isEmpty || yr.isEmpty || fuel.isEmpty) return setState(() => err = tr('أكمل بيانات السيارة: الماركة والموديل والسنة ونوع الوقود'));
    final nav = Navigator.of(context);
    final e = await s.registerCar(
      name: name.text.trim(), phoneNo: arabicDigitsToLatin(phone.text).trim(),
      car: {
        'plateLetters': letters.text.trim(), 'plateNumbers': n, 'brand': brand.text.trim(), 'carName': model.text.trim(), 'modelYear': yr,
        'odometer': arabicDigitsToLatin(odo.text.trim()).isEmpty ? null : arabicDigitsToLatin(odo.text.trim()),
        'fuelType': fuel, 'cylinders': cyl.isEmpty ? null : cyl, 'engineSize': eng.isEmpty ? null : eng,
      });
    if (!mounted) return;
    if (e != null) return setState(() => err = e);
    nav.pop(true);
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
        listenable: s,
        builder: (context, _) => Scaffold(
          appBar: AppBar(title: Text(widget.registerOnly ? tr('تسجيل سيارة جديدة') : tr('حجز جديد'), style: tx(Fs.lg, w: 900)), backgroundColor: Z8.ink2, surfaceTintColor: Colors.transparent),
          body: SafeArea(
            child: ListView(padding: const EdgeInsets.all(16), children: [
              if (s.profile.cars.isNotEmpty && !widget.registerOnly) ...[
                Text(tr('سياراتي'), style: tx(Fs.md, w: 900, color: Z8.petrolDeep)),
                const SizedBox(height: 8),
                for (final c in s.profile.cars)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: InkWell(
                      onTap: () => setState(() { picked = c; newCar = false; }),
                      child: CarCard(c, selected: !newCar && picked?.id == c.id),
                    ),
                  ),
                InkWell(
                  onTap: () => setState(() => newCar = true),
                  child: Panel(
                    color: newCar ? Z8.petrolSoft : null,
                    child: Row(children: [
                      Icon(newCar ? Icons.radio_button_checked : Icons.add_circle_outline, color: Z8.petrol),
                      const SizedBox(width: 12),
                      Text(tr('سيارة أخرى'), style: tx(Fs.md, w: 800)),
                    ]),
                  ),
                ),
                const SizedBox(height: 16),
              ],
              if (!newCar && picked != null)
                Z8Field(label: tr('قراءة العداد (اختياري)'), controller: odo, keyboard: TextInputType.number, ltr: true, maxLength: 7)
              else ...[
                Z8Field(label: tr('الاسم'), controller: name),
                const SizedBox(height: 12),
                Z8Field(label: tr('رقم الجوال'), controller: phone, keyboard: TextInputType.phone, ltr: true, maxLength: 15),
                const SizedBox(height: 16),
                Text(tr('بيانات السيارة'), style: tx(Fs.md, w: 900, color: Z8.petrolDeep)),
                const SizedBox(height: 8),
                Row(children: [
                  Expanded(child: Z8Field(label: tr('أرقام اللوحة'), controller: numbers, keyboard: TextInputType.number, ltr: true, maxLength: 4)),
                  const SizedBox(width: 12),
                  Expanded(child: Z8Field(label: tr('حروف اللوحة'), controller: letters, maxLength: 4)),
                ]),
                const SizedBox(height: 12),
                Z8Choice(
                  label: tr('الماركة'), value: brand.text, options: brands, hint: tr('اختر الماركة (مثل تويوتا)'),
                  leading: (b) => CarBrandLogo(b, size: 28),
                  onChanged: (v) {
                    setState(() { brand.text = v; model.clear(); models = const []; });
                    if (v.isNotEmpty) _loadModels(v);
                  },
                ),
                const SizedBox(height: 12),
                Z8Choice(
                  label: tr('الموديل'), value: model.text, options: models, enabled: brand.text.trim().isNotEmpty,
                  hint: brand.text.trim().isEmpty ? tr('اختر الماركة أولاً') : tr('اختر الموديل (مثل كامري)'),
                  onChanged: (v) => setState(() => model.text = v),
                ),
                const SizedBox(height: 12),
                Row(children: [
                  Expanded(child: Z8Choice(label: tr('سنة الصنع'), value: yr, options: yearOptions(), hint: tr('اختر السنة'), onChanged: (v) => setState(() => yr = v))),
                  const SizedBox(width: 12),
                  Expanded(child: Z8Field(label: tr('قراءة العداد'), controller: odo, keyboard: TextInputType.number, ltr: true, maxLength: 7)),
                ]),
                const SizedBox(height: 12),
                Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Expanded(child: Z8Choice(
                    label: tr('نوع الوقود'), value: fuel.isEmpty ? '' : tr(fuel), options: [for (final f in fuelTypes) tr(f)], hint: tr('اختر نوع الوقود'),
                    onChanged: (v) => setState(() => fuel = fuelTypes.firstWhere((f) => tr(f) == v, orElse: () => '')),
                  )),
                  const SizedBox(width: 12),
                  Expanded(child: Z8Choice(
                    label: tr('عدد السلندرات'), value: cyl, options: cylinderOptions, hint: tr('اختر العدد'), clearLabel: tr('غير محدد'),
                    onChanged: (v) => setState(() => cyl = v),
                  )),
                ]),
                const SizedBox(height: 12),
                Z8Choice(label: tr('حجم الماكينة (لتر) — اختياري'), value: eng, options: engineSizes, hint: tr('اختر حجم الماكينة'), clearLabel: tr('غير محدد'), onChanged: (v) => setState(() => eng = v)),
              ],
              if (err != null) ...[const SizedBox(height: 16), ErrorBar(err!)],
              const SizedBox(height: 20),
              Z8Button(widget.registerOnly ? tr('حفظ السيارة') : tr('التالي: اختيار الخدمة'), onTap: s.busy ? null : _next),
            ]),
          ),
        ),
      );
}
