import 'dart:async';
import 'package:flutter/material.dart';
import '../core/theme.dart';
import '../core/widgets.dart';
import '../models.dart';
import '../state/app_state.dart';
import 'chat_screen.dart';

/// تذكرة الدور الحيّة: ترتيبك، كم سيارة قبلك، الوقت المتوقع — تتحدّث كل 10 ثوان
class TicketScreen extends StatefulWidget {
  const TicketScreen({super.key, required this.state});
  final AppState state;
  @override
  State<TicketScreen> createState() => _TicketScreenState();
}

class _TicketScreenState extends State<TicketScreen> {
  Timer? _t;
  @override
  void initState() {
    super.initState();
    _t = Timer.periodic(const Duration(seconds: 10), (_) => widget.state.refreshBooking());
  }

  @override
  void dispose() { _t?.cancel(); super.dispose(); }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
        listenable: widget.state,
        builder: (context, _) {
          final b = widget.state.booking;
          return Scaffold(
            appBar: AppBar(title: Text('تذكرتي', style: tx(Fs.lg, w: 900)), backgroundColor: Z8.ink2, surfaceTintColor: Colors.transparent),
            body: b == null
                ? Center(child: Text('لا يوجد حجز نشط', style: tx(Fs.md, color: Z8.textDim)))
                : SafeArea(
                    child: RefreshIndicator(
                      onRefresh: widget.state.refreshBooking,
                      child: ListView(padding: const EdgeInsets.all(16), children: [
                        TicketCard(b),
                        const SizedBox(height: 16),
                        Z8Button('محادثة مع الفرع', icon: Icons.chat_bubble_outline, onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => ChatScreen(state: widget.state, bookingId: b.id)))),
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
      BookingState.waiting => ('بانتظار دورك', Z8.brass, Z8.brassSoft),
      BookingState.inService => ('سيارتك الآن في الخدمة', Z8.emerald, Z8.emeraldBg),
      BookingState.done => ('تمت الخدمة — شكراً لك', Z8.petrol, Z8.petrolSoft),
    };
    return Panel(
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          color: bg,
          child: Row(children: [
            Icon(b.state == BookingState.done ? Icons.check_circle : Icons.circle, size: 12, color: color),
            const SizedBox(width: 8),
            Expanded(child: Text(label, style: tx(Fs.md, w: 900, color: Z8.text))),
          ]),
        ),
        const SizedBox(height: 16),
        Text(b.branchName, style: tx(Fs.sm, w: 700, color: Z8.textDim)),
        const SizedBox(height: 4),
        Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
          Text('${b.queueNo}', style: tx(Fs.x3 + 18, w: 900, color: Z8.petrolDeep, tnum: true, h: 1)),
          const SizedBox(width: 8),
          Padding(padding: const EdgeInsets.only(bottom: 6), child: Text('رقم دورك', style: tx(Fs.sm, w: 700, color: Z8.textDim))),
          const Spacer(),
          Text(b.plate, style: tx(Fs.lg, w: 900), textDirection: TextDirection.ltr),
        ]),
        if (b.state == BookingState.waiting) ...[
          const Divider(height: 24),
          Row(children: [
            Expanded(child: _Stat('قبلك', '${b.ahead}', 'سيارة')),
            Expanded(child: _Stat('الانتظار المتوقع', b.estWaitMinutes == 0 ? 'الآن' : '${b.estWaitMinutes}', b.estWaitMinutes == 0 ? '' : 'دقيقة')),
          ]),
        ],
        if (b.state == BookingState.inService && (b.station ?? '').isNotEmpty) ...[
          const Divider(height: 24),
          _Stat('الموقع', b.station!, ''),
        ],
      ]),
    );
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
