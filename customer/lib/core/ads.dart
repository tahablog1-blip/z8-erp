import 'dart:async';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../models.dart';
import 'brand.dart';
import 'config.dart';
import 'theme.dart';
import 'widgets.dart';

/// شريط إعلانات متحرك في الرئيسية: صورة (اختيارية) + عنوان + نص، ينتقل تلقائياً، والضغط يفتح الرابط إن وُجد
class AdsCarousel extends StatefulWidget {
  const AdsCarousel(this.ads, {super.key});
  final List<Ad> ads;
  @override
  State<AdsCarousel> createState() => _AdsCarouselState();
}

class _AdsCarouselState extends State<AdsCarousel> {
  final _c = PageController();
  Timer? _t;
  int _i = 0;

  @override
  void initState() {
    super.initState();
    if (Motion.enabled && widget.ads.length > 1) {
      _t = Timer.periodic(const Duration(seconds: 5), (_) {
        if (!_c.hasClients) return;
        _c.animateToPage((_i + 1) % widget.ads.length, duration: const Duration(milliseconds: 450), curve: Curves.easeInOut);
      });
    }
  }

  @override
  void dispose() {
    _t?.cancel();
    _c.dispose();
    super.dispose();
  }

  Future<void> _open(Ad a) async {
    final u = Uri.tryParse(a.link);
    if (u != null && (u.scheme == 'http' || u.scheme == 'https')) await launchUrl(u, mode: LaunchMode.externalApplication);
  }

  @override
  Widget build(BuildContext context) => Column(children: [
        SizedBox(
          height: 160,
          child: PageView.builder(
            controller: _c,
            itemCount: widget.ads.length,
            onPageChanged: (i) => setState(() => _i = i),
            itemBuilder: (_, i) {
              final a = widget.ads[i];
              return GestureDetector(
                onTap: a.link.isEmpty ? null : () => _open(a),
                child: Container(
                  margin: const EdgeInsets.symmetric(horizontal: 2),
                  clipBehavior: Clip.antiAlias,
                  decoration: BoxDecoration(border: Border.all(color: Z8.line), boxShadow: Z8.shadowCard),
                  child: Stack(fit: StackFit.expand, children: [
                    if (a.image != null)
                      Image.network('${Config.apiBase}${a.image}', fit: BoxFit.cover, errorBuilder: (_, _, _) => const BrandBackdrop())
                    else
                      const BrandBackdrop(),
                    const DecoratedBox(decoration: BoxDecoration(gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [Color(0x00000000), Color(0xCC0B2F67)]))),
                    Positioned.directional(
                      textDirection: Directionality.of(context), start: 14, end: 14, bottom: 12,
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
                        Text(a.title, maxLines: 2, overflow: TextOverflow.ellipsis, style: tx(Fs.lg, w: 900, color: Colors.white)),
                        if (a.body.isNotEmpty) Text(a.body, maxLines: 2, overflow: TextOverflow.ellipsis, style: tx(Fs.sm, w: 600, color: Colors.white)),
                      ]),
                    ),
                  ]),
                ),
              );
            },
          ),
        ),
        if (widget.ads.length > 1) ...[
          const SizedBox(height: 8),
          Row(mainAxisAlignment: MainAxisAlignment.center, children: [
            for (var k = 0; k < widget.ads.length; k++)
              AnimatedContainer(duration: const Duration(milliseconds: 250), margin: const EdgeInsets.symmetric(horizontal: 3), width: k == _i ? 18 : 7, height: 7, color: k == _i ? Z8.petrol : Z8.line),
          ]),
        ],
      ]);
}
