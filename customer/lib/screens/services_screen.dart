import 'package:flutter/material.dart';
import '../core/api.dart';
import '../core/theme.dart';
import '../core/widgets.dart';
import '../models.dart';
import '../state/app_state.dart';
import '../state/selection.dart';
import 'oil_picker_screen.dart';

typedef SubmitBooking = Future<String?> Function(Map<String, dynamic>? selection, String? odometer);

/// اختيار الخدمات (يمكن الجمع بين أكثر من خدمة) والزيت والكمية لكل خدمة، ثم تأكيد الحجز.
class ServicesScreen extends StatefulWidget {
  const ServicesScreen({super.key, required this.state, required this.carTitle, required this.brand, required this.model, required this.year, required this.submit, this.askOdometer = false});
  final AppState state;
  final String carTitle, brand, model, year;
  final SubmitBooking submit;
  final bool askOdometer;
  @override
  State<ServicesScreen> createState() => _ServicesScreenState();
}

class _ServicesScreenState extends State<ServicesScreen> {
  final sel = BookingSelection();
  final odo = TextEditingController();
  Catalog catalog = Catalog.empty;
  bool loading = true, busy = false;
  String? err;

  AppState get s => widget.state;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final b = s.branchId!;
    try {
      catalog = Catalog.fromJson(await s.api.catalog(b));
    } on ApiException catch (e) {
      err = e.message;
    }
    // الخدمة التلقائية وفلتر الزيت المطابق اختياريان: غيابهما لا يمنع الحجز
    try {
      final a = await s.api.autoService(b, brand: widget.brand, model: widget.model, year: widget.year);
      if (a != null) sel.autoService = OilProduct.fromJson({...a, 'spec': ''});
    } on ApiException catch (_) {}
    if (widget.brand.isNotEmpty && widget.model.isNotEmpty) {
      try {
        final f = await s.api.filterMatch(b, brand: widget.brand, model: widget.model, year: widget.year);
        if (f != null) sel.filter = OilProduct.fromJson(f);
      } on ApiException catch (_) {}
    }
    if (mounted) setState(() => loading = false);
  }

  Future<void> _pickOil(ServiceKind k) async {
    final typed = catalog.oils.where((o) => o.oilType == k.oilType).toList();
    final o = await Navigator.of(context).push<OilProduct>(MaterialPageRoute(
      builder: (_) => OilPickerScreen(kind: k, oils: typed.isEmpty ? catalog.oils : typed, brands: catalog.brands, filteredByType: typed.isNotEmpty),
    ));
    if (o != null) sel.setOil(k, o);
  }

  Future<void> _submit(Map<String, dynamic>? payload) async {
    setState(() { busy = true; err = null; });
    final e = await widget.submit(payload, widget.askOdometer && odo.text.trim().isNotEmpty ? arabicDigitsToLatin(odo.text.trim()) : null);
    if (!mounted) return;
    if (e == null) {
      Navigator.of(context).pop(true);
    } else {
      setState(() { busy = false; err = e; });
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: Text('اختر الخدمة', style: tx(Fs.lg, w: 900)), backgroundColor: Z8.ink2, surfaceTintColor: Colors.transparent),
        body: SafeArea(
          child: loading
              ? const Center(child: CircularProgressIndicator())
              : ListenableBuilder(
                  listenable: sel,
                  builder: (context, _) => Column(children: [
                    Expanded(
                      child: ListView(padding: const EdgeInsets.all(16), children: [
                        Panel(color: Z8.petrolSoft, child: Row(children: [
                          const Icon(Icons.directions_car_outlined, color: Z8.petrol),
                          const SizedBox(width: 10),
                          Expanded(child: Text(widget.carTitle, style: tx(Fs.md, w: 900))),
                        ])),
                        const SizedBox(height: 16),
                        Text('الخدمات المطلوبة (يمكنك اختيار أكثر من خدمة)', style: tx(Fs.md, w: 900, color: Z8.petrolDeep)),
                        const SizedBox(height: 8),
                        for (final k in ServiceKind.values) _ServiceTile(k, sel, onPick: () => _pickOil(k)),
                        if (sel.has(ServiceKind.engine) && sel.filter != null) ...[
                          const SizedBox(height: 4),
                          Panel(
                            pad: 4,
                            child: SwitchListTile(
                              value: sel.withFilter && sel.filter!.inStock, onChanged: sel.filter!.inStock ? sel.setFilter : null, activeThumbColor: Z8.petrol, contentPadding: const EdgeInsets.symmetric(horizontal: 12),
                              title: Text('مع تغيير فلتر الزيت', style: tx(Fs.md, w: 800)),
                              subtitle: Text(
                                sel.filter!.inStock
                                    ? '${sel.filter!.title} · ${sel.filter!.price.toStringAsFixed(2)} ر.س'
                                    : '${sel.filter!.title} · هذا المنتج غير متوفر الآن',
                                style: tx(Fs.sm, w: sel.filter!.inStock ? 500 : 800, color: sel.filter!.inStock ? Z8.textDim : Z8.ember)),
                            ),
                          ),
                        ],
                        if (sel.lines.isNotEmpty) ...[
                          const SizedBox(height: 16),
                          _Summary(sel),
                        ],
                        if (widget.askOdometer) ...[
                          const SizedBox(height: 16),
                          Z8Field(label: 'قراءة العداد (اختياري)', controller: odo, keyboard: TextInputType.number, ltr: true, maxLength: 7),
                        ],
                        if (err != null) ...[const SizedBox(height: 12), ErrorBar(err!)],
                      ]),
                    ),
                    _Footer(sel: sel, busy: busy, onConfirm: () => _submit(sel.payload()), onSkip: () => _submit(null)),
                  ]),
                ),
        ),
      );
}

