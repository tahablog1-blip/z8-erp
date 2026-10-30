// lib/app.dart — جذر التطبيق: عربي RTL وتوجيه حسب مرحلة الدخول
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'core/theme.dart';
import 'state/app_state.dart';
import 'screens/entry_screen.dart';
import 'screens/cashier_cards_screen.dart';
import 'screens/pin_screen.dart';
import 'screens/pos/pos_screen.dart';
import 'screens/sections/section_screen.dart';

class Z8App extends StatelessWidget {
  const Z8App({super.key, required this.app});
  final AppState app;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Z8 POS',
      debugShowCheckedModeBanner: false,
      theme: z8Theme(),
      locale: const Locale('ar'),
      supportedLocales: const [Locale('ar')],
      localizationsDelegates: const [GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate],
      builder: (context, child) => Directionality(textDirection: TextDirection.rtl, child: child!),
      home: ListenableBuilder(
        listenable: app,
        builder: (context, _) => switch (app.phase) {
          Phase.boot => const Scaffold(body: Center(child: CircularProgressIndicator(color: Z8.petrol))),
          Phase.needsCode => EntryScreen(app: app),
          Phase.cards => app.enteringOtherCode ? EntryScreen(app: app, asOverlay: true) : CashierCardsScreen(app: app),
          Phase.pin => PinScreen(app: app),
          Phase.pos => PosScreen(app: app),
          Phase.section => SectionScreen(app: app),
        },
      ),
    );
  }
}
