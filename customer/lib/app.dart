import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'core/i18n.dart';
import 'core/theme.dart';
import 'screens/branches_screen.dart';
import 'screens/home_screen.dart';
import 'screens/language_screen.dart';
import 'screens/splash_screen.dart';
import 'state/app_state.dart';

class CustomerApp extends StatefulWidget {
  const CustomerApp({super.key, required this.state, this.showSplash = true});
  final AppState state;
  final bool showSplash;
  @override
  State<CustomerApp> createState() => _CustomerAppState();
}

class _CustomerAppState extends State<CustomerApp> {
  late bool splashDone = !widget.showSplash;

  @override
  Widget build(BuildContext context) {
    final state = widget.state;
    return ListenableBuilder(
      listenable: state,
      builder: (_, _) => MaterialApp(
        title: 'مصدر الزيوت',
        debugShowCheckedModeBanner: false,
        theme: z8Theme(),
        locale: state.lang.locale,
        supportedLocales: [for (final l in AppLang.values) l.locale],
        localizationsDelegates: const [GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate],
        // تغيير اللغة يعيد بناء الواجهة كلها بنصوصها واتجاهها
        builder: (_, child) => KeyedSubtree(key: ValueKey(state.lang), child: child ?? const SizedBox.shrink()),
        home: !splashDone
            ? SplashScreen(onDone: () => setState(() => splashDone = true))
            : switch (state.phase) {
                Phase.boot => const Scaffold(body: Center(child: CircularProgressIndicator())),
                Phase.needsLang => LanguageScreen(state: state, first: true),
                Phase.needsBranch => BranchesScreen(state: state),
                Phase.ready => HomeScreen(state: state),
              },
      ),
    );
  }
}
