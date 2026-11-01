import 'dart:async';
import 'package:flutter/material.dart';
import '../core/theme.dart';
import '../core/widgets.dart';
import '../state/app_state.dart';

/// التحقق برقم الجوال: إرسال رمز ثم إدخاله. يرجع true عند النجاح.
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key, required this.state});
  final AppState state;
  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final phone = TextEditingController(), code = TextEditingController();
  bool sent = false, busy = false;
  String? err;
  int wait = 0;
  Timer? _t;

  @override
  void dispose() { _t?.cancel(); super.dispose(); }

  String get _p => arabicDigitsToLatin(phone.text).replaceAll(RegExp(r'[^0-9+]'), '');

  void _tick(int s) {
    _t?.cancel();
    setState(() => wait = s);
    _t = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted) return t.cancel();
      setState(() => wait = wait > 0 ? wait - 1 : 0);
      if (wait == 0) t.cancel();
    });
  }

  Future<void> _send() async {
    if (_p.length < 9) return setState(() => err = 'أدخل رقم جوال صحيح');
    setState(() { busy = true; err = null; });
    final e = await widget.state.sendOtp(_p);
    if (!mounted) return;
    setState(() { busy = false; err = e; if (e == null) sent = true; });
    if (e == null) _tick(60);
  }

  Future<void> _verify() async {
    setState(() { busy = true; err = null; });
    final e = await widget.state.verifyOtp(_p, arabicDigitsToLatin(code.text.trim()));
    if (!mounted) return;
    if (e == null) {
      Navigator.of(context).pop(true);
    } else {
      setState(() { busy = false; err = e; });
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: Text('تأكيد رقم الجوال', style: tx(Fs.lg, w: 900)), backgroundColor: Z8.ink2, surfaceTintColor: Colors.transparent),
        body: SafeArea(
          child: ListView(padding: const EdgeInsets.all(20), children: [
            Text(sent ? 'أدخل الرمز الذي وصلك' : 'سنرسل لك رمز تحقق على جوالك لحماية بيانات سياراتك.', style: tx(Fs.sm, color: Z8.textDim)),
            const SizedBox(height: 16),
            Z8Field(label: 'رقم الجوال', controller: phone, keyboard: TextInputType.phone, ltr: true, hint: '05xxxxxxxx', maxLength: 15),
            if (sent) ...[
              const SizedBox(height: 12),
              Z8Field(label: 'رمز التحقق', controller: code, keyboard: TextInputType.number, ltr: true, maxLength: 8, textAlign: TextAlign.center),
            ],
            if (err != null) ...[const SizedBox(height: 12), ErrorBar(err!)],
            const SizedBox(height: 16),
            Z8Button(sent ? 'تحقق' : 'إرسال الرمز', busy: busy, onTap: sent ? _verify : _send),
            if (sent) ...[
              const SizedBox(height: 8),
              Z8Button(wait > 0 ? 'إعادة الإرسال بعد $wait ث' : 'إعادة إرسال الرمز', outline: true, onTap: wait > 0 || busy ? null : _send),
            ],
          ]),
        ),
      );
}
