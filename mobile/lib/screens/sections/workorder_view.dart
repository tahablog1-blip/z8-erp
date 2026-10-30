// lib/screens/sections/workorder_view.dart — إعداد/إصدار أمر العمل: طابور السيارات → أصناف الأمر → تأكيد وإرسال للكاشير
import 'package:flutter/material.dart';
import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../core/z8_widgets.dart';
import '../../models/models.dart';
import '../../state/app_state.dart';
import '../common/catalog.dart';

class WorkOrderView extends StatefulWidget {
  const WorkOrderView({super.key, required this.app});
  final AppState app;
  @override
  State<WorkOrderView> createState() => _WorkOrderViewState();
}

class _WorkOrderViewState extends State<WorkOrderView> {
  bool loading = true;
  String? error, msg;
  List<Map> queue = [];
  List<Product> products = [];
  Map? active;
  final List<CartLine> cart = [];
  final odo = TextEditingController(), notes = TextEditingController(), pin = TextEditingController(), find = TextEditingController();
  bool busy = false;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    setState(() { loading = true; error = null; });
    try {
      final api = widget.app.api;
      final r = await Future.wait([api.get('/cars/preparation-queue'), api.get('/products')]);
      queue = [for (final c in (r[0] as List)) c as Map];
      products = [for (final p in (r[1] as List)) Product.fromJson(p as Map)].where((p) => p.priceVat > 0 || p.price > 0).toList();
    } on ApiException catch (e) { error = e.message; }
    if (mounted) setState(() => loading = false);
  }

  void _select(Map c) {
    active = c; cart.clear(); odo.clear(); notes.clear(); pin.clear(); msg = null; error = null;
    for (final i in (c['prepared_items'] as List? ?? const [])) {
      final m = i as Map;
      cart.add(CartLine(productId: '${m['productId']}', label: '${m['label']}', qty: (m['qty'] as num).toInt(), unitPrice: toNum(m['unitPrice']), unitPriceVat: toNum(m['unitPriceVat']), isService: m['isService'] == true));
    }
    setState(() {});
  }

  void _add(Product p) {
    final i = cart.indexWhere((l) => l.productId == p.id);
    setState(() { if (i >= 0) { cart[i].qty++; } else { cart.add(CartLine(productId: p.id, label: p.name, qty: 1, unitPrice: p.price, unitPriceVat: p.priceVat, isService: p.isService)); } });
  }

  Future<void> _confirm() async {
    if (active == null || cart.isEmpty) return;
    setState(() { busy = true; error = null; msg = null; });
    try {
      final r = await widget.app.api.post('/cars/${active!['id']}/prepare-confirm', body: {
        'items': [for (final l in cart) {'productId': l.productId, 'qty': l.qty}],
        'odometer': odo.text.trim().isEmpty ? null : int.tryParse(odo.text.trim()),
        'notes': notes.text.trim().isEmpty ? null : notes.text.trim(),
        'approvalPin': pin.text.trim().isEmpty ? null : pin.text.trim(),
      }) as Map;
      msg = 'تم الإرسال إلى الكاشير — ${r['plate'] ?? active!['plate'] ?? ''}';
      active = null; cart.clear();
      await _load();
    } on ApiException catch (e) { error = e.message; }
    if (mounted) setState(() => busy = false);
  }

  Future<void> _draft() async {
    if (active == null) return;
    try {
      await widget.app.api.post('/cars/${active!['id']}/draft-items', body: {'items': [for (final l in cart.where((l) => !l.isService)) {'productId': l.productId, 'qty': l.qty}]});
      if (mounted) showToast(context, 'تم حفظ المسودة');
    } on ApiException catch (e) { if (mounted) showToast(context, e.message, error: true); }
  }

  @override
  Widget build(BuildContext context) {
    if (loading) return const Center(child: CircularProgressIndicator(color: Z8.petrol));
    final q = find.text.trim().toLowerCase();
    final list = queue.where((c) => q.isEmpty || '${c['plate']}${c['customer_name']}${c['brand']}${c['name']}'.toLowerCase().contains(q)).toList();
    return Padding(padding: const EdgeInsets.all(16), child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
      // الطابور
      SizedBox(width: 300, child: Z8Card(padding: EdgeInsets.zero, child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Padding(padding: const EdgeInsets.all(12), child: Row(children: [
          Expanded(child: TextField(controller: find, onChanged: (_) => setState(() {}), style: tx(Fs.md), decoration: InputDecoration(prefixIcon: const Icon(Icons.search_rounded), hintText: 'لوحة / عميل', hintStyle: tx(Fs.md, color: Z8.textDim), filled: true, fillColor: Z8.ink2))),
          IconButton(onPressed: _load, icon: const Icon(Icons.refresh_rounded)),
        ])),
        const Divider(height: 1, color: Z8.line),
        Expanded(child: list.isEmpty ? Center(child: Text('لا توجد سيارات', style: tx(Fs.md, color: Z8.textDim))) : ListView.separated(itemCount: list.length, separatorBuilder: (_, _) => const Divider(height: 1, color: Z8.line), itemBuilder: (c, i) {
          final x = list[i]; final sel = active?['id'] == x['id'];
          return Material(color: sel ? Z8.petrolSoft : Colors.transparent, child: InkWell(onTap: () => _select(x), child: Padding(padding: const EdgeInsets.all(12), child: Row(children: [
            Container(padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3), color: Z8.petrol, child: Text('#${x['queue_no'] ?? ''}', style: tx(Fs.sm, w: 800, color: Colors.white, tnum: true))),
            const SizedBox(width: 10),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text('${x['plate'] ?? ''}', style: tx(Fs.md, w: 800, tnum: true)), Text('${x['brand'] ?? ''} ${x['name'] ?? ''}', maxLines: 1, overflow: TextOverflow.ellipsis, style: tx(Fs.xs, color: Z8.textDim))])),
            if (x['work_status'] == 'preparing') const Z8Badge('قيد الإعداد', fg: Z8.brass, bg: Z8.brassSoft),
          ]))));
        })),
      ]))),
      const SizedBox(width: 16),
      // الكتالوج
      Expanded(child: active == null
          ? Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
              if (msg != null) Container(padding: const EdgeInsets.all(12), margin: const EdgeInsets.only(bottom: 14), color: Z8.emeraldBg, child: Text(msg!, style: tx(Fs.md, w: 800, color: Z8.emerald))),
              const Icon(Icons.assignment_rounded, size: 56, color: Z8.textDim), const SizedBox(height: 10),
              Text('اختر سيارة من الطابور لإعداد أمر العمل', style: tx(Fs.md, color: Z8.textDim)),
            ]))
          : CatalogPane(products: products, onAdd: _add)),
      const SizedBox(width: 16),
      // أمر العمل
      if (active != null) SizedBox(width: 380, child: Container(
        decoration: BoxDecoration(color: Z8.ink2, border: Border.all(color: Z8.line), boxShadow: Z8.shadowCard),
        child: Column(children: [
          Container(padding: const EdgeInsets.all(14), color: Z8.sbBg, child: Row(children: [
            const Icon(Icons.assignment_rounded, color: Colors.white), const SizedBox(width: 10),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text('أمر عمل', style: tx(Fs.lg, w: 800, color: Colors.white)), Text('${active!['plate'] ?? ''}  ·  ${active!['brand'] ?? ''} ${active!['name'] ?? ''}', style: tx(Fs.xs, color: Z8.sbText2))])),
          ])),
          Expanded(child: cart.isEmpty ? Center(child: Text('أضف الأصناف من الكتالوج', style: tx(Fs.md, color: Z8.textDim))) : ListView.separated(padding: const EdgeInsets.all(12), itemCount: cart.length, separatorBuilder: (_, _) => const Divider(height: 1, color: Z8.line), itemBuilder: (c, i) {
            final l = cart[i];
            Widget b(IconData ic, VoidCallback f) => InkWell(onTap: f, child: Container(width: 32, height: 32, decoration: BoxDecoration(border: Border.all(color: Z8.line), color: Z8.ink3), child: Icon(ic, size: 18)));
            return Padding(padding: const EdgeInsets.symmetric(vertical: 8), child: Row(children: [
              Expanded(child: Text(l.label, maxLines: 2, overflow: TextOverflow.ellipsis, style: tx(Fs.sm, w: 800))),
              b(Icons.remove_rounded, () => setState(() { l.qty--; if (l.qty <= 0) cart.removeAt(i); })),
              SizedBox(width: 30, child: Text('${l.qty}', textAlign: TextAlign.center, style: tx(Fs.md, w: 800, tnum: true))),
              b(Icons.add_rounded, () => setState(() => l.qty++)),
            ]));
          })),
          if (error != null) Container(width: double.infinity, padding: const EdgeInsets.all(10), color: Z8.emberBg, child: Text(error!, style: tx(Fs.sm, w: 700, color: Z8.ember))),
          Padding(padding: const EdgeInsets.all(12), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Row(children: [
              Expanded(child: Z8Field(label: 'الممشى', controller: odo, keyboard: TextInputType.number)),
              const SizedBox(width: 10),
              SizedBox(width: 130, child: Z8Field(label: 'رمز الاعتماد', controller: pin, keyboard: TextInputType.number)),
            ]),
            const SizedBox(height: 8),
            Z8Field(label: 'ملاحظات', controller: notes),
            const SizedBox(height: 12),
            Row(children: [
              Expanded(child: Z8Button('حفظ مسودة', variant: BtnVariant.ghost, height: 46, size: Fs.sm, onTap: _draft)),
              const SizedBox(width: 8),
              Expanded(flex: 2, child: Z8Button('تأكيد وإرسال للكاشير', icon: Icons.send_rounded, variant: BtnVariant.success, height: 46, size: Fs.sm, busy: busy, onTap: cart.isEmpty ? null : _confirm)),
            ]),
          ])),
        ]),
      )),
    ]));
  }
}
