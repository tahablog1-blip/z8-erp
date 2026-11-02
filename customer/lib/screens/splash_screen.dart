import 'package:flutter/material.dart';
import '../core/brand.dart';

/// شاشة الافتتاح: صورة الفرع بتدرّج أزرق + الشعار يظهر بحركة ثعبانية. اللمس يتخطّاها.
class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key, required this.onDone});
  final VoidCallback onDone;
  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen> {
  bool fired = false;
  void _done() {
    if (fired || !mounted) return;
    fired = true;
    widget.onDone();
  }

  @override
  Widget build(BuildContext context) {
    final w = MediaQuery.sizeOf(context).width;
    return Scaffold(
      body: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: _done,
        child: BrandBackdrop(
          child: Center(
            child: SnakeLogo(
              width: (w * .62).clamp(180, 340).toDouble(),
              onDone: () => Future.delayed(const Duration(milliseconds: 450), _done),
            ),
          ),
        ),
      ),
    );
  }
}
