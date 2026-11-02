// الهوية البصرية: صورة الفرع بتدرّج أزرق شفاف، وشعار الشركة بحركة «ثعبانية» تكشفه تدريجياً
import 'dart:math' as math;
import 'dart:ui' as ui;
import 'package:flutter/foundation.dart';
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

/// شعار الشركة: يُرسم بخط واحد متصل يبدأ من أعلى يسار حرف Z ثم يسير على الحرف فالثمانية حتى يكتمل،
/// وبعد الاكتمال تعبر عليه لمعة متحركة كأنه معدن لامع.
class SnakeLogo extends StatefulWidget {
  const SnakeLogo({super.key, this.width = 260, this.duration = const Duration(milliseconds: 2800), this.onDone, this.asset = 'assets/images/logo-white.png'});
  final double width;
  final Duration duration;
  final VoidCallback? onDone;     // عند اكتمال الرسم (واللمعة تستمر بعدها)
  final String asset;
  @override
  State<SnakeLogo> createState() => _SnakeLogoState();
}

class _SnakeLogoState extends State<SnakeLogo> with TickerProviderStateMixin {
  late final AnimationController c;       // مرحلة الرسم 0→1
  late final AnimationController shine;   // اللمعة تتكرر بعد الاكتمال
  ui.Image? img;
  bool failed = false;

  @override
  void initState() {
    super.initState();
    c = AnimationController(vsync: this, duration: widget.duration);
    shine = AnimationController(vsync: this, duration: const Duration(milliseconds: 1900));
    _load();
  }

  Future<void> _load() async {
    try {
      final data = await rootBundle.load(widget.asset);
      final codec = await ui.instantiateImageCodec(data.buffer.asUint8List());
      final frame = await codec.getNextFrame();
      if (!mounted) return;
      setState(() => img = frame.image);
      c.forward().then((_) {
        if (!mounted) return;
        shine.repeat();
        widget.onDone?.call();     // لا يُستدعى عند الإلغاء/التخلص
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => failed = true);   // بلا حركة: نعرض الشعار عادياً ونكمل
      widget.onDone?.call();
    }
  }

  @override
  void dispose() {
    c.dispose();
    shine.dispose();
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
          : AnimatedBuilder(
              animation: Listenable.merge([c, shine]),
              builder: (_, _) => CustomPaint(painter: LogoPainter(img!, c.value, shine.isAnimating ? shine.value : -1)),
            ),
    );
  }
}

/// مسار الرسم بإحداثيات الشعار الأصلي (832×868): نقطة البداية عند طرف الـ Z العلوي الأيسر،
/// ثم الخط العلوي، فالقطر للأسفل، فالخط السفلي، فحلقة الثمانية السفلى، فصعوداً للحلقة العليا.
List<Offset> logoSkeleton() {
  final pts = <Offset>[];
  void line(Offset a, Offset b, [int n = 24]) {
    for (var i = 0; i < n; i++) {
      pts.add(Offset.lerp(a, b, i / n)!);
    }
  }

  void arc(Offset c, double r, double a0, double a1, [int n = 60]) {
    for (var i = 0; i <= n; i++) {
      final a = (a0 + (a1 - a0) * i / n) * math.pi / 180;
      pts.add(Offset(c.dx + r * math.cos(a), c.dy + r * math.sin(a)));
    }
  }

  // مستقيم كل الطريق (خطوط مستقيمة وأنصاف دوائر بلا التواءات)، بنفس ترتيب رسمك:
  line(const Offset(70, 55), const Offset(392, 55));            // الخط العلوي للـ Z (من السهم)
  line(const Offset(392, 55), const Offset(102, 494), 60);      // القطر
  line(const Offset(102, 494), const Offset(480, 494), 40);     // الخط السفلي
  final c2 = const Offset(610, 620), c1 = const Offset(610, 262);
  Offset onC(Offset c, double deg) => Offset(c.dx + 122 * math.cos(deg * math.pi / 180), c.dy + 122 * math.sin(deg * math.pi / 180));
  line(const Offset(480, 494), onC(c2, 190), 8);                // ينزل إلى الجانب الأيسر للحلقة السفلى
  arc(c2, 122, 190, -40, 90);                                   // الحلقة السفلى: يسار ← أسفل ← يمين
  line(onC(c2, -40), onC(c1, 135), 40);                         // الشريط المائل صعوداً لليسار نحو الحلقة العليا
  arc(c1, 122, 135, 410, 80);                                   // الحلقة العليا: يسار ← أعلى ← يمين
  line(onC(c1, 50), const Offset(706, 394), 8);                 // ذيل الشريط المائل في النهاية
  return pts;
}

