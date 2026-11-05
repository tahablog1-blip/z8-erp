import 'dart:async';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:video_player/video_player.dart';
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
  final muted = ValueNotifier<bool>(true);       // يبدأ مكتوماً (التشغيل التلقائي يتطلب ذلك)
  final _failed = <int>{};                       // إعلانات فيديو تعذّر تشغيلها: تُعامل كصورة
  Timer? _t;
  int _i = 0, _waited = 0;

  bool _isLiveVideo(int i) => widget.ads[i].video != null && !_failed.contains(i);

  void _next() {
    if (!_c.hasClients || widget.ads.length < 2) return;
    _waited = 0;
    _c.animateToPage((_i + 1) % widget.ads.length, duration: const Duration(milliseconds: 450), curve: Curves.easeInOut);
  }

  @override
  void initState() {
    super.initState();
    if (Motion.enabled && widget.ads.length > 1) {
      _t = Timer.periodic(const Duration(seconds: 1), (_) {
        _waited++;
        // الصورة 5 ثوانٍ؛ الفيديو يكمل حتى ينتهي (أقصى 40 ثانية احتياطاً)
        if (_isLiveVideo(_i) ? _waited >= 40 : _waited >= 5) _next();
      });
    }
  }

  @override
  void dispose() {
    _t?.cancel();
    _c.dispose();
    muted.dispose();
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
            onPageChanged: (i) => setState(() { _i = i; _waited = 0; }),
            itemBuilder: (_, i) {
              final a = widget.ads[i];
              return GestureDetector(
                onTap: a.link.isEmpty ? null : () => _open(a),
                child: Container(
                  margin: const EdgeInsets.symmetric(horizontal: 2),
                  clipBehavior: Clip.antiAlias,
                  decoration: BoxDecoration(border: Border.all(color: Z8.line), boxShadow: Z8.shadowCard),
                  child: Stack(fit: StackFit.expand, children: [
                    if (a.video != null && !_failed.contains(i))
                      AdVideo(
                        url: '${Config.apiBase}${a.video}', active: i == _i, muted: muted, loop: widget.ads.length == 1,
                        poster: a.image == null ? null : '${Config.apiBase}${a.image}',
                        onEnded: _next, onFailed: () { if (mounted) setState(() => _failed.add(i)); },
                      )
                    else if (a.image != null)
                      Image.network('${Config.apiBase}${a.image}', fit: BoxFit.cover, errorBuilder: (_, _, _) => const BrandBackdrop())
                    else
                      const BrandBackdrop(),
                    const DecoratedBox(decoration: BoxDecoration(gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [Color(0x00000000), Color(0xCC0B2F67)]))),
                    if (a.video != null && !_failed.contains(i))
                      Positioned.directional(
                        textDirection: Directionality.of(context), end: 8, top: 8,
                        child: ValueListenableBuilder<bool>(
                          valueListenable: muted,
                          builder: (_, m, _) => Material(
                            color: const Color(0x99000000), shape: const CircleBorder(),
                            child: IconButton(
                              key: const ValueKey('ad-mute'), visualDensity: VisualDensity.compact,
                              icon: Icon(m ? Icons.volume_off : Icons.volume_up, color: Colors.white, size: 20),
                              onPressed: () => muted.value = !m,      // الوحيد المتاح للمستخدم: كتم / تشغيل الصوت
                            ),
                          ),
                        ),
                      ),
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


/// فيديو إعلان: يعمل تلقائياً بلا أي تحكم بالتقدم (لا شريط ولا تقديم/تأخير ولا إيقاف) — الصوت فقط عبر [muted].
class AdVideo extends StatefulWidget {
  const AdVideo({super.key, required this.url, required this.active, required this.muted, required this.loop, required this.onEnded, required this.onFailed, this.poster});
  final String url;
  final String? poster;
  final bool active, loop;
  final ValueNotifier<bool> muted;
  final VoidCallback onEnded, onFailed;
  static bool enabled = true;          // الاختبارات توقفه (لا منصة فيديو في بيئة الاختبار)
  @override
  State<AdVideo> createState() => _AdVideoState();
}

class _AdVideoState extends State<AdVideo> with WidgetsBindingObserver {
  VideoPlayerController? _vc;
  bool _ready = false, _ended = false, _appPaused = false, _tickerOn = true;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    widget.muted.addListener(_applyVolume);
    if (AdVideo.enabled) _init();
  }

  Future<void> _init() async {
    final c = VideoPlayerController.networkUrl(Uri.parse(widget.url), videoPlayerOptions: VideoPlayerOptions(mixWithOthers: true));
    _vc = c;
    try {
      await c.initialize();
      if (!mounted) return;
      await c.setLooping(widget.loop);
      await c.setVolume(widget.muted.value ? 0 : 1);
      c.addListener(_tick);
      setState(() => _ready = true);
      _sync();
    } catch (_) {
      if (mounted) widget.onFailed();
    }
  }

  void _tick() {
    final c = _vc;
    if (c == null || !c.value.isInitialized || widget.loop || _ended) return;
    if (c.value.duration > Duration.zero && c.value.position >= c.value.duration - const Duration(milliseconds: 250)) {
      _ended = true;
      widget.onEnded();
    }
  }

  void _applyVolume() => _vc?.setVolume(widget.muted.value ? 0 : 1);

  /// يعمل فقط لو الإعلان ظاهر الآن والتبويب/الشاشة أمامية والتطبيق نشط — وإلا يتوقف (فلا يُسمع صوته من تبويب آخر)
  void _sync() {
    final c = _vc;
    if (c == null || !_ready) return;
    if (widget.active && _tickerOn && !_appPaused) {
      if (_ended) { _ended = false; c.seekTo(Duration.zero); }
      c.play();
    } else {
      c.pause();
    }
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final on = TickerMode.valuesOf(context).enabled;
    if (on != _tickerOn) {
      _tickerOn = on;
      _sync();
    }
  }

  @override
  void didUpdateWidget(AdVideo old) {
    super.didUpdateWidget(old);
    if (old.active != widget.active) _sync();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState s) {
    _appPaused = s != AppLifecycleState.resumed;
    _sync();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    widget.muted.removeListener(_applyVolume);
    _vc?.removeListener(_tick);
    _vc?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = _vc;
    if (_ready && c != null) {
      return IgnorePointer(     // لا لمس على الفيديو: لا إيقاف ولا تمرير
        child: FittedBox(fit: BoxFit.cover, clipBehavior: Clip.hardEdge, child: SizedBox(width: c.value.size.width, height: c.value.size.height, child: VideoPlayer(c))),
      );
    }
    return widget.poster != null
        ? Image.network(widget.poster!, fit: BoxFit.cover, errorBuilder: (_, _, _) => const BrandBackdrop())
        : const BrandBackdrop();
  }
}
