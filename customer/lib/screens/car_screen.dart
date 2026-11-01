import 'package:flutter/material.dart';
import '../core/api.dart';
import '../core/theme.dart';
import '../core/widgets.dart';
import '../models.dart';
import '../state/app_state.dart';
import 'invoices_screen.dart';
import 'services_screen.dart';
import 'ticket_screen.dart';

/// صفحة السيارة: بياناتها + حجز خدمة لها + سجل تغييراتها (فواتير هذه السيارة فقط)
class CarScreen extends StatefulWidget {
  const CarScreen({super.key, required this.state, required this.car});
  final AppState state;
  final SavedCar car;
  @override
  State<CarScreen> createState() => _CarScreenState();
}

class _CarScreenState extends State<CarScreen> {
  InvoiceList? data;
  String? err;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => err = null);
    try {
      final d = await widget.state.fetchInvoices(savedCarId: widget.car.id);
      if (mounted) setState(() => data = d);
    } on ApiException catch (e) {
      if (mounted) setState(() => err = e.message);
    }
  }

  Future<void> _book() async {
    final s = widget.state, c = widget.car;
    final nav = Navigator.of(context);
    final ok = await nav.push<bool>(MaterialPageRoute(
      builder: (_) => ServicesScreen(
        state: s, carTitle: '${c.title.isEmpty ? 'سيارة' : c.title} · ${c.plate}', brand: c.brand, model: c.name, year: c.year, askOdometer: true,
        submit: (selection, odo) => s.bookSaved(c, odometer: odo, selection: selection),
      ),
    ));
    if (ok == true && mounted) nav.push(MaterialPageRoute(builder: (_) => TicketScreen(state: s)));
  }

  @override
  Widget build(BuildContext context) {
    final c = widget.car;
    final last = data?.invoices.isEmpty == false ? data!.invoices.first : null;
    return Scaffold(
      appBar: AppBar(title: Text(c.title.isEmpty ? 'سيارتي' : c.title, style: tx(Fs.lg, w: 900)), backgroundColor: Z8.ink2, surfaceTintColor: Colors.transparent),
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: _load,
          child: ListView(padding: const EdgeInsets.all(16), children: [
            Panel(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                const Icon(Icons.directions_car_outlined, color: Z8.petrol, size: 28),
                const SizedBox(width: 12),
                Expanded(child: Text(c.title.isEmpty ? 'سيارة' : c.title, style: tx(Fs.lg, w: 900))),
                Text(c.plate, style: tx(Fs.lg, w: 900), textDirection: TextDirection.ltr),
              ]),
              if (c.year.isNotEmpty) ...[const SizedBox(height: 6), Text('موديل ${c.year}', style: tx(Fs.sm, color: Z8.textDim))],
              if (last?.odometer != null && last!.odometer! > 1) ...[const SizedBox(height: 4), Text('آخر قراءة عداد: ${last.odometer} كم', style: tx(Fs.sm, color: Z8.textDim))],
            ])),
            const SizedBox(height: 12),
            Z8Button('احجز خدمة لهذه السيارة', icon: Icons.event_available, onTap: _book),
            const SizedBox(height: 24),
            Text('سجل التغييرات', style: tx(Fs.md, w: 900, color: Z8.petrolDeep)),
            const SizedBox(height: 8),
            InvoiceListView(state: widget.state, data: data, err: err, showCar: false, onRetry: _load),
          ]),
        ),
      ),
    );
  }
}
