// lib/screens/pos/shift_widgets.dart — حالة الجلسة + قائمة الترس (استمرار الجلسة / تسجيل الخروج / إغلاق الجلسة) + فتح الجلسة
import 'package:flutter/material.dart';
import '../../core/theme.dart';
import '../../core/z8_widgets.dart';
import '../../state/app_state.dart';
import 'pos_controller.dart';

class SessionPill extends StatelessWidget {
  const SessionPill({super.key, required this.pos, required this.app});
  final PosController pos;
  final AppState app;
  @override
  Widget build(BuildContext context) {
    final open = pos.shift != null;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(color: Z8.ink3, border: Border.all(color: Z8.line)),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        Container(width: 10, height: 10, decoration: BoxDecoration(shape: BoxShape.circle, color: open ? Z8.emerald : Z8.brass)),
        const SizedBox(width: 8),
        Text(open ? 'الجلسة: نشطة' : 'لا توجد جلسة', style: tx(Fs.sm, w: 800)),
      ]),
    );
  }
}

class GearButton extends StatelessWidget {
  const GearButton({super.key, required this.pos, required this.app});
  final PosController pos;
  final AppState app;
  @override
  Widget build(BuildContext context) => IconButton(
        tooltip: 'الإعدادات — الجلسة',
        icon: const Icon(Icons.settings_rounded, size: 26, color: Z8.textDim),
        onPressed: () => showGeneralDialog(
          context: context, barrierDismissible: true, barrierLabel: 'إغلاق', barrierColor: const Color(0x33000000),
          pageBuilder: (c, _, _) => Align(alignment: Alignment.topLeft, child: Padding(padding: const EdgeInsets.only(top: 62, left: 14), child: Material(color: Colors.transparent, child: GearMenu(pos: pos, app: app)))),
        ),
      );
}

class GearMenu extends StatelessWidget {
  const GearMenu({super.key, required this.pos, required this.app});
  final PosController pos;
  final AppState app;

  @override
  Widget build(BuildContext context) {
    final s = pos.shift;
    return Container(
      width: 380, padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(color: Z8.ink2, border: Border.all(color: Z8.line), boxShadow: Z8.shadowPanel),
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Container(
          padding: const EdgeInsets.all(12), color: Z8.ink3,
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Container(width: 10, height: 10, decoration: BoxDecoration(shape: BoxShape.circle, color: s != null ? Z8.emerald : Z8.brass)),
              const SizedBox(width: 8),
              Expanded(child: Text(s != null ? 'جلسة ${s.branchName} — نشطة' : 'لا توجد جلسة مفتوحة', style: tx(Fs.sm, w: 800))),
            ]),
            if (s != null) Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text('فتحها: ${s.userName}  ·  ${s.invoiceCount} فاتورة', style: tx(Fs.xs, color: Z8.textDim)),
            ),
            const SizedBox(height: 10),
            if (s != null) ...[
              Z8Button('استمرار الجلسة', icon: Icons.play_arrow_rounded, variant: BtnVariant.soft, expand: true, height: 40, size: Fs.sm, onTap: () => Navigator.pop(context)),
              const SizedBox(height: 8),
              Row(children: [
                Expanded(child: Z8Button('تسجيل الخروج', icon: Icons.logout_rounded, variant: BtnVariant.ghost, height: 40, size: Fs.sm, hPad: 8, onTap: () async {
                  Navigator.pop(context);
                  await app.logout();
                })),
                const SizedBox(width: 8),
                Expanded(child: Z8Button('إغلاق الجلسة', icon: Icons.lock_rounded, variant: BtnVariant.danger, height: 40, size: Fs.sm, hPad: 8, onTap: () { Navigator.pop(context); showCloseShiftDialog(context, pos, app); })),
              ]),
            ] else
              Z8Button('تسجيل الخروج', icon: Icons.logout_rounded, variant: BtnVariant.ghost, expand: true, height: 40, size: Fs.sm, onTap: () async { Navigator.pop(context); await app.logout(); }),
          ]),
        ),
        const SizedBox(height: 10),
        Text('تسجيل الخروج لا يغلق الجلسة — يستطيع كاشير آخر الدخول باسمه ومتابعة نفس الجلسة.', style: tx(Fs.xs, color: Z8.textDim, h: 1.5)),
      ]),
    );
  }
}

