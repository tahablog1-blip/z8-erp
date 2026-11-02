import 'package:flutter/material.dart';
import '../core/brand.dart';
import '../core/i18n.dart';
import '../core/theme.dart';
import '../state/app_state.dart';

/// اختيار اللغة: يظهر أول تشغيل، ويمكن فتحه من القائمة داخل التطبيق لتغييرها
class LanguageScreen extends StatelessWidget {
  const LanguageScreen({super.key, required this.state, this.first = false});
  final AppState state;
  final bool first;

  @override
  Widget build(BuildContext context) => Scaffold(
        body: BrandBackdrop(
          child: SafeArea(
            child: Column(children: [
              if (!first)
                Align(
                  alignment: AlignmentDirectional.centerStart,
                  child: IconButton(onPressed: () => Navigator.of(context).pop(), icon: const Icon(Icons.arrow_back, color: Colors.white)),
                ),
              const Spacer(),
              Image.asset('assets/images/logo-white.png', width: 120, errorBuilder: (_, _, _) => const SizedBox(height: 120)),
              const SizedBox(height: 24),
              // العنوان بكل اللغات معاً حتى يفهمه كل عميل
              Text('اختر لغتك', style: tx(Fs.x2, w: 900, color: Colors.white)),
              Text('Choose your language', style: tx(Fs.md, w: 700, color: Colors.white70)),
              Text('আপনার ভাষা বেছে নিন  ·  अपनी भाषा चुनें  ·  اپنی زبان منتخب کریں', textAlign: TextAlign.center, style: tx(Fs.sm, w: 600, color: Colors.white70)),
              const SizedBox(height: 20),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 28),
                child: Column(children: [
                  for (final l in AppLang.values)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: Material(
                        color: state.lang == l && !first ? Colors.white : const Color(0x26FFFFFF),
                        shape: RoundedRectangleBorder(side: BorderSide(color: state.lang == l && !first ? Colors.white : const Color(0x66FFFFFF))),
                        child: InkWell(
                          key: ValueKey('lang-${l.code}'),
                          onTap: () async {
                            final nav = Navigator.of(context);
                            await state.setLang(l);
                            if (!first && nav.mounted && nav.canPop()) nav.pop();
                          },
                          child: SizedBox(
                            height: 54,
                            child: Center(
                              child: Text(l.nativeName, style: tx(Fs.lg, w: 800, color: state.lang == l && !first ? Z8.petrolDeep : Colors.white)),
                            ),
                          ),
                        ),
                      ),
                    ),
                ]),
              ),
              const Spacer(flex: 2),
            ]),
          ),
        ),
      );
}
