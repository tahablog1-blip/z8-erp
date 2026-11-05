import 'package:flutter/material.dart';
import '../core/brand.dart';
import '../core/config.dart';
import '../core/i18n.dart';
import '../core/theme.dart';
import '../core/widgets.dart';
import '../models.dart';

/// بطاقة المنتج المتحركة: صورة المنتج تدخل بحركة، شرائط القوة تمتلئ تباعاً، ثم نقاط القوة و«يصلح لـ».
/// ترجع المنتج عند «اختيار هذا الزيت».
class ProductCardScreen extends StatefulWidget {
  const ProductCardScreen({super.key, required this.product});
  final OilProduct product;
  @override
  State<ProductCardScreen> createState() => _ProductCardScreenState();
}

class _ProductCardScreenState extends State<ProductCardScreen> with TickerProviderStateMixin {
  late final AnimationController _in = AnimationController(vsync: this, duration: const Duration(milliseconds: 2800));
  late final AnimationController _glow = AnimationController(vsync: this, duration: const Duration(seconds: 3));

  @override
  void initState() {
    super.initState();
    if (Motion.enabled) {
      _in.forward();
      _glow.repeat(reverse: true);
    } else {
      _in.value = 1;
    }
  }

  @override
  void dispose() {
    _in.dispose();
    _glow.dispose();
    super.dispose();
  }

  /// جزء من الزمن الكلي للحركة: يبدأ عند [a] وينتهي عند [b] (0..1)
  Animation<double> _seg(double a, double b, [Curve c = Curves.easeOutCubic]) => CurvedAnimation(parent: _in, curve: Interval(a, b, curve: c));

  Widget _fadeUp(Animation<double> a, Widget child) => AnimatedBuilder(
        animation: a,
        builder: (_, w) => Opacity(opacity: a.value.clamp(0, 1), child: Transform.translate(offset: Offset(0, 18 * (1 - a.value)), child: w)),
        child: child,
      );