class _ServiceTile extends StatelessWidget {
  const _ServiceTile(this.k, this.sel, {required this.onPick});
  final ServiceKind k;
  final BookingSelection sel;
  final VoidCallback onPick;
  @override
  Widget build(BuildContext context) {
    final on = sel.has(k);
    final p = sel.picks[k];
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Panel(
        pad: 0,
        color: on ? Z8.petrolSoft : null,
        child: Column(children: [
          InkWell(
            onTap: () => sel.toggle(k),
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Row(children: [
                Icon(on ? Icons.check_box : Icons.check_box_outline_blank, color: Z8.petrol),
                const SizedBox(width: 12),
                Expanded(child: Text(k.label, style: tx(Fs.md, w: 900))),
              ]),
            ),
          ),
          if (on && p != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(14, 0, 14, 14),
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                // مصدر الزيت: من الفرع أو زيت خارجي يحضره العميل
                Row(children: [
                  Expanded(child: _Source('زيت من الفرع', !p.external, () => sel.setExternal(k, false))),
                  const SizedBox(width: 8),
                  Expanded(child: _Source('زيت خارجي (أحضره بنفسي)', p.external, () => sel.setExternal(k, true))),
                ]),
                const SizedBox(height: 10),
                if (p.external)
                  Container(
                    padding: const EdgeInsets.all(12),
                    color: Z8.ink2,
                    child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      const Icon(Icons.info_outline, size: 20, color: Z8.petrolDeep),
                      const SizedBox(width: 8),
                      Expanded(child: Text('سيحضر الزيت من عندك وتُحتسب أجرة الخدمة فقط. أحضر الزيت للفرع عند الحضور.', style: tx(Fs.sm, w: 700))),
                    ]),
                  )
                else
                  InkWell(
                    onTap: onPick,
                    child: Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(color: Z8.ink2, border: Border.all(color: p.oil == null ? Z8.brass : Z8.line, width: p.oil == null ? 1.5 : 1)),
                      child: Row(children: [
                        Expanded(child: Text(p.oil?.title ?? 'اختر الزيت', style: tx(Fs.md, w: 800, color: p.oil == null ? Z8.brass : Z8.text))),
                        const Icon(Icons.arrow_drop_down),
                      ]),
                    ),
                  ),
                if (p.oil != null && !p.external) ...[
                  const SizedBox(height: 10),
                  Row(children: [
                    Text('الكمية (لتر)', style: tx(Fs.sm, w: 700, color: Z8.textDim)),
                    const Spacer(),
                    IconButton(onPressed: () => sel.setQty(k, p.qty - 0.5), icon: const Icon(Icons.remove_circle_outline)),
                    SizedBox(width: 44, child: Text(p.qty % 1 == 0 ? p.qty.toStringAsFixed(0) : p.qty.toStringAsFixed(1), textAlign: TextAlign.center, style: tx(Fs.lg, w: 900, tnum: true))),
                    IconButton(onPressed: () => sel.setQty(k, p.qty + 0.5), icon: const Icon(Icons.add_circle_outline)),
                  ]),
                  Align(alignment: AlignmentDirectional.centerEnd, child: Text('${p.total.toStringAsFixed(2)} ر.س', style: tx(Fs.md, w: 900, color: Z8.petrolDeep, tnum: true))),
                  Text('الكمية تقديرية — يؤكدها الفني عند الفحص', style: tx(Fs.xs, color: Z8.textDim)),
                ],
              ]),
            ),
        ]),
      ),
    );
  }
}

