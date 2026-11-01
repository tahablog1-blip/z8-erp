import 'package:flutter/material.dart';
import '../core/theme.dart';
import '../core/widgets.dart';
import '../state/app_state.dart';

/// أول تشغيل: لصق رابط الحجز (أو رمز الفرع) الذي يظهر في باركود الفرع
class SetupScreen extends StatefulWidget {
  const SetupScreen({super.key, required this.state});
  final AppState state;
  @override
  State<SetupScreen> createState() => _SetupScreenState();
}

class _SetupScreenState extends State<SetupScreen> {
  final c = TextEditingController();
  String? err;
  bool busy = false;

  Future<void> _go() async {
    setState(() { busy = true; err = null; });
    final e = await widget.state.setBranch(c.text);
    if (mounted) setState(() { busy = false; err = e; });
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        body: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(24),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 420),
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  Image.asset('assets/images/logo-navy.png', height: 64, errorBuilder: (_, _, _) => const SizedBox(height: 64)),
                  const SizedBox(height: 24),
                  Text('اختر فرعك', textAlign: TextAlign.center, style: tx(Fs.x2, w: 900, color: Z8.petrolDeep)),
                  const SizedBox(height: 8),
                  Text('الصق رابط الحجز الموجود على باركود الفرع، أو رمز الفرع.', textAlign: TextAlign.center, style: tx(Fs.sm, color: Z8.textDim)),
                  const SizedBox(height: 20),
                  Z8Field(label: 'رابط الحجز أو رمز الفرع', controller: c, ltr: true, hint: 'https://…/booking/…', keyboard: TextInputType.url),
                  if (err != null) ...[const SizedBox(height: 12), ErrorBar(err!)],
                  const SizedBox(height: 16),
                  Z8Button('متابعة', busy: busy, onTap: _go),
                ]),
              ),
            ),
          ),
        ),
      );
}
