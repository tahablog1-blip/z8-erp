import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';
import '../core/api.dart';
import '../core/theme.dart';
import '../core/widgets.dart';
import '../models.dart';
import '../state/app_state.dart';

/// فواتيري: كل فواتير العميل (أو فواتير سيارة واحدة لو مُرِّر savedCarId)
class InvoicesScreen extends StatefulWidget {
  const InvoicesScreen({super.key, required this.state, this.savedCarId, this.title = 'فواتيري'});
  final AppState state;
  final String? savedCarId;
  final String title;
  @override
  State<InvoicesScreen> createState() => _InvoicesScreenState();
}

class _InvoicesScreenState extends State<InvoicesScreen> {
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
      final d = await widget.state.fetchInvoices(savedCarId: widget.savedCarId);
      if (mounted) setState(() => data = d);
    } on ApiException catch (e) {
      if (mounted) setState(() => err = e.message);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: Text(widget.title, style: tx(Fs.lg, w: 900)), backgroundColor: Z8.ink2, surfaceTintColor: Colors.transparent),
        body: SafeArea(
          child: RefreshIndicator(
            onRefresh: _load,
            child: ListView(padding: const EdgeInsets.all(16), children: [
              InvoiceListView(state: widget.state, data: data, err: err, showCar: widget.savedCarId == null, onRetry: _load),
            ]),
          ),
        ),
      );
}

/// قائمة فواتير جاهزة للتضمين (تُستخدم في شاشة فواتيري وفي صفحة السيارة)
class InvoiceListView extends StatelessWidget {
  const InvoiceListView({super.key, required this.state, required this.data, required this.err, required this.showCar, required this.onRetry});
  final AppState state;
  final InvoiceList? data;
  final String? err;
  final bool showCar;
  final VoidCallback onRetry;
  @override
  Widget build(BuildContext context) {
    if (err != null) return Column(children: [ErrorBar(err!), const SizedBox(height: 12), Z8Button('إعادة المحاولة', outline: true, onTap: onRetry)]);
    if (data == null) return const Padding(padding: EdgeInsets.all(32), child: Center(child: CircularProgressIndicator()));
    if (data!.invoices.isEmpty) return Padding(padding: const EdgeInsets.all(24), child: Text('لا توجد فواتير بعد', textAlign: TextAlign.center, style: tx(Fs.md, color: Z8.textDim)));
    return Column(children: [
      for (final inv in data!.invoices)
        Padding(padding: const EdgeInsets.only(bottom: 10), child: InvoiceTile(inv, showCar: showCar, pdfUrl: state.pdfUrl(inv.id, data!.pdfPhone))),
    ]);
  }
}

class InvoiceTile extends StatelessWidget {
  const InvoiceTile(this.inv, {super.key, required this.showCar, required this.pdfUrl});
  final Invoice inv;
  final bool showCar;
  final String pdfUrl;
  @override
  Widget build(BuildContext context) {
    final date = inv.issuedAt == null ? '' : DateFormat('yyyy/MM/dd', 'en').format(inv.issuedAt!);
    return Panel(
      pad: 0,
      child: Theme(
        data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          tilePadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 2),
          childrenPadding: const EdgeInsets.fromLTRB(14, 0, 14, 14),
          title: Row(children: [
            Expanded(child: Text('فاتورة ${inv.no}', style: tx(Fs.md, w: 900))),
            Text('${inv.total.toStringAsFixed(2)} ر.س', style: tx(Fs.md, w: 900, color: Z8.petrolDeep, tnum: true)),
          ]),
          subtitle: Text([date, if (inv.odometer != null && inv.odometer! > 1) '${NumberFormat.decimalPattern('en').format(inv.odometer)} كم', if (showCar && inv.carLabel != null) inv.carLabel!].join(' · '), style: tx(Fs.sm, color: Z8.textDim)),
          children: [
            for (final it in inv.items)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 3),
                child: Row(children: [
                  Expanded(child: Text(it.label, style: tx(Fs.sm, w: 600))),
                  Text('× ${it.qty % 1 == 0 ? it.qty.toStringAsFixed(0) : it.qty.toStringAsFixed(1)}', style: tx(Fs.xs, color: Z8.textDim, tnum: true)),
                  const SizedBox(width: 10),
                  Text(it.lineInc.toStringAsFixed(2), style: tx(Fs.sm, w: 700, tnum: true)),
                ]),
              ),
            const SizedBox(height: 10),
            Z8Button('عرض الفاتورة PDF', icon: Icons.picture_as_pdf_outlined, outline: true, onTap: () => launchUrl(Uri.parse(pdfUrl), mode: LaunchMode.externalApplication)),
          ],
        ),
      ),
    );
  }
}