class _Source extends StatelessWidget {
  const _Source(this.label, this.on, this.onTap);
  final String label;
  final bool on;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => Material(
        color: on ? Z8.petrol : Z8.ink2,
        shape: RoundedRectangleBorder(side: BorderSide(color: on ? Z8.petrol : Z8.line)),
        child: InkWell(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 6),
            child: Center(child: Text(label, textAlign: TextAlign.center, style: tx(Fs.sm, w: 800, color: on ? Colors.white : Z8.text))),
          ),
        ),
      );
}

class _Summary extends StatelessWidget {
  const _Summary(this.sel);
  final BookingSelection sel;
  @override
  Widget build(BuildContext context) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text('ملخص الفاتورة', style: tx(Fs.md, w: 900, color: Z8.petrolDeep)),
        const SizedBox(height: 8),
        Panel(child: Column(children: [
          for (final l in sel.lines)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Expanded(child: Text(l.label, style: tx(Fs.sm, w: 600))),
                const SizedBox(width: 8),
                Text(l.line.toStringAsFixed(2), style: tx(Fs.sm, w: 800, tnum: true)),
              ]),
            ),
          const Divider(height: 20),
          Row(children: [
            Expanded(child: Text('الإجمالي (شامل الضريبة)', style: tx(Fs.md, w: 900))),
            Text('${sel.total.toStringAsFixed(2)} ر.س', style: tx(Fs.xl, w: 900, color: Z8.petrolDeep, tnum: true)),
          ]),
        ])),
        if (sel.feeAtBranch.isNotEmpty) ...[
          const SizedBox(height: 8),
          Container(
            padding: const EdgeInsets.all(12),
            color: Z8.petrolSoft,
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Icon(Icons.build_circle_outlined, size: 20, color: Z8.petrolDeep),
              const SizedBox(width: 8),
              Expanded(child: Text('أجرة ${sel.feeAtBranch.map((k) => k.label.replaceFirst('تغيير ', '')).join(' و')} غير مضافة: لها أكثر من خدمة في قائمة الخدمات، فيُحدَّد سعرها داخل الفرع حسب الخدمة المتوفرة.', style: tx(Fs.sm, w: 700))),
            ]),
          ),
        ],
        const SizedBox(height: 8),
        const _Disclaimer(),
      ]);
}

/// تنبيه السعر التقديري
class _Disclaimer extends StatelessWidget {
  const _Disclaimer();
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(12),
        color: Z8.brassSoft,
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Icon(Icons.info_outline, size: 20, color: Z8.petrolDeep),
          const SizedBox(width: 8),
          Expanded(child: Text('هذا السعر غير نهائي — قد تُضاف أصناف أو خدمات أخرى داخل الفرع بعد فحص السيارة، ويُحدَّد السعر النهائي عند إصدار الفاتورة.', style: tx(Fs.sm, w: 700))),
        ]),
      );
}

class _Footer extends StatelessWidget {
  const _Footer({required this.sel, required this.busy, required this.onConfirm, required this.onSkip});
  final BookingSelection sel;
  final bool busy;
  final VoidCallback onConfirm, onSkip;
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(16),
        decoration: const BoxDecoration(color: Z8.ink2, border: Border(top: BorderSide(color: Z8.line))),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          if (sel.lines.isNotEmpty) ...[
            Row(children: [
              Expanded(child: Text('الإجمالي التقديري', maxLines: 1, overflow: TextOverflow.ellipsis, style: tx(Fs.sm, w: 800))),
              Text('${sel.total.toStringAsFixed(2)} ر.س', style: tx(Fs.lg, w: 900, color: Z8.petrolDeep, tnum: true)),
            ]),
            Text('السعر غير نهائي — قد تُضاف أصناف داخل الفرع', style: tx(Fs.xs, color: Z8.textDim)),
            const SizedBox(height: 10),
          ],
          Z8Button('تأكيد الحجز', busy: busy, onTap: sel.complete ? onConfirm : null),
          const SizedBox(height: 6),
          TextButton(
            onPressed: busy ? null : onSkip,
            child: Text('احجز دون تحديد الزيت (يحدده الفني)', style: tx(Fs.sm, w: 800, color: Z8.petrol)),
          ),
        ]),
      );
}
