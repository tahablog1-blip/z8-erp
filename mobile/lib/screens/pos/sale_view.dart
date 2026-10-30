// lib/screens/pos/sale_view.dart — شاشة البيع: المنتجات + الفئات + السلة + الدفع (نفس تخطيط الموقع)
import 'package:flutter/material.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../core/z8_widgets.dart';
import '../../models/models.dart';
import '../../state/app_state.dart';
import '../common/catalog.dart';
import 'pay_dialog.dart';
import 'pos_controller.dart';
import 'shift_widgets.dart';

class SaleView extends StatefulWidget {
  const SaleView({super.key, required this.pos, required this.app, required this.service});
  final PosController pos;
  final AppState app;
  final bool service;      // نقطة بيع الخدمة (سيارات الطابور) أو البيع المباشر
  @override
  State<SaleView> createState() => _SaleViewState();
}

class _SaleViewState extends State<SaleView> {
  PosController get pos => widget.pos;

  Future<void> _pay() async {
    if (widget.service && pos.car == null) { showToast(context, 'نقطة بيع الخدمة بتصدر فواتير سيارات الطابور فقط — اختر سيارة', error: true); return; }
    final lines = await showPayDialog(context, total: pos.total, customer: pos.customer);
    if (lines == null) return;
    final inv = await pos.submit(lines);
    if (inv != null && mounted) {
      await showDialog<void>(context: context, builder: (c) => AlertDialog(
        title: Row(children: [const Icon(Icons.check_circle_rounded, color: Z8.emerald), const SizedBox(width: 10), Text('تم إصدار الفاتورة', style: tx(Fs.lg, w: 800))]),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          Text(inv.invoiceNo, style: tx(Fs.x2, w: 800, tnum: true)),
          const SizedBox(height: 6),
          Text('${money(inv.totalInc)} ر.س', style: tx(Fs.xl, w: 800, color: Z8.emerald, tnum: true)),
        ]),
        actions: [Z8Button('تم', onTap: () => Navigator.pop(c))],
      ));
    }
  }

  @override
  Widget build(BuildContext context) {
    if (pos.shift == null) return OpenShiftCard(pos: pos);
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Expanded(child: widget.service ? _ServiceQueue(pos: pos) : _Catalog(state: this)),
        const SizedBox(width: 16),
        SizedBox(width: 392, child: _CartPanel(pos: pos, service: widget.service, onPay: _pay)),
      ]),
    );
  }
}

// ═════════════ الكتالوج ═════════════
class _Catalog extends StatelessWidget {
  const _Catalog({required this.state});
  final _SaleViewState state;
  @override
  Widget build(BuildContext context) {
    final pos = state.pos;
    return CatalogPane(
      products: pos.products,
      onAdd: pos.add,
      isOut: (p) => !p.isService && pos.stockKnown && (pos.stock[p.id] ?? 0) <= 0,
      onScan: (v) {
        final p = pos.byBarcode(v);
        if (p != null) { pos.add(p); return true; }
        if (v.trim().isNotEmpty) showToast(context, 'لا يوجد صنف بهذا الباركود', error: true);
        return false;
      },
    );
  }
}

