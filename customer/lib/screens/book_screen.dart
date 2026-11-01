import 'package:flutter/material.dart';
import '../core/api.dart';
import '../core/theme.dart';
import '../core/widgets.dart';
import '../models.dart';
import '../state/app_state.dart';
import 'services_screen.dart';

/// حجز جديد: سيارة محفوظة بضغطة، أو سيارة جديدة بنموذج مختصر. يرجع true عند إنشاء الحجز.
class BookScreen extends StatefulWidget {
  const BookScreen({super.key, required this.state});
  final AppState state;
  @override
  State<BookScreen> createState() => _BookScreenState();
}

const fuelTypes = ['ديزل', 'بنزين', 'هايبرد'];

class _BookScreenState extends State<BookScreen> {
  final name = TextEditingController(), phone = TextEditingController(), letters = TextEditingController(), numbers = TextEditingController(),
      brand = TextEditingController(), model = TextEditingController(), year = TextEditingController(), odo = TextEditingController();
  String fuel = '';
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
    newCar = s.profile.cars.isEmpty;
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
    ServicesScreen screen;
    if (!newCar && picked != null) {
      final c = picked!;
      final odometer = arabicDigitsToLatin(odo.text.trim()).isEmpty ? null : arabicDigitsToLatin(odo.text.trim());
      screen = ServicesScreen(
        state: s, carTitle: '${c.title.isEmpty ? 'سيارة' : c.title} · ${c.plate}', brand: c.brand, model: c.name, year: c.year,
        submit: (selection, _) => s.bookSaved(c, odometer: odometer, selection: selection),
      );
    } else {
      final n = arabicDigitsToLatin(numbers.text.trim());
      if (name.text.trim().length < 2) return setState(() => err = 'اكتب اسمك');
      if (arabicDigitsToLatin(phone.text).replaceAll(RegExp(r'[^0-9]'), '').length < 9) return setState(() => err = 'أدخل رقم جوال صحيح');
      if (n.isEmpty) return setState(() => err = 'أدخل أرقام اللوحة');
      final car = {
        'plateLetters': letters.text.trim(), 'plateNumbers': n,
        'brand': brand.text.trim().isEmpty ? null : brand.text.trim(),
        'carName': model.text.trim().isEmpty ? null : model.text.trim(),
        'modelYear': year.text.trim().isEmpty ? null : arabicDigitsToLatin(year.text.trim()),
        'odometer': arabicDigitsToLatin(odo.text.trim()),
        'fuelType': fuel.isEmpty ? null : fuel,
      };
      screen = ServicesScreen(
        state: s, carTitle: '${[brand.text.trim(), model.text.trim()].where((e) => e.isNotEmpty).join(' ')} · $n ${letters.text.trim()}'.trim(),
        brand: brand.text.trim(), model: model.text.trim(), year: arabicDigitsToLatin(year.text.trim()),
        submit: (selection, _) => s.bookNew(name: name.text.trim(), phoneNo: arabicDigitsToLatin(phone.text).trim(), car: car, selection: selection),
      );
    }
    final ok = await nav.push<bool>(MaterialPageRoute(builder: (_) => screen));
    if (ok == true && mounted) nav.pop(true);
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
        listenable: s,
        builder: (context, _) => Scaffold(
          appBar: AppBar(title: Text('حجز جديد', style: tx(Fs.lg, w: 900)), backgroundColor: Z8.ink2, surfaceTintColor: Colors.transparent),
          body: SafeArea(
            child: ListView(padding: const EdgeInsets.all(16), children: [
              if (s.profile.cars.isNotEmpty) ...[
                Text('سياراتي', style: tx(Fs.md, w: 900, color: Z8.petrolDeep)),
                const SizedBox(height: 8),
                for (final c in s.profile.cars)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: InkWell(
                      onTap: () => setState(() { picked = c; newCar = false; }),
                      child: Panel(
                        color: !newCar && picked?.id == c.id ? Z8.petrolSoft : null,
                        child: Row(children: [
                          Icon(!newCar && picked?.id == c.id ? Icons.radio_button_checked : Icons.radio_button_off, color: Z8.petrol),
                          const SizedBox(width: 12),
                          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Text(c.title.isEmpty ? 'سيارة' : c.title, style: tx(Fs.md, w: 800)),
                            Text('${c.plate}${c.year.isEmpty ? '' : ' · ${c.year}'}', style: tx(Fs.sm, color: Z8.textDim)),
                          ])),
                        ]),
                      ),
                    ),
                  ),
                InkWell(
                  onTap: () => setState(() => newCar = true),
                  child: Panel(
                    color: newCar ? Z8.petrolSoft : null,
                    child: Row(children: [
                      Icon(newCar ? Icons.radio_button_checked : Icons.add_circle_outline, color: Z8.petrol),
                      const SizedBox(width: 12),
                      Text('سيارة أخرى', style: tx(Fs.md, w: 800)),
                    ]),
                  ),
                ),
                const SizedBox(height: 16),
              ],
              if (!newCar && picked != null)
                Z8Field(label: 'قراءة العداد (اختياري)', controller: odo, keyboard: TextInputType.number, ltr: true, maxLength: 7)
              else ...[
                Z8Field(label: 'الاسم', controller: name),
                const SizedBox(height: 12),
                Z8Field(label: 'رقم الجوال', controller: phone, keyboard: TextInputType.phone, ltr: true, maxLength: 15),
                const SizedBox(height: 16),
                Text('بيانات السيارة', style: tx(Fs.md, w: 900, color: Z8.petrolDeep)),
                const SizedBox(height: 8),
                Row(children: [
                  Expanded(child: Z8Field(label: 'أرقام اللوحة', controller: numbers, keyboard: TextInputType.number, ltr: true, maxLength: 4)),
                  const SizedBox(width: 12),
                  Expanded(child: Z8Field(label: 'حروف اللوحة', controller: letters, maxLength: 4)),
                ]),
                const SizedBox(height: 12),
                _Pick(label: 'الماركة', controller: brand, options: brands, onPick: (v) { brand.text = v; model.clear(); _loadModels(v); }),
                const SizedBox(height: 12),
                _Pick(label: 'الموديل', controller: model, options: models, onPick: (v) => model.text = v),
                const SizedBox(height: 12),
                Row(children: [
                  Expanded(child: Z8Field(label: 'سنة الصنع', controller: year, keyboard: TextInputType.number, ltr: true, maxLength: 4)),
                  const SizedBox(width: 12),
                  Expanded(child: Z8Field(label: 'قراءة العداد', controller: odo, keyboard: TextInputType.number, ltr: true, maxLength: 7)),
                ]),
                const SizedBox(height: 12),
                Text('نوع الوقود', style: tx(Fs.xs, w: 800, color: Z8.petrolDeep)),
                const SizedBox(height: 6),
                Wrap(spacing: 8, runSpacing: 8, children: [
                  for (final f in fuelTypes)
                    ChoiceChip(
                      label: Text(f, style: tx(Fs.sm, w: 700, color: fuel == f ? Colors.white : Z8.text)),
                      selected: fuel == f, selectedColor: Z8.petrol, backgroundColor: Z8.ink2, showCheckmark: false,
                      shape: const RoundedRectangleBorder(side: BorderSide(color: Z8.line)),
                      onSelected: (_) => setState(() => fuel = fuel == f ? '' : f),
                    ),
                ]),
              ],
              if (err != null) ...[const SizedBox(height: 16), ErrorBar(err!)],
              const SizedBox(height: 20),
              Z8Button('التالي: اختيار الخدمة', onTap: _next),
            ]),
          ),
        ),
      );
}

