import 'package:flutter/material.dart';
import '../core/i18n.dart';
import '../core/theme.dart';
import '../core/widgets.dart';
import '../state/app_state.dart';
import 'car_screen.dart';
import 'flows.dart';

/// سياراتي: كل سيارة تفتح صفحتها وفيها فواتيرها فقط
class CarsScreen extends StatelessWidget {
  const CarsScreen({super.key, required this.state});
  final AppState state;

  @override
  Widget build(BuildContext context) => ListenableBuilder(
        listenable: state,
        builder: (context, _) => Scaffold(
          appBar: AppBar(title: Text(tr('سياراتي'), style: tx(Fs.lg, w: 900)), backgroundColor: Z8.ink2, surfaceTintColor: Colors.transparent),
          body: SafeArea(
            child: RefreshIndicator(
              onRefresh: state.loadProfile,
              child: ListView(padding: const EdgeInsets.all(16), children: [
                if (state.profile.cars.isEmpty)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 24),
                    child: Text(tr('لا توجد سيارات مسجلة بعد'), textAlign: TextAlign.center, style: tx(Fs.md, w: 700, color: Z8.textDim)),
                  ),
                for (final c in state.profile.cars)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: InkWell(
                      onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => CarScreen(state: state, car: c))),
                      child: Panel(child: Row(children: [
                        const Icon(Icons.directions_car_outlined, color: Z8.petrol),
                        const SizedBox(width: 12),
                        Expanded(child: Text(c.title.isEmpty ? tr('سيارة') : c.title, style: tx(Fs.md, w: 800))),
                        Text(c.plate, style: tx(Fs.md, w: 800, color: Z8.textDim), textDirection: TextDirection.ltr),
                        const SizedBox(width: 8),
                        Icon(Directionality.of(context) == TextDirection.rtl ? Icons.chevron_left : Icons.chevron_right, color: Z8.textDim),
                      ])),
                    ),
                  ),
                const SizedBox(height: 12),
                Z8Button(tr('تسجيل سيارة جديدة'), icon: Icons.add_circle_outline, outline: true, onTap: () => openRegisterCar(context, state)),
              ]),
            ),
          ),
        ),
      );
}
