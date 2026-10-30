// lib/screens/sections/car_register_view.dart — تسجيل السيارات في الدور: نفس حقول وقواعد الموقع الإلزامية
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../core/api.dart';
import '../../core/theme.dart';
import '../../core/z8_widgets.dart';
import '../../state/app_state.dart';

class CarRegisterView extends StatefulWidget {
  const CarRegisterView({super.key, required this.app});
  final AppState app;
  @override
  State<CarRegisterView> createState() => _CarRegisterViewState();
}

class _CarRegisterViewState extends State<CarRegisterView> {
  final name = TextEditingController(), phone = TextEditingController(), letters = TextEditingController(), numbers = TextEditingController(),
      brand = TextEditingController(), model = TextEditingController(), year = TextEditingController(), color = TextEditingController(),
      odo = TextEditingController(), chassis = TextEditingController(), notes = TextEditingController();
  String fuel = '';
  String? err;
  bool busy = false, listLoading = true;
  List<Map> cars = [];

  @override
  void initState() { super.initState(); _loadCars(); }

  Future<void> _loadCars() async {
    try { cars = [for (final c in (await widget.app.api.get('/cars', query: {'activeOnly': true}) as List)) c as Map]; } on ApiException catch (_) {}
    if (mounted) setState(() => listLoading = false);
  }

  // نفس validateCreate() بالموقع
  String _validate() {
    if (name.text.trim().isEmpty) return 'اسم العميل إجباري';
    if (!RegExp(r'^05\d{8}$').hasMatch(phone.text.replaceAll(RegExp(r'\D'), ''))) return 'رقم الجوال لازم يبدأ بـ05 ويتكون من 10 أرقام بالظبط';
    if (!RegExp(r'^[A-Z]{3}$').hasMatch(letters.text.trim().toUpperCase())) return 'حروف اللوحة: 3 حروف إنجليزي كابيتال بالظبط';
    if (!RegExp(r'^\d{1,4}$').hasMatch(numbers.text.trim())) return 'أرقام اللوحة: من 1 إلى 4 أرقام';
    if (brand.text.trim().isEmpty) return 'الماركة إجبارية';
    if (model.text.trim().isEmpty) return 'الموديل إجباري';
    if (year.text.trim().isEmpty) return 'سنة الصنع إجبارية';
    if (fuel.isEmpty) return 'نوع السيارة إجباري';
    if (color.text.trim().isEmpty) return 'اللون إجباري';
    if (odo.text.trim().isEmpty) return 'ممشى السيارة الحالي إجباري';
    if (!RegExp(r'^[A-Z0-9]{17}$').hasMatch(chassis.text.trim().toUpperCase().replaceAll(RegExp(r'\s'), ''))) return 'رقم الهيكل لازم يتكون من 17 حرف/رقم بالظبط';
    return '';
  }

  Future<void> _save() async {
    final v = _validate();
    if (v.isNotEmpty) { setState(() => err = v); return; }
    setState(() { busy = true; err = null; });
    try {
      final r = await widget.app.api.post('/cars', body: {
        'branchId': widget.app.user?.branchId ?? widget.app.branch?.id,
        'plateLetters': letters.text.trim().toUpperCase(), 'plateNumbers': numbers.text.replaceAll(RegExp(r'\D'), ''), 'plateType': 'saudi',
        'name': model.text.trim(), 'brand': brand.text.trim(), 'modelYear': year.text.trim(), 'fuelType': fuel, 'color': color.text.trim(),
        'chassisNumber': chassis.text.trim().toUpperCase().replaceAll(RegExp(r'\s'), ''),
        'customerName': name.text.trim(), 'customerPhone': phone.text.replaceAll(RegExp(r'\D'), ''),
        'odometerCurrent': int.tryParse(odo.text.trim()) ?? 0, 'notes': notes.text.trim().isEmpty ? null : notes.text.trim(),
      }) as Map;
      for (final c in [name, phone, letters, numbers, brand, model, year, color, odo, chassis, notes]) { c.clear(); }
      fuel = '';
      if (!mounted) return;
      await showDialog<void>(context: context, builder: (c) => AlertDialog(
        title: Row(children: [const Icon(Icons.check_circle_rounded, color: Z8.emerald), const SizedBox(width: 10), Text('تم تسجيل السيارة', style: tx(Fs.lg, w: 800))]),
        content: Column(mainAxisSize: MainAxisSize.min, children: [Text('${r['plate'] ?? ''}', style: tx(Fs.x2, w: 800, tnum: true)), Text('رقم الدور #${r['queue_no'] ?? ''}', style: tx(Fs.md, color: Z8.textDim))]),
        actions: [Z8Button('تم', onTap: () => Navigator.pop(c))],
      ));
      _loadCars();
    } on ApiException catch (e) { err = e.message; }
    if (mounted) setState(() => busy = false);
  }

