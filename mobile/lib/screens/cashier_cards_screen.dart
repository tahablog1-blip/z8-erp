// lib/screens/cashier_cards_screen.dart — بطاقات كاشيري الفرع: اختر اسمك ثم أدخل رمزك
import 'package:flutter/material.dart';
import '../core/theme.dart';
import '../core/z8_widgets.dart';
import '../state/app_state.dart';
import 'shell_frame.dart';

class CashierCardsScreen extends StatelessWidget {
  const CashierCardsScreen({super.key, required this.app});
  final AppState app;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: app,
      builder: (context, _) => AuthFrame(
        title: 'اختر الكاشير',
        subtitle: app.branch == null ? null : 'فرع ${app.branch!.name}',
        footer: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
          Z8Button('رمز قسم آخر', icon: Icons.dialpad_rounded, variant: BtnVariant.ghost, height: 40, size: Fs.sm, onTap: app.openOtherCode),
          const SizedBox(width: 10),
          Z8Button('تحديث', icon: Icons.refresh_rounded, variant: BtnVariant.ghost, height: 40, size: Fs.sm, onTap: app.refreshCards),
          const SizedBox(width: 10),
          Z8Button('إعادة ضبط الجهاز', variant: BtnVariant.danger, height: 40, size: Fs.sm, onTap: () async { if (await confirmDialog(context, 'إعادة ضبط الجهاز', 'سيُطلب رمز الفرع من جديد.', danger: true)) app.resetDevice(); }),
        ]),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          if (app.error != null) Padding(padding: const EdgeInsets.only(bottom: 14), child: Text(app.error!, textAlign: TextAlign.center, style: tx(Fs.sm, w: 700, color: Z8.ember))),
          if (app.cashiers.isEmpty)
            Z8Card(child: Center(child: Text('لا يوجد كاشيرون في هذا الفرع بعد', style: tx(Fs.md, color: Z8.textDim))))
          else
            Wrap(spacing: 14, runSpacing: 14, alignment: WrapAlignment.center, children: [
              for (final c in app.cashiers)
                SizedBox(
                  width: 160,
                  child: Opacity(
                    opacity: c.hasPin ? 1 : .5,
                    child: Material(
                      color: Z8.ink2,
                      shape: const RoundedRectangleBorder(side: BorderSide(color: Z8.line), borderRadius: BorderRadius.zero),
                      elevation: 0,
                      child: InkWell(
                        onTap: c.hasPin ? () => app.pick(c) : () => showToast(context, 'لم يُضبط رمز لهذا الكاشير — اطلب من المدير ضبطه', error: true),
                        child: Padding(
                          padding: const EdgeInsets.symmetric(vertical: 22, horizontal: 12),
                          child: Column(children: [
                            Container(width: 64, height: 64, decoration: const BoxDecoration(color: Z8.petrolSoft, shape: BoxShape.circle), alignment: Alignment.center, child: Text(c.initial, style: tx(Fs.x3, w: 800, color: Z8.petrol))),
                            const SizedBox(height: 12),
                            Text(c.fullName, textAlign: TextAlign.center, maxLines: 2, overflow: TextOverflow.ellipsis, style: tx(Fs.md, w: 800)),
                            if (!c.hasPin) Padding(padding: const EdgeInsets.only(top: 6), child: Text('بلا رمز', style: tx(Fs.xs, color: Z8.textDim))),
                          ]),
                        ),
                      ),
                    ),
                  ),
                ),
            ]),
        ]),
      ),
    );
  }
}