@visibleForTesting
class LogoPainter extends CustomPainter {
  LogoPainter(this.img, this.t, this.shineT);
  final ui.Image img;
  final double t;        // تقدم الرسم 0→1
  final double shineT;   // موضع اللمعة 0→1، أو سالب = بلا لمعة
  static final Path _unit = _buildUnit();

  static Path _buildUnit() {
    final p = Path();
    final pts = logoSkeleton();
    p.moveTo(pts.first.dx, pts.first.dy);
    for (final o in pts.skip(1)) {
      p.lineTo(o.dx, o.dy);
    }
    return p;
  }

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;
    final src = Rect.fromLTWH(0, 0, img.width.toDouble(), img.height.toDouble());
    final sx = size.width / 832, sy = size.height / 868;
    final logoPaint = Paint()..filterQuality = FilterQuality.high;

    canvas.saveLayer(rect, Paint());
    canvas.drawImageRect(img, src, rect, logoPaint);
    if (t < 1) {
      // قناع الرسم: خط واحد سميك يتقدّم على هيكل الشعار فيُبقي من الشعار ما مرّ عليه فقط
      canvas.saveLayer(rect, Paint()..blendMode = BlendMode.dstIn);
      final m = _unit.transform(Float64List.fromList([sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])).computeMetrics().first;
      final p = Curves.easeInOutCubic.transform(t);
      canvas.drawPath(
        m.extractPath(0, m.length * p),
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeCap = StrokeCap.round
          ..strokeJoin = StrokeJoin.miter       // يكشف الزوايا الحادة للـ Z وهو ماشٍ
          ..strokeWidth = size.width * .142     // بعرض شريط الشعار نفسه: رأس الخط نصف دائرة نظيف ولا يسبق الأجزاء المجاورة
          ..color = Colors.white,
      );
      canvas.restore();
    }
    // معدن: تدرّج فضي خفيف دائماً، وفوقه لمعة بيضاء مائلة تعبر الشعار بعد اكتماله (فقط حيث يوجد الشعار)
    canvas.drawRect(
      rect,
      Paint()
        ..blendMode = BlendMode.srcATop
        ..shader = ui.Gradient.linear(rect.topLeft, rect.bottomRight, const [Color(0xFFE3ECF8), Color(0xFFB4C7E1), Color(0xFFF1F5FB), Color(0xFFA2B8D8)], const [0, .32, .6, 1]),
    );
    if (shineT >= 0 && t >= 1) {
      final span = size.width * 1.7;
      final x = -size.width * .35 + shineT * span;          // مركز اللمعة يتحرك من اليسار لليمين
      final skew = Matrix4.skewX(-.38).storage;             // ميلان اللمعة
      void band(double halfW, List<Color> cols, List<double> stops) {
        canvas.drawRect(
          rect,
          Paint()
            ..blendMode = BlendMode.srcATop
            ..shader = ui.Gradient.linear(Offset(x - halfW, 0), Offset(x + halfW, 0), cols, stops, TileMode.clamp, skew),
        );
      }
      band(size.width * .26, const [Color(0x00FFFFFF), Color(0xCCFFFFFF), Color(0x00FFFFFF)], const [0, .5, 1]);                 // وهج واسع ناعم
      band(size.width * .05, const [Color(0x00FFFFFF), Color(0xFFFFFFFF), Color(0x00FFFFFF)], const [0, .5, 1]);                 // خط لمعان حادّ
    }
    canvas.restore();
  }

  @override
  bool shouldRepaint(LogoPainter old) => old.t != t || old.shineT != shineT || old.img != img;
}