  Widget _f(String l, TextEditingController c, {TextInputType? kb, List<TextInputFormatter>? fmt, int? max}) => Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(l, style: tx(Fs.sm, w: 700)), const SizedBox(height: 6),
          TextField(controller: c, keyboardType: kb, inputFormatters: fmt, maxLength: max, style: tx(Fs.md, w: 600), decoration: const InputDecoration(filled: true, fillColor: Z8.ink2, counterText: '')),
        ]),
      );

  @override
  Widget build(BuildContext context) {
    final upper = [FilteringTextInputFormatter.allow(RegExp(r'[A-Za-z0-9]')), TextInputFormatter.withFunction((o, n) => n.copyWith(text: n.text.toUpperCase()))];
    return Padding(padding: const EdgeInsets.all(16), child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Expanded(flex: 3, child: Z8Card(padding: const EdgeInsets.all(18), child: SingleChildScrollView(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text('تسجيل سيارة جديدة', style: tx(Fs.lg, w: 800)), const SizedBox(height: 14),
        Row(children: [Expanded(child: _f('اسم العميل *', name)), const SizedBox(width: 12), Expanded(child: _f('الجوال * (05xxxxxxxx)', phone, kb: TextInputType.phone, max: 10, fmt: [FilteringTextInputFormatter.digitsOnly]))]),
        Row(children: [Expanded(child: _f('حروف اللوحة * (3 إنجليزي)', letters, max: 3, fmt: [FilteringTextInputFormatter.allow(RegExp(r'[A-Za-z]')), TextInputFormatter.withFunction((o, n) => n.copyWith(text: n.text.toUpperCase()))])), const SizedBox(width: 12), Expanded(child: _f('أرقام اللوحة * (1–4)', numbers, kb: TextInputType.number, max: 4, fmt: [FilteringTextInputFormatter.digitsOnly]))]),
        Row(children: [Expanded(child: _f('الماركة *', brand)), const SizedBox(width: 12), Expanded(child: _f('الموديل *', model)), const SizedBox(width: 12), Expanded(child: _f('سنة الصنع *', year, kb: TextInputType.number, max: 4))]),
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Expanded(child: Padding(padding: const EdgeInsets.only(bottom: 12), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('نوع السيارة *', style: tx(Fs.sm, w: 700)), const SizedBox(height: 6),
            DropdownButtonFormField<String>(
              initialValue: fuel.isEmpty ? null : fuel, decoration: const InputDecoration(filled: true, fillColor: Z8.ink2), hint: Text('اختر', style: tx(Fs.md, color: Z8.textDim)),
              items: [for (final e in const {'gasoline': 'بنزين', 'diesel': 'ديزل', 'hybrid': 'هايبرد'}.entries) DropdownMenuItem(value: e.key, child: Text(e.value, style: tx(Fs.md)))],
              onChanged: (v) => setState(() => fuel = v ?? ''),
            ),
          ]))),
          const SizedBox(width: 12), Expanded(child: _f('اللون *', color)), const SizedBox(width: 12), Expanded(child: _f('الممشى الحالي *', odo, kb: TextInputType.number, fmt: [FilteringTextInputFormatter.digitsOnly])),
        ]),
        _f('رقم الهيكل * (17 حرف/رقم)', chassis, max: 17, fmt: upper),
        _f('ملاحظات', notes),
        if (err != null) Container(padding: const EdgeInsets.all(10), margin: const EdgeInsets.only(bottom: 10), color: Z8.emberBg, child: Text(err!, style: tx(Fs.sm, w: 700, color: Z8.ember))),
        Z8Button('تسجيل السيارة في الدور', icon: Icons.add_rounded, busy: busy, height: 52, expand: true, onTap: _save),
      ])))),
      const SizedBox(width: 16),
      Expanded(flex: 2, child: Z8Card(padding: EdgeInsets.zero, child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Padding(padding: const EdgeInsets.all(14), child: Row(children: [Expanded(child: Text('الطابور الحالي (${cars.length})', style: tx(Fs.md, w: 800))), IconButton(onPressed: _loadCars, icon: const Icon(Icons.refresh_rounded))])),
        const Divider(height: 1, color: Z8.line),
        Expanded(child: listLoading ? const Center(child: CircularProgressIndicator(color: Z8.petrol)) : cars.isEmpty
            ? Center(child: Text('لا توجد سيارات في الطابور', style: tx(Fs.md, color: Z8.textDim)))
            : ListView.separated(itemCount: cars.length, separatorBuilder: (_, _) => const Divider(height: 1, color: Z8.line), itemBuilder: (c, i) {
                final x = cars[i];
                return ListTile(dense: true, title: Text('${x['plate'] ?? ''}', style: tx(Fs.md, w: 800, tnum: true)), subtitle: Text('${x['brand'] ?? ''} ${x['name'] ?? ''}  ·  ${x['customer_name'] ?? ''}', style: tx(Fs.sm, color: Z8.textDim)), trailing: Text('#${x['queue_no'] ?? ''}', style: tx(Fs.sm, w: 800, tnum: true)));
              })),
      ]))),
    ]));
  }
}