// ═════════════ طابور الخدمة ═════════════
class _ServiceQueue extends StatelessWidget {
  const _ServiceQueue({required this.pos});
  final PosController pos;
  @override
  Widget build(BuildContext context) {
    final ready = pos.queue.where((c) => c.workStatus == 'ready').toList();
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Row(children: [
        Expanded(child: Text('سيارات جاهزة للفوترة (${ready.length})', style: tx(Fs.lg, w: 800))),
        Z8Button('تحديث', icon: Icons.refresh_rounded, variant: BtnVariant.ghost, height: 40, size: Fs.sm, onTap: pos.reloadQueue),
      ]),
      const SizedBox(height: 12),
      Expanded(child: ready.isEmpty
          ? Center(child: Text('لا توجد سيارات جاهزة — يعتمد موظف أوامر العمل الأمر أولاً ثم يظهر هنا', textAlign: TextAlign.center, style: tx(Fs.md, color: Z8.textDim)))
          : GridView.builder(
              gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(maxCrossAxisExtent: 280, mainAxisExtent: 128, crossAxisSpacing: 12, mainAxisSpacing: 12),
              itemCount: ready.length,
              itemBuilder: (c, i) {
                final car = ready[i];
                final sel = pos.car?.id == car.id;
                return Material(
                  color: sel ? Z8.petrolSoft : Z8.ink2,
                  shape: RoundedRectangleBorder(side: BorderSide(color: sel ? Z8.petrol : Z8.line, width: sel ? 2 : 1), borderRadius: BorderRadius.zero),
                  child: InkWell(onTap: () => pos.pickCar(car), child: Padding(padding: const EdgeInsets.all(14), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(children: [
                      Container(padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3), color: Z8.petrol, child: Text('#${car.queueNo}', style: tx(Fs.sm, w: 800, color: Colors.white, tnum: true))),
                      const Spacer(),
                      Text('${car.items.length} صنف', style: tx(Fs.xs, color: Z8.textDim)),
                    ]),
                    const SizedBox(height: 10),
                    Text(car.plate, style: tx(Fs.lg, w: 800, tnum: true)),
                    Text(car.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: tx(Fs.sm, color: Z8.textDim)),
                  ]))),
                );
              },
            )),
    ]);
  }
}

// ═════════════ لوحة الفاتورة ═════════════
class _CartPanel extends StatelessWidget {
  const _CartPanel({required this.pos, required this.service, required this.onPay});
  final PosController pos;
  final bool service;
  final VoidCallback onPay;

