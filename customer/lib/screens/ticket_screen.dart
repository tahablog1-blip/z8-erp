import 'dart:async';
import 'package:flutter/material.dart';
import '../core/i18n.dart';
import '../core/theme.dart';
import '../core/widgets.dart';
import '../models.dart';
import '../state/app_state.dart';
import 'chat_screen.dart';

/// تذكرة الدور الحيّة: ترتيبك، كم سيارة قبلك، الوقت المتوقع — تتحدّث كل 10 ثوان
class TicketScreen extends StatefulWidget {
  const TicketScreen({super.key, required this.state, this.bookingId});
  final AppState state;
  final String? bookingId;       // حجز محدد من «حجوزاتي»؛ بدونه الحجز الحالي
  @override
  State<TicketScreen> createState() => _TicketScreenState();
}

class _TicketScreenState extends State<TicketScreen> {
  Timer? _t;
  @override
  void initState() {
    super.initState();
    _t = Timer.periodic(const Duration(seconds: 10), (_) {
      widget.state.refreshBooking();
      widget.state.refreshBookings();
    });
  }

  @override
  void dispose() { _t?.cancel(); super.dispose(); }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
        listenable: widget.state,
        builder: (context, _) {
          final id = widget.bookingId;
          final b = id == null ? widget.state.booking : (widget.state.myBookings.where((x) => x.id == id).firstOrNull ?? widget.state.booking);
          return Scaffold(
            appBar: AppBar(title: Text(tr('تذكرتي'), style: tx(Fs.lg, w: 900)), backgroundColor: Z8.ink2, surfaceTintColor: Colors.transparent),
            body: b == null
                ? Center(child: Text(tr('لا يوجد حجز نشط'), style: tx(Fs.md, color: Z8.textDim)))
                : SafeArea(
                    child: RefreshIndicator(
                      onRefresh: widget.state.refreshBooking,
                      child: ListView(padding: const EdgeInsets.all(16), children: [
                        TicketCard(b),
                        const SizedBox(height: 16),
                        Z8Button(tr('محادثة مع الفرع'), icon: Icons.chat_bubble_outline, onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => ChatScreen(state: widget.state, bookingId: b.id)))),
                      ]),
                    ),
                  ),
          );
        },
      );
}

class TicketCard extends StatelessWidget {
  const TicketCard(this.b, {super.key, this.compact = false});
  final Booking b;
  final bool compact;
  @override
  Widget build(BuildContext context) {
    final (label, color, bg) = switch (b.state) {
      BookingState.waiting => (tr('بانتظار دورك'), Z8.brass, Z8.brassSoft),
      BookingState.inService => (tr('سيارتك الآن في الخدمة'), Z8.emerald, Z8.emeraldBg),
      BookingState.done => (tr('تمت الخدمة — شكراً لك'), Z8.petrol, Z8.petrolSoft),
      BookingState.cancelled => (tr('تم إلغاء الحجز'), Z8.ember, Z8.emberBg),
    };
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: Motion.enabled ? 0 : 1, end: 1), duration: const Duration(milliseconds: 450), curve: Curves.easeOutCubic,
      builder: (_, v, child) => Opacity(opacity: v, child: Transform.translate(offset: Offset(0, 14 * (1 - v)), child: child)),
      child: Panel(
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          color: bg,
          child: Row(children: [
            if (b.state == BookingState.done || b.state == BookingState.cancelled) Icon(b.state == BookingState.done ? Icons.check_circle : Icons.cancel, size: 14, color: color) else PulseDot(color: color, size: 9),
            const SizedBox(width: 8),
            Expanded(child: Text(label, style: tx(Fs.md, w: 900, color: Z8.text))),
          ]),
        ),
        if (b.active) ...[const SizedBox(height: 10), DrivingCar(color: color)],
        const SizedBox(height: 10),
        Text(b.branchName, style: tx(Fs.sm, w: 700, color: Z8.textDim)),
        const SizedBox(height: 4),
        Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
          Text('${b.queueNo}', style: tx(Fs.x3 + 18, w: 900, color: Z8.petrolDeep, tnum: true, h: 1)),
          const SizedBox(width: 8),
          Padding(padding: const EdgeInsets.only(bottom: 6), child: Text(tr('رقم دورك'), style: tx(Fs.sm, w: 700, color: Z8.textDim))),
          const Spacer(),
          Text(b.plate, style: tx(Fs.lg, w: 900), textDirection: TextDirection.ltr),
        ]),
        if (b.state == BookingState.waiting) ...[
          const Divider(height: 24),
          Row(children: [
            Expanded(child: _Stat(tr('قبلك'), '${b.ahead}', tr('سيارة'))),
            Expanded(child: _Stat(tr('الانتظار المتوقع'), b.estWaitMinutes == 0 ? tr('الآن') : '${b.estWaitMinutes}', b.estWaitMinutes == 0 ? '' : tr('دقيقة'))),
          ]),
        ],
        if (b.state == BookingState.inService && (b.station ?? '').isNotEmpty) ...[
          const Divider(height: 24),
          _Stat(tr('الموقع'), b.station!, ''),
        ],
      ]),
    ));
  }
}

class _Stat extends StatelessWidget {
  const _Stat(this.label, this.value, this.unit);
  final String label, value, unit;
  @override
  Widget build(BuildContext context) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(label, style: tx(Fs.xs, w: 700, color: Z8.textDim)),
        Row(crossAxisAlignment: CrossAxisAlignment.baseline, textBaseline: TextBaseline.alphabetic, children: [
          Text(value, style: tx(Fs.x2, w: 900, tnum: true)),
          if (unit.isNotEmpty) ...[const SizedBox(width: 4), Text(unit, style: tx(Fs.sm, w: 700, color: Z8.textDim))],
        ]),
      ]);
}
