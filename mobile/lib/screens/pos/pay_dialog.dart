// lib/screens/pos/pay_dialog.dart — الدفع: طرق متعددة وتقسيم، والمتبقي/الباقي للنقد
import 'package:flutter/material.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../core/z8_widgets.dart';
import '../../models/models.dart';
import 'pos_controller.dart';

/// يُرجع قائمة الدفعات عند التأكيد أو null عند الإلغاء
Future<List<PayLine>?> showPayDialog(BuildContext context, {required double total, required Customer? customer}) {
  return showDialog<List<PayLine>>(context: context, builder: (c) => _PayDialog(total: total, customer: customer));
}

class _PayDialog extends StatefulWidget {
  const _PayDialog({required this.total, required this.customer});
  final double total;
  final Customer? customer;
  @override
  State<_PayDialog> createState() => _PayDialogState();
}

class _PayDialogState extends State<_PayDialog> {
  late final List<PayLine> lines = [PayLine(PayMethod.cash, widget.total)];
  final Map<PayLine, TextEditingController> ctl = {};
  String? err;

  TextEditingController c(PayLine l) => ctl.putIfAbsent(l, () => TextEditingController(text: money(l.amount).replaceAll(',', '')));
  double get paid => lines.fold(0, (s, l) => s + l.amount);
  double get remaining => double.parse((widget.total - paid).toStringAsFixed(2));

  void _refresh() => setState(() {});

  void _confirm() {
    if (remaining.abs() > 0.01) { setState(() => err = remaining > 0 ? 'المتبقي ${money(remaining)} ر.س — أكمل الدفع' : 'المبلغ المدفوع أكبر من الإجمالي'); return; }
    if (lines.any((l) => l.method == PayMethod.credit && l.amount > 0) && widget.customer == null) { setState(() => err = 'البيع الآجل يتطلب اختيار عميل'); return; }
    Navigator.pop(context, lines.where((l) => l.amount > 0).toList());
  }

  @override
  Widget build(BuildContext context) {
    final cashOver = lines.length == 1 && lines.first.method == PayMethod.cash && paid > widget.total + 0.001;
    return Dialog(
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.zero),
      child: SizedBox(width: 520, child: Padding(
        padding: const EdgeInsets.all(22),
        child: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(children: [Expanded(child: Text('الدفع', style: tx(Fs.xl, w: 800))), IconButton(onPressed: () => Navigator.pop(context), icon: const Icon(Icons.close_rounded))]),
          Container(
            padding: const EdgeInsets.all(16), color: Z8.petrolSoft,
            child: Row(children: [
              Expanded(child: Text('الإجمالي شامل الضريبة', style: tx(Fs.md, w: 700, color: Z8.petrol))),
              Text('${money(widget.total)} ر.س', style: tx(Fs.x2, w: 800, color: Z8.petrol, tnum: true)),
            ]),
          ),
          const SizedBox(height: 16),
          for (var i = 0; i < lines.length; i++) _line(i),
          Align(alignment: AlignmentDirectional.centerStart, child: TextButton.icon(
            onPressed: () => setState(() { lines.add(PayLine(PayMethod.card, remaining > 0 ? remaining : 0)); }),
            icon: const Icon(Icons.add_rounded), label: Text('تقسيم الدفع', style: tx(Fs.sm, w: 700, color: Z8.petrol)))),
          const SizedBox(height: 6),
          Row(children: [
            Expanded(child: Text(remaining > 0.009 ? 'المتبقي' : (cashOver ? 'الباقي للعميل' : 'مكتمل'), style: tx(Fs.md, w: 700, color: remaining > 0.009 ? Z8.ember : Z8.emerald))),
            Text(remaining > 0.009 ? '${money(remaining)} ر.س' : (cashOver ? '${money(paid - widget.total)} ر.س' : '✓'), style: tx(Fs.lg, w: 800, color: remaining > 0.009 ? Z8.ember : Z8.emerald, tnum: true)),
          ]),
          if (err != null) Padding(padding: const EdgeInsets.only(top: 10), child: Text(err!, style: tx(Fs.sm, w: 700, color: Z8.ember))),
          const SizedBox(height: 16),
          Z8Button('إصدار الفاتورة', icon: Icons.check_circle_rounded, variant: BtnVariant.success, height: 54, size: Fs.lg, expand: true, onTap: _confirm),
        ])),
      )),
    );
  }

  Widget _line(int i) {
    final l = lines[i];
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          for (final m in PayMethod.values) Expanded(child: Padding(
            padding: const EdgeInsetsDirectional.only(end: 6),
            child: Material(
              color: l.method == m ? Z8.petrol : Z8.ink2,
              shape: RoundedRectangleBorder(side: BorderSide(color: l.method == m ? Z8.petrol : Z8.line), borderRadius: BorderRadius.zero),
              child: InkWell(onTap: () { l.method = m; _refresh(); }, child: Container(height: 44, alignment: Alignment.center, child: Text(m.label, style: tx(Fs.md, w: 800, color: l.method == m ? Colors.white : Z8.text)))),
            ),
          )),
          if (lines.length > 1) IconButton(onPressed: () => setState(() { lines.removeAt(i); }), icon: const Icon(Icons.delete_outline_rounded, color: Z8.ember)),
        ]),
        const SizedBox(height: 8),
        Row(children: [
          Expanded(child: TextField(
            controller: c(l), keyboardType: const TextInputType.numberWithOptions(decimal: true), style: tx(Fs.lg, w: 800, tnum: true),
            decoration: InputDecoration(prefixText: 'ر.س  ', prefixStyle: tx(Fs.md, color: Z8.textDim), filled: true, fillColor: Z8.ink2),
            onChanged: (v) { l.amount = double.tryParse(v) ?? 0; _refresh(); },
          )),
          const SizedBox(width: 8),
          Z8Button('المتبقي', variant: BtnVariant.soft, height: 48, size: Fs.sm, onTap: () { l.amount = double.parse(((remaining + l.amount).clamp(0, double.infinity)).toStringAsFixed(2)); c(l).text = money(l.amount).replaceAll(',', ''); _refresh(); }),
        ]),
      ]),
    );
  }
}