/// إغلاق أعمى: لا يظهر للكاشير النقد المتوقع — يعدّ ويدخل المبلغ فقط
Future<void> showCloseShiftDialog(BuildContext context, PosController pos, AppState app) async {
  final cash = TextEditingController(), notes = TextEditingController();
  String? err; bool busy = false;
  await showDialog<void>(
    context: context,
    builder: (c) => StatefulBuilder(builder: (c, set) => AlertDialog(
      title: Text('إغلاق الجلسة', style: tx(Fs.lg, w: 800)),
      content: SizedBox(width: 420, child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Container(padding: const EdgeInsets.all(12), color: Z8.ink3, child: Text('عُدّ النقد في الدرج وأدخل المبلغ كما هو — لا يظهر لك المبلغ المتوقع.', style: tx(Fs.sm, color: Z8.textDim, h: 1.5))),
        const SizedBox(height: 14),
        Z8Field(label: 'النقد المعدود فعلياً', controller: cash, keyboard: const TextInputType.numberWithOptions(decimal: true), autofocus: true),
        const SizedBox(height: 12),
        Z8Field(label: 'ملاحظات', controller: notes),
        if (err != null) Padding(padding: const EdgeInsets.only(top: 10), child: Text(err!, style: tx(Fs.sm, w: 700, color: Z8.ember))),
      ])),
      actions: [
        Z8Button('إلغاء', variant: BtnVariant.ghost, onTap: () => Navigator.pop(c)),
        Z8Button('تأكيد الإغلاق', busy: busy, variant: BtnVariant.danger, onTap: cash.text.trim().isEmpty && !busy ? null : () async {
          set(() { busy = true; err = null; });
          final e = await pos.closeShift(double.tryParse(cash.text.trim()) ?? 0, notes.text.trim().isEmpty ? null : notes.text.trim());
          if (e != null) { set(() { busy = false; err = e; }); return; }
          if (c.mounted) Navigator.pop(c);
          await app.logout();            // بعد الإغلاق نعود لبطاقات الكاشيرين
        }),
      ],
    )),
  );
}

class OpenShiftCard extends StatefulWidget {
  const OpenShiftCard({super.key, required this.pos});
  final PosController pos;
  @override
  State<OpenShiftCard> createState() => _OpenShiftCardState();
}

class _OpenShiftCardState extends State<OpenShiftCard> {
  final cash = TextEditingController(text: '0');
  String? err; bool busy = false;
  @override
  Widget build(BuildContext context) => Center(
        child: SizedBox(width: 460, child: Z8Card(
          padding: const EdgeInsets.all(24),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Row(children: [
              Container(width: 48, height: 48, color: Z8.petrolSoft, child: const Icon(Icons.lock_open_rounded, color: Z8.petrol, size: 26)),
              const SizedBox(width: 14),
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('افتح جلسة', style: tx(Fs.xl, w: 800)),
                Text('لازم تفتح جلسة قبل ما تقدر تصدر فواتير', style: tx(Fs.sm, color: Z8.textDim)),
              ])),
            ]),
            const SizedBox(height: 20),
            Z8Field(label: 'العهدة الافتتاحية بالدرج (ر.س)', controller: cash, keyboard: const TextInputType.numberWithOptions(decimal: true)),
            if (err != null) Padding(padding: const EdgeInsets.only(top: 10), child: Text(err!, style: tx(Fs.sm, w: 700, color: Z8.ember))),
            const SizedBox(height: 18),
            Z8Button('فتح الجلسة', busy: busy, height: 50, expand: true, onTap: () async {
              setState(() { busy = true; err = null; });
              final e = await widget.pos.openShift(double.tryParse(cash.text.trim()) ?? 0);
              if (mounted) setState(() { busy = false; err = e; });
            }),
          ]),
        )),
      );
}