  @override
  Widget build(BuildContext context) {
    final o = widget.product, c = o.card;
    final baseLabel = switch (c?.baseType) { 'synthetic' => tr('صناعي بالكامل'), 'semi' => tr('نصف صناعي'), 'mineral' => tr('معدني'), _ => null };
    final rates = [
      if (c != null && c.protection > 0) (tr('الحماية'), c.protection),
      if (c != null && c.economy > 0) (tr('توفير الوقود'), c.economy),
      if (c != null && c.heat > 0) (tr('تحمّل الحرارة'), c.heat),
    ];
    final img = absUrl(c?.gif ?? o.image);      // GIF المتحرك يحل محل الصورة الثابتة
    return Scaffold(
      appBar: AppBar(title: Text(tr('تفاصيل المنتج'), style: tx(Fs.lg, w: 900)), backgroundColor: Z8.ink2, surfaceTintColor: Colors.transparent),
      body: SafeArea(
        child: Column(children: [
          Expanded(
            child: ListView(padding: EdgeInsets.zero, children: [
              // ── الغلاف: صورة المنتج تدخل مكبّرة مع هالة نابضة ──
              SizedBox(
                height: 250,
                child: Stack(fit: StackFit.expand, children: [
                  const BrandBackdrop(),
                  Center(
                    child: AnimatedBuilder(
                      animation: _glow,
                      builder: (_, _) => Container(
                        width: 170 + 26 * _glow.value, height: 170 + 26 * _glow.value,
                        decoration: BoxDecoration(shape: BoxShape.circle, color: Colors.white.withValues(alpha: .10 + .08 * _glow.value)),
                      ),
                    ),
                  ),
                  Center(
                    child: AnimatedBuilder(
                      animation: _seg(0, .35, Curves.easeOutBack),
                      builder: (_, child) {
                        final v = _seg(0, .35, Curves.easeOutBack).value;
                        return Transform.rotate(angle: -.35 * (1 - v), child: Transform.scale(scale: .4 + .6 * v, child: Opacity(opacity: v.clamp(0, 1), child: child)));
                      },
                      child: SizedBox(
                        height: 190,
                        child: img == null
                            ? const Icon(Icons.oil_barrel_outlined, size: 96, color: Colors.white)
                            : Image.network(img, fit: BoxFit.contain, gaplessPlayback: true, errorBuilder: (_, _, _) => const Icon(Icons.oil_barrel_outlined, size: 96, color: Colors.white)),
                      ),
                    ),
                  ),
                ]),
              ),
              Padding(
                padding: const EdgeInsets.all(16),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  _fadeUp(_seg(.25, .5), Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(o.name, style: tx(Fs.xl, w: 900)),
                    const SizedBox(height: 8),
                    Wrap(spacing: 8, runSpacing: 8, children: [
                      if (c != null && c.viscosity.isNotEmpty) _Pill(c.viscosity, strong: true),
                      if (c != null && c.standard.isNotEmpty) _Pill(c.standard),
                      if (baseLabel != null) _Pill(baseLabel),
                    ]),
                  ])),
                  if (c != null && c.description.isNotEmpty) ...[
                    const SizedBox(height: 14),
                    _fadeUp(_seg(.35, .55), Text(c.description, style: tx(Fs.md, h: 1.6))),
                  ],
                  if (rates.isNotEmpty) ...[
                    const SizedBox(height: 22),
                    _fadeUp(_seg(.4, .6), Text(tr('مواصفات المنتج'), style: tx(Fs.md, w: 900, color: Z8.petrolDeep))),
                    const SizedBox(height: 10),
                    for (var i = 0; i < rates.length; i++)
                      Padding(padding: const EdgeInsets.only(bottom: 12), child: _Bar(rates[i].$1, rates[i].$2, _seg(.45 + i * .1, .75 + i * .08))),
                  ],
                  if (c != null && c.strengths.isNotEmpty) ...[
                    const SizedBox(height: 14),
                    _fadeUp(_seg(.6, .75), Text(tr('قوة المنتج'), style: tx(Fs.md, w: 900, color: Z8.petrolDeep))),
                    const SizedBox(height: 8),
                    for (var i = 0; i < c.strengths.length; i++)
                      _fadeUp(_seg(.62 + i * .06, .82 + i * .04), Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          const Icon(Icons.check_circle, size: 20, color: Z8.emerald),
                          const SizedBox(width: 8),
                          Expanded(child: Text(c.strengths[i], style: tx(Fs.md, w: 700))),
                        ]),
                      )),
                  ],
                  if (c != null && c.suitableFor.isNotEmpty) ...[
                    const SizedBox(height: 14),
                    _fadeUp(_seg(.8, .92), Text(tr('يصلح لـ'), style: tx(Fs.md, w: 900, color: Z8.petrolDeep))),
                    const SizedBox(height: 8),
                    Wrap(spacing: 8, runSpacing: 8, children: [
                      for (var i = 0; i < c.suitableFor.length; i++) _fadeUp(_seg(.82 + i * .02, .96), _Pill(c.suitableFor[i], soft: true)),
                    ]),
                  ],
                  const SizedBox(height: 16),
                  Text(tr('هذا السعر غير نهائي — قد تُضاف أصناف أو خدمات أخرى داخل الفرع بعد فحص السيارة، ويُحدَّد السعر النهائي عند إصدار الفاتورة.'), style: tx(Fs.xs, color: Z8.textDim)),
                ]),
              ),
            ]),
          ),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: const BoxDecoration(color: Z8.ink2, border: Border(top: BorderSide(color: Z8.line))),
            child: Row(children: [
              Text(tr('{0} ر.س', [o.price.toStringAsFixed(2)]), style: tx(Fs.lg, w: 900, color: Z8.petrolDeep, tnum: true)),
              const SizedBox(width: 12),
              Expanded(child: Z8Button(o.inStock ? tr('اختيار هذا الزيت') : tr('غير متوفر الآن'), icon: Icons.check, onTap: o.inStock ? () => Navigator.pop(context, o) : null)),
            ]),
          ),
        ]),
      ),
    );
  }
}

class _Pill extends StatelessWidget {
  const _Pill(this.text, {this.strong = false, this.soft = false});
  final String text;
  final bool strong, soft;
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(color: strong ? Z8.petrol : (soft ? Z8.petrolSoft : Z8.ink3), border: Border.all(color: strong ? Z8.petrol : Z8.line)),
        child: Text(text, style: tx(Fs.sm, w: 900, color: strong ? Colors.white : Z8.text)),
      );
}

/// شريط قوة 0–5 يمتلئ بحركة
class _Bar extends StatelessWidget {
  const _Bar(this.label, this.value, this.anim);
  final String label;
  final int value;
  final Animation<double> anim;
  @override
  Widget build(BuildContext context) => AnimatedBuilder(
        animation: anim,
        builder: (_, _) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(child: Text(label, style: tx(Fs.sm, w: 800))),
            Text('$value/5', style: tx(Fs.sm, w: 900, color: Z8.petrolDeep, tnum: true)),
          ]),
          const SizedBox(height: 4),
          Row(children: [
            for (var i = 0; i < 5; i++)
              Expanded(
                child: Container(
                  height: 10, margin: const EdgeInsetsDirectional.only(end: 4), color: Z8.ink3,
                  alignment: AlignmentDirectional.centerStart,
                  child: FractionallySizedBox(
                    widthFactor: ((anim.value * 5 - i).clamp(0.0, 1.0)) * (i < value ? 1 : 0),
                    child: Container(color: Z8.petrol),
                  ),
                ),
              ),
          ]),
        ]),
      );
}