  @override
  Widget build(BuildContext context) {
    final empty = pos.cart.isEmpty;
    return Container(
      decoration: BoxDecoration(color: Z8.ink2, border: Border.all(color: Z8.line), boxShadow: Z8.shadowCard),
      child: Column(children: [
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12), color: Z8.sbBg,
          child: Row(children: [
            const Icon(Icons.shopping_cart_outlined, color: Colors.white, size: 26),
            const SizedBox(width: 10),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('الفاتورة', style: tx(Fs.lg, w: 800, color: Colors.white)),
              Text(pos.car != null ? 'سيارة ${pos.car!.plate}' : (pos.customer?.name ?? 'بيع نقدي'), maxLines: 1, overflow: TextOverflow.ellipsis, style: tx(Fs.xs, color: Z8.sbText2)),
            ])),
            _HeaderChip('${pos.itemsCount} صنف', null),
            const SizedBox(width: 8),
            _HeaderChip('المعلقة${pos.held.isEmpty ? '' : ' (${pos.held.length})'}', () => _showHeld(context, pos)),
          ]),
        ),
        // عميل
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 10, 12, 0),
          child: Row(children: [
            Expanded(child: Z8Button(pos.customer == null ? 'إضافة عميل' : pos.customer!.name, icon: pos.customer == null ? Icons.person_add_alt_1_rounded : Icons.person_rounded, variant: pos.customer == null ? BtnVariant.primary : BtnVariant.soft, height: 40, size: Fs.sm, onTap: () => _pickCustomer(context, pos))),
            if (pos.customer != null) ...[const SizedBox(width: 8), Z8Button('', icon: Icons.close_rounded, variant: BtnVariant.ghost, height: 40, onTap: () => pos.setCustomer(null))],
          ]),
        ),
        Expanded(child: empty
            ? Center(child: Padding(padding: const EdgeInsets.all(20), child: Column(mainAxisSize: MainAxisSize.min, children: [
                const Icon(Icons.shopping_cart_outlined, size: 52, color: Z8.textDim),
                const SizedBox(height: 10),
                Text('الفاتورة فارغة', style: tx(Fs.md, w: 800, color: Z8.textDim)),
                const SizedBox(height: 6),
                Text(service ? 'اختر سيارة من الطابور لتظهر أصناف أمر العمل' : 'امسح الباركود أو اضغط بطاقة الصنف — وسيظهر هنا فوراً', textAlign: TextAlign.center, style: tx(Fs.sm, color: Z8.textDim, h: 1.5)),
              ])))
            : ListView.separated(
                padding: const EdgeInsets.all(12), itemCount: pos.cart.length, separatorBuilder: (_, _) => const Divider(height: 1, color: Z8.line),
                itemBuilder: (c, i) => _CartRow(line: pos.cart[i], pos: pos),
              )),
        if (pos.saleError != null) Container(width: double.infinity, padding: const EdgeInsets.all(10), color: Z8.emberBg, child: Text(pos.saleError!, style: tx(Fs.sm, w: 700, color: Z8.ember))),
        Container(
          padding: const EdgeInsets.all(14), decoration: const BoxDecoration(border: Border(top: BorderSide(color: Z8.line))),
          child: Column(children: [
            Row(children: [
              Expanded(child: Text('الإجمالي شامل الضريبة', style: tx(Fs.md, w: 800))),
              Text('${count(pos.itemsCount)} صنف', style: tx(Fs.sm, color: Z8.textDim)),
            ]),
            const SizedBox(height: 4),
            Align(alignment: AlignmentDirectional.centerEnd, child: Text('${money(pos.total)} ر.س', style: tx(Fs.x2, w: 800, tnum: true))),
            const SizedBox(height: 10),
            Z8Button('ادفع الآن', icon: Icons.payments_rounded, variant: BtnVariant.success, height: 56, size: Fs.lg, expand: true, busy: pos.saleBusy, onTap: empty ? null : onPay),
            const SizedBox(height: 8),
            Z8Button('تعليق الفاتورة', icon: Icons.pause_circle_outline_rounded, variant: BtnVariant.ghost, height: 44, size: Fs.sm, expand: true, onTap: empty ? null : () => _hold(context)),
          ]),
        ),
      ]),
    );
  }

  void _hold(BuildContext context) {
    final note = TextEditingController();
    showDialog<void>(context: context, builder: (c) => AlertDialog(
      title: Text('تعليق الفاتورة', style: tx(Fs.lg, w: 800)),
      content: SizedBox(width: 380, child: Z8Field(label: 'ملاحظة (اختياري)', controller: note, autofocus: true)),
      actions: [Z8Button('إلغاء', variant: BtnVariant.ghost, onTap: () => Navigator.pop(c)), Z8Button('تعليق', onTap: () { pos.holdCurrent(note.text); Navigator.pop(c); })],
    ));
  }

  static Future<void> _pickCustomer(BuildContext context, PosController pos) => showDialog<void>(context: context, builder: (c) => _CustomerDialog(pos: pos));
  static Future<void> _showHeld(BuildContext context, PosController pos) => showDialog<void>(context: context, builder: (c) => _HeldDialog(pos: pos));
}

class _HeaderChip extends StatelessWidget {
  const _HeaderChip(this.text, this.onTap);
  final String text;
  final VoidCallback? onTap;
  @override
  Widget build(BuildContext context) => Material(
        color: Z8.sbGroup,
        child: InkWell(onTap: onTap, child: Padding(padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7), child: Text(text, style: tx(Fs.sm, w: 800, color: Colors.white)))),
      );
}

class _CartRow extends StatelessWidget {
  const _CartRow({required this.line, required this.pos});
  final CartLine line;
  final PosController pos;
  @override
  Widget build(BuildContext context) {
    Widget q(IconData i, VoidCallback f) => InkWell(onTap: f, child: Container(width: 34, height: 34, decoration: BoxDecoration(border: Border.all(color: Z8.line), color: Z8.ink3), child: Icon(i, size: 20)));
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(children: [
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(line.label, maxLines: 2, overflow: TextOverflow.ellipsis, style: tx(Fs.sm, w: 800, h: 1.25)),
          Text('${money(line.unitPriceVat)} ر.س', style: tx(Fs.xs, color: Z8.textDim, tnum: true)),
        ])),
        const SizedBox(width: 8),
        q(Icons.remove_rounded, () => pos.setQty(line, line.qty - 1)),
        SizedBox(width: 34, child: Text('${line.qty}', textAlign: TextAlign.center, style: tx(Fs.md, w: 800, tnum: true))),
        q(Icons.add_rounded, () => pos.setQty(line, line.qty + 1)),
        SizedBox(width: 78, child: Text(money(line.totalInc), textAlign: TextAlign.end, style: tx(Fs.md, w: 800, tnum: true))),
      ]),
    );
  }
}