/// حقل نصي مع اقتراحات تظهر في ورقة سفلية
class _Pick extends StatelessWidget {
  const _Pick({required this.label, required this.controller, required this.options, required this.onPick});
  final String label;
  final TextEditingController controller;
  final List<String> options;
  final ValueChanged<String> onPick;
  @override
  Widget build(BuildContext context) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(label, style: tx(Fs.xs, w: 800, color: Z8.petrolDeep)),
        const SizedBox(height: 4),
        TextField(
          controller: controller, style: tx(Fs.md, w: 700),
          decoration: InputDecoration(suffixIcon: options.isEmpty ? null : const Icon(Icons.arrow_drop_down)),
          onTap: options.isEmpty ? null : () async {
            FocusScope.of(context).unfocus();
            final v = await showModalBottomSheet<String>(
              context: context, backgroundColor: Z8.ink2, isScrollControlled: true, shape: const RoundedRectangleBorder(),
              builder: (_) => DraggableScrollableSheet(
                expand: false, initialChildSize: .6, maxChildSize: .9,
                builder: (_, sc) => ListView(controller: sc, children: [
                  for (final o in options) ListTile(title: Text(o, style: tx(Fs.md, w: 700)), onTap: () => Navigator.pop(context, o)),
                ]),
              ),
            );
            if (v != null) onPick(v);
          },
        ),
      ]);
}
