// الهوية البصرية: صورة الفرع بتدرّج أزرق شفاف، وشعار الشركة بحركة «ثعبانية» تكشفه تدريجياً
import 'dart:math' as math;
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'theme.dart';

/// خلفية: صورة داخل الفرع + تدرّج أزرق شفاف (أخف من الأعلى وأعمق نحو الأسفل)
class BrandBackdrop extends StatelessWidget {
  const BrandBackdrop({super.key, this.child, this.height});
  final Widget? child;
  final double? height;
  @override
  Widget build(BuildContext context) => SizedBox(
        height: height,
        width: double.infinity,
        child: Stack(fit: StackFit.expand, children: [
          Image.asset('assets/images/branch-bg.jpg', fit: BoxFit.cover, alignment: Alignment.center, errorBuilder: (_, _, _) => const ColoredBox(color: Z8.sbBg)),
          const DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter, end: Alignment.bottomCenter,
                colors: [Color(0x990B2F67), Color(0x661E3A8A), Color(0xB30B2F67), Color(0xF20B2F67)],
                stops: [0, .35, .7, 1],
              ),
            ),
          ),
          ?child,
        ]),
      );
}

/// شعار الشركة يظهر كاملاً عبر «ثعابين» من أشرطة متعرجة تتحرك وتكشف أجزاءه (مثل After Effects)
class SnakeLogo extends StatefulWidget {
  const SnakeLogo({super.key, this.width = 260, this.duration = const Duration(milliseconds: 2600), this.onDone, this.asset = 'assets/images/logo-white.png'});
  final double width;
  final Duration duration;
  final VoidCallback? onDone;
  final String asset;
  @override
  State<SnakeLogo> createState() => _SnakeLogoState();
}

class _SnakeLogoState extends State<SnakeLogo> with SingleTickerProviderStateMixin {
  late final AnimationController c;
  ui.Image? img;
  bool failed = false;

  @override
  void initState() {
    super.initState();
    c = AnimationController(vsync: this, duration: widget.duration);
    _load();
  }

  Future<void> _load() async {
    try {
      final data = await rootBundle.load(widget.asset);
      final codec = await ui.instantiateImageCodec(data.buffer.asUint8List());
      final frame = await codec.getNextFrame();
      if (!mounted) return;
      setState(() => img = frame.image);
      c.forward().then((_) { if (mounted) widget.onDone?.call(); });   // لا نستدعي onDone عند الإلغاء/التخلص
    } catch (_) {
      if (!mounted) return;
      setState(() => failed = true);   // بلا حركة: نعرض الشعار عادياً ونكمل
      widget.onDone?.call();
    }
  }

  @override
  void dispose() {
    c.dispose();
    img?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final w = widget.width;
    final h = img == null ? w : w * img!.height / img!.width;
    if (failed) return Image.asset(widget.asset, width: w);
    return SizedBox(
      width: w,
      height: h,
      child: img == null
          ? null
          : AnimatedBuilder(animation: c, builder: (_, _) => CustomPaint(painter: _SnakePainter(img!, c.value))),
    );
  }
}

class _SnakePainter extends CustomPainter {
  _SnakePainter(this.img, this.t);
  final ui.Image img;
  final double t;
  static const snakes = 8;

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;
    final src = Rect.fromLTWH(0, 0, img.width.toDouble(), img.height.toDouble());
    if (t >= 1) {
      canvas.drawImageRect(img, src, rect, Paint()..filterQuality = FilterQuality.high);
      return;
    }
    // طبقة الشعار، ثم طبقة القناع (الثعابين) تُدمج عليها بـ dstIn فيبقى من الشعار ما تحت الأشرطة فقط
    canvas.saveLayer(rect, Paint());
    canvas.drawImageRect(img, src, rect, Paint()..filterQuality = FilterQuality.high);
    canvas.saveLayer(rect, Paint()..blendMode = BlendMode.dstIn);
    final band = size.height / snakes;
    for (var i = 0; i < snakes; i++) {
      final delay = i * 0.055;
      final p = Curves.easeInOutCubic.transform(((t - delay) / (1 - delay * snakes * .6)).clamp(0.0, 1.0));
      if (p <= 0) continue;
      final y0 = band * (i + .5);
      final dir = i.isEven ? 1.0 : -1.0;                 // ثعابين تتجه يميناً ويساراً بالتناوب
      final path = Path();
      const steps = 48;
      for (var k = 0; k <= steps; k++) {
        final u = k / steps;
        final x = dir > 0 ? size.width * u : size.width * (1 - u);
        final amp = band * .9 * (1 - u * .3);
        final y = y0 + math.sin(u * math.pi * 3 + i * 1.3 + t * 9) * amp;
        k == 0 ? path.moveTo(x, y) : path.lineTo(x, y);
      }
      final m = path.computeMetrics().first;
      final seg = m.extractPath(0, m.length * p);
      canvas.drawPath(
        seg,
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeCap = StrokeCap.round
          ..strokeJoin = StrokeJoin.round
          ..strokeWidth = band * 2.6
          ..color = Colors.white,
      );
    }
    canvas.restore();
    canvas.restore();
  }

  @override
  bool shouldRepaint(_SnakePainter old) => old.t != t || old.img != img;
}