class _CustomerDialog extends StatefulWidget {
  const _CustomerDialog({required this.pos});
  final PosController pos;
  @override
  State<_CustomerDialog> createState() => _CustomerDialogState();
}

class _CustomerDialogState extends State<_CustomerDialog> {
  final q = TextEditingController(), name = TextEditingController(), phone = TextEditingController();
  List<Customer> results = [];
  bool creating = false;

  Future<void> _search(String v) async { final r = await widget.pos.searchCustomers(v); if (mounted) setState(() => results = r); }

  @override
  Widget build(BuildContext context) => AlertDialog(
        title: Text('العميل', style: tx(Fs.lg, w: 800)),
        content: SizedBox(width: 460, child: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          if (!creating) ...[
            Z8Field(label: 'بحث بالاسم أو الجوال', controller: q, onChanged: _search, autofocus: true),
            const SizedBox(height: 10),
            for (final c in results) ListTile(
              title: Text(c.name, style: tx(Fs.md, w: 700)), subtitle: Text(c.phone ?? '', style: tx(Fs.sm, color: Z8.textDim)), dense: true,
              onTap: () { widget.pos.setCustomer(c); Navigator.pop(context); },
            ),
            TextButton.icon(onPressed: () => setState(() => creating = true), icon: const Icon(Icons.person_add_alt_1_rounded), label: Text('عميل جديد', style: tx(Fs.md, w: 700, color: Z8.petrol))),
          ] else ...[
            Z8Field(label: 'اسم العميل', controller: name, autofocus: true),
            const SizedBox(height: 10),
            Z8Field(label: 'الجوال', controller: phone, keyboard: TextInputType.phone),
            const SizedBox(height: 12),
            Z8Button('حفظ واختيار', expand: true, onTap: () async {
              if (name.text.trim().isEmpty) return;
              final c = await widget.pos.createCustomer(name.text.trim(), phone.text.trim());
              if (c != null) { widget.pos.setCustomer(c); if (context.mounted) Navigator.pop(context); }
            }),
          ],
        ]))),
        actions: [Z8Button('إغلاق', variant: BtnVariant.ghost, onTap: () => Navigator.pop(context))],
      );
}

class _HeldDialog extends StatelessWidget {
  const _HeldDialog({required this.pos});
  final PosController pos;
  @override
  Widget build(BuildContext context) => AlertDialog(
        title: Text('الفواتير المعلقة', style: tx(Fs.lg, w: 800)),
        content: SizedBox(width: 460, child: pos.held.isEmpty
            ? Padding(padding: const EdgeInsets.all(20), child: Text('لا توجد فواتير معلقة', textAlign: TextAlign.center, style: tx(Fs.md, color: Z8.textDim)))
            : Column(mainAxisSize: MainAxisSize.min, children: [
                for (final h in pos.held) ListTile(
                  title: Text(h.note.isEmpty ? '${h.cart.length} صنف' : h.note, style: tx(Fs.md, w: 700)),
                  subtitle: Text('${timeHm(h.time)}  ·  ${money(h.cart.fold<double>(0, (s, l) => s + l.totalInc))} ر.س', style: tx(Fs.sm, color: Z8.textDim)),
                  trailing: IconButton(onPressed: () { pos.deleteHeld(h.id); Navigator.pop(context); }, icon: const Icon(Icons.delete_outline_rounded, color: Z8.ember)),
                  onTap: () { pos.resume(h); Navigator.pop(context); },
                ),
              ])),
        actions: [Z8Button('إغلاق', variant: BtnVariant.ghost, onTap: () => Navigator.pop(context))],
      );
}
