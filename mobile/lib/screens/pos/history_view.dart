// lib/screens/pos/history_view.dart — سجل الفواتير (قائمة + تفاصيل الفاتورة)
import 'package:flutter/material.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../core/z8_widgets.dart';
import 'pos_controller.dart';

class HistoryView extends StatefulWidget {
  const HistoryView({super.key, required this.pos});
  final PosController pos;
  @override
  State<HistoryView> createState() => _HistoryViewState();
}

class _HistoryViewState extends State<HistoryView> {
  @override
  void initState() { super.initState(); widget.pos.loadInvoices(); }

  Future<void> _open(String id) async {
    try {
      final d = await widget.pos.api.get('/invoices/$id') as Map;
      if (!mounted) return;
      await showDialog<void>(context: context, builder: (c) => _InvoiceDialog(d: d));
    } catch (e) { if (mounted) showToast(context, '$e', error: true); }
  }

  @override
  Widget build(BuildContext context) {
    final list = widget.pos.invoices;
    return Padding(
      padding: const EdgeInsets.all(20),
      child: Z8Card(
        padding: EdgeInsets.zero,
        child: list.isEmpty
            ? Center(child: Text('لا توجد فواتير', style: tx(Fs.md, color: Z8.textDim)))
            : ListView.separated(
                itemCount: list.length,
                separatorBuilder: (_, _) => const Divider(height: 1, color: Z8.line),
                itemBuilder: (c, i) {
                  final f = list[i];
                  return InkWell(
                    onTap: () => _open(f.id),
                    child: Padding(padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14), child: Row(children: [
                      Expanded(flex: 2, child: Text(f.invoiceNo, style: tx(Fs.md, w: 800, tnum: true))),
                      Expanded(flex: 3, child: Text(f.customerName ?? 'بيع نقدي', style: tx(Fs.md, color: Z8.textDim))),
                      Expanded(flex: 2, child: Text(f.issuedAt == null ? '' : dateTimeShort(f.issuedAt!), style: tx(Fs.sm, color: Z8.textDim, tnum: true))),
                      if (f.isReturned) const Z8Badge('مرتجعة', fg: Z8.ember, bg: Z8.emberBg),
                      const SizedBox(width: 12),
                      SizedBox(width: 120, child: Text('${money(f.totalInc)} ر.س', textAlign: TextAlign.end, style: tx(Fs.md, w: 800, tnum: true))),
                    ])),
                  );
                },
              ),
      ),
    );
  }
}

class _InvoiceDialog extends StatelessWidget {
  const _InvoiceDialog({required this.d});
  final Map d;
  @override
  Widget build(BuildContext context) {
    final items = (d['items'] as List? ?? const []);
    final pays = (d['payments'] as List? ?? const []);
    const methods = {'cash': 'نقدي', 'card': 'شبكة', 'transfer': 'تحويل', 'credit': 'آجل'};
    return AlertDialog(
      title: Row(children: [Expanded(child: Text('فاتورة ${d['invoice_no']}', style: tx(Fs.lg, w: 800))), if (d['is_returned'] == true) const Z8Badge('مرتجعة', fg: Z8.ember, bg: Z8.emberBg)]),
      content: SizedBox(width: 520, child: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        for (final i in items) Padding(
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: Row(children: [
            Expanded(child: Text('${i['label']}', style: tx(Fs.md, w: 700))),
            Text('× ${i['qty']}', style: tx(Fs.md, color: Z8.textDim, tnum: true)),
            const SizedBox(width: 14),
            SizedBox(width: 90, child: Text(money(toNum(i['line_inc'])), textAlign: TextAlign.end, style: tx(Fs.md, w: 800, tnum: true))),
          ]),
        ),
        const Divider(color: Z8.line),
        Row(children: [Expanded(child: Text('الإجمالي شامل الضريبة', style: tx(Fs.md, w: 800))), Text('${money(toNum(d['total_inc']))} ر.س', style: tx(Fs.lg, w: 800, tnum: true))]),
        const SizedBox(height: 8),
        for (final p in pays) Row(children: [Expanded(child: Text(methods['${p['method']}'] ?? '${p['method']}', style: tx(Fs.sm, color: Z8.textDim))), Text(money(toNum(p['amount'])), style: tx(Fs.sm, color: Z8.textDim, tnum: true))]),
      ]))),
      actions: [Z8Button('إغلاق', variant: BtnVariant.ghost, onTap: () => Navigator.pop(context))],
    );
  }
}
