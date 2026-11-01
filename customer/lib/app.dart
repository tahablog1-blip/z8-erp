import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'core/theme.dart';
import 'screens/home_screen.dart';
import 'screens/branches_screen.dart';
import 'state/app_state.dart';

class CustomerApp extends StatelessWidget {
  const CustomerApp({super.key, required this.state});
  final AppState state;
  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'مصدر الزيوت',
        debugShowCheckedModeBanner: false,
        theme: z8Theme(),
        locale: const Locale('ar'),
        supportedLocales: const [Locale('ar')],
        localizationsDelegates: const [GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate],
        home: ListenableBuilder(
          listenable: state,
          builder: (_, _) => switch (state.phase) {
            Phase.boot => const Scaffold(body: Center(child: CircularProgressIndicator())),
            Phase.needsBranch => BranchesScreen(state: state),
            Phase.ready => HomeScreen(state: state),
          },
        ),
      );
}
