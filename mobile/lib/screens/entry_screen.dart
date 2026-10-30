// lib/screens/entry_screen.dart — إدخال رمز من 9 أرقام (تفعيل الجهاز برمز الفرع، أو فتح قسم برمزه)
import 'package:flutter/material.dart';
import '../core/theme.dart';
import '../core/z8_widgets.dart';
import '../state/app_state.dart';
import 'shell_frame.dart';

class EntryScreen extends StatefulWidget {
  const EntryScreen({super.key, required this.app, this.asOverlay = false});
  final AppState app;
  final bool asOverlay;      // فوق بطاقات الكاشيرين (رمز قسم آخر)
  @override
  State<EntryScreen> createState() => _EntryScreenState();
}

class _EntryScreenState extends State<EntryScreen> {
  String code = '';
  static const len = 9;

  void _digit(String d) {
    if (widget.app.busy || code.length >= len) return;
    setState(() => code += d);
    if (code.length == len) widget.app.enterCode(code).then((_) { if (mounted && widget.app.error != null) setState(() => code = ''); });
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: widget.app,
      builder: (context, _) => AuthFrame(
        title: widget.asOverlay ? 'رمز قسم' : 'تفعيل الجهاز',
        subtitle: widget.asOverlay ? 'أدخل رمز القسم (9 أرقام): ملاحظات الخدمة، تسجيل السيارات، أمر العمل' : 'أدخل رمز الفرع المكوّن من 9 أرقام',
        footer: widget.asOverlay ? Center(child: Z8Button('رجوع', variant: BtnVariant.ghost, onTap: widget.app.closeOtherCode)) : null,
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Directionality(
            textDirection: TextDirection.ltr,
            child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
              for (var i = 0; i < len; i++)
                Container(
                  width: 40, height: 52, margin: const EdgeInsets.symmetric(horizontal: 3),
                  decoration: BoxDecoration(color: Z8.ink2, border: Border.all(color: i == code.length ? Z8.petrol : Z8.line, width: i == code.length ? 2 : 1)),
                  alignment: Alignment.center,
                  child: i < code.length ? Container(width: 10, height: 10, decoration: const BoxDecoration(color: Z8.petrol, shape: BoxShape.circle)) : null,
                ),
            ]),
          ),
          SizedBox(height: 44, child: Center(child: widget.app.busy
              ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2.5, color: Z8.petrol))
              : (widget.app.error != null ? Text(widget.app.error!, textAlign: TextAlign.center, style: tx(Fs.sm, w: 700, color: Z8.ember)) : null))),
          Directionality(textDirection: TextDirection.ltr, child: Numpad(onDigit: _digit, onBackspace: () => setState(() { if (code.isNotEmpty) code = code.substring(0, code.length - 1); }), onClear: () => setState(() => code = ''))),
        ]),
      ),
    );
  }
}
