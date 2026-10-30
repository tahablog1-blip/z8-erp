// lib/screens/pin_screen.dart — رمز الكاشير الخاص (4–8 أرقام)
import 'package:flutter/material.dart';
import '../core/theme.dart';
import '../core/z8_widgets.dart';
import '../state/app_state.dart';
import 'shell_frame.dart';

class PinScreen extends StatefulWidget {
  const PinScreen({super.key, required this.app});
  final AppState app;
  @override
  State<PinScreen> createState() => _PinScreenState();
}

class _PinScreenState extends State<PinScreen> {
  String pin = '';
  static const maxLen = 8, minLen = 4;

  Future<void> _submit() async {
    if (pin.length < minLen || widget.app.busy) return;
    await widget.app.loginCashier(pin);
    if (mounted && widget.app.error != null) setState(() => pin = '');
  }

  @override
  Widget build(BuildContext context) {
    final c = widget.app.picked!;
    return ListenableBuilder(
      listenable: widget.app,
      builder: (context, _) => AuthFrame(
        footer: Center(child: Z8Button('رجوع للبطاقات', icon: Icons.arrow_forward_rounded, variant: BtnVariant.ghost, height: 40, size: Fs.sm, onTap: widget.app.backToCards)),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Container(width: 72, height: 72, decoration: const BoxDecoration(color: Z8.petrolSoft, shape: BoxShape.circle), alignment: Alignment.center, child: Text(c.initial, style: tx(Fs.x3, w: 800, color: Z8.petrol))),
          const SizedBox(height: 12),
          Text(c.fullName, style: tx(Fs.xl, w: 800)),
          const SizedBox(height: 4),
          Text('أدخل رمزك', style: tx(Fs.md, color: Z8.textDim)),
          const SizedBox(height: 18),
          SizedBox(
            height: 30,
            child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
              for (var i = 0; i < (pin.isEmpty ? minLen : pin.length); i++)
                Container(margin: const EdgeInsets.symmetric(horizontal: 6), width: 16, height: 16, decoration: BoxDecoration(shape: BoxShape.circle, color: i < pin.length ? Z8.petrol : Colors.transparent, border: Border.all(color: i < pin.length ? Z8.petrol : Z8.line, width: 2))),
            ]),
          ),
          SizedBox(height: 40, child: Center(child: widget.app.error != null ? Text(widget.app.error!, textAlign: TextAlign.center, style: tx(Fs.sm, w: 700, color: Z8.ember)) : null)),
          Directionality(
            textDirection: TextDirection.ltr,
            child: Numpad(
              onDigit: (d) { if (pin.length < maxLen && !widget.app.busy) setState(() => pin += d); },
              onBackspace: () => setState(() { if (pin.isNotEmpty) pin = pin.substring(0, pin.length - 1); }),
              onClear: () => setState(() => pin = ''),
            ),
          ),
          const SizedBox(height: 10),
          SizedBox(width: 3 * 86.0, child: Z8Button('دخول', busy: widget.app.busy, expand: true, height: 52, onTap: pin.length >= minLen ? _submit : null)),
        ]),
      ),
    );
  }
}
