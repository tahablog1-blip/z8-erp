import 'package:flutter/material.dart';
import '../core/car_brands.dart';
import '../core/i18n.dart';
import '../models.dart';
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
                      child: CarCard(c, chevron: true),
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


/// كارت سيارة: لوجو الماركة، الاسم (ماركة + موديل)، اللوحة، وباقي البيانات وآخر ممشى
class CarCard extends StatelessWidget {
  const CarCard(this.car, {super.key, this.chevron = false, this.selected});
  final SavedCar car;
  final bool chevron;
  final bool? selected;      // null = بلا اختيار
  @override
  Widget build(BuildContext context) {
    final c = car;
    final facts = <(IconData, String)>[
      if (c.year.isNotEmpty) (Icons.calendar_today_outlined, tr('موديل {0}', [c.year])),
      if (c.fuel.isNotEmpty) (Icons.local_gas_station_outlined, tr(c.fuel)),
      if (c.cylinders.isNotEmpty) (Icons.settings_outlined, tr('{0} سلندر', [c.cylinders])),
      if (c.engineSize.isNotEmpty) (Icons.speed_outlined, '${c.engineSize} L'),
      if (c.color.isNotEmpty) (Icons.palette_outlined, c.color),
    ];
    return Panel(
      color: selected == true ? Z8.petrolSoft : null,
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          CarBrandLogo(c.brand, size: 48),
          const SizedBox(width: 12),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(c.title.isEmpty ? tr('سيارة') : c.title, style: tx(Fs.md, w: 900)),
            const SizedBox(height: 4),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
              decoration: BoxDecoration(border: Border.all(color: Z8.petrolDeep, width: 1.5)),
              child: Text(c.plate, style: tx(Fs.md, w: 900, tnum: true), textDirection: TextDirection.ltr),
            ),
          ])),
          if (selected != null) Icon(selected! ? Icons.radio_button_checked : Icons.radio_button_off, color: Z8.petrol),
          if (chevron) Icon(Directionality.of(context) == TextDirection.rtl ? Icons.chevron_left : Icons.chevron_right, color: Z8.textDim),
        ]),
        if (facts.isNotEmpty) ...[
          const SizedBox(height: 10),
          Wrap(spacing: 14, runSpacing: 6, children: [
            for (final f in facts) Row(mainAxisSize: MainAxisSize.min, children: [Icon(f.$1, size: 15, color: Z8.textDim), const SizedBox(width: 4), Flexible(child: Text(f.$2, style: tx(Fs.sm, w: 600, color: Z8.textDim)))]),
          ]),
        ],
        if (c.lastOdometer != null) ...[
          const SizedBox(height: 8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6), color: Z8.brassSoft,
            child: Row(mainAxisSize: MainAxisSize.min, children: [
              const Icon(Icons.route_outlined, size: 16, color: Z8.petrolDeep), const SizedBox(width: 6),
              Flexible(child: Text(tr('آخر قراءة عداد: {0} كم', [c.lastOdometer]), style: tx(Fs.sm, w: 800, color: Z8.petrolDeep))),
            ]),
          ),
        ],
      ]),
    );
  }
}
