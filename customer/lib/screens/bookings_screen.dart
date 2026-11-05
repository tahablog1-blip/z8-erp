import 'package:flutter/material.dart';
import 'package:intl/intl.dart' show DateFormat;
import '../core/i18n.dart';
import '../core/theme.dart';
import '../core/widgets.dart';
import '../models.dart';
import '../state/app_state.dart';
import 'chat_screen.dart';
import 'flows.dart';
import 'ticket_screen.dart';

/// إدارة الحجوزات: الجارية (تتبع، محادثة، إلغاء دور منتظر) والأخيرة، وزر حجز جديد
class BookingsScreen extends StatefulWidget {
  const BookingsScreen({super.key, required this.state});
  final AppState state;
  @override
  State<BookingsScreen> createState() => _BookingsScreenState();
}

class _BookingsScreenState extends State<BookingsScreen> {
  AppState get s => widget.state;
  String? err;

  @override
  void initState() {
    super.initState();
    s.refreshBookings();
  }

  Future<void> _cancel(Booking b) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(tr('إلغاء الحجز'), style: tx(Fs.lg, w: 900)),
        content: Text(tr('هل تريد إلغاء دورك رقم {0} للوحة {1}؟', [b.queueNo, b.plate]), style: tx(Fs.md)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(tr('رجوع'), style: tx(Fs.md, w: 800))),
          TextButton(onPressed: () => Navigator.pop(c, true), child: Text(tr('إلغاء الحجز'), style: tx(Fs.md, w: 800, color: Z8.ember))),
        ],
      ),
    );
    if (ok != true) return;
    final e = await s.cancelBooking(b);
    if (mounted) setState(() => err = e);
  }

  void _track(Booking b) => Navigator.of(context).push(MaterialPageRoute(builder: (_) => TicketScreen(state: s, bookingId: b.id)));

  @override
  Widget build(BuildContext context) => ListenableBuilder(
        listenable: s,
        builder: (context, _) {
          final active = s.activeBookings;
          final past = s.myBookings.where((b) => !b.active).toList();
          return Scaffold(
            appBar: AppBar(title: Text(tr('حجوزاتي'), style: tx(Fs.lg, w: 900)), backgroundColor: Z8.ink2, surfaceTintColor: Colors.transparent),
            body: SafeArea(
              child: RefreshIndicator(
                onRefresh: s.refreshBookings,
                child: ListView(padding: const EdgeInsets.all(16), children: [
                  Z8Button(tr('حجز جديد'), icon: Icons.event_available, onTap: () => openBook(context, s)),
                  if (err != null) ...[const SizedBox(height: 12), ErrorBar(err!)],
                  const SizedBox(height: 20),
                  Text(tr('حجوزات جارية'), style: tx(Fs.md, w: 900, color: Z8.petrolDeep)),
                  const SizedBox(height: 8),
                  if (active.isEmpty)
                    Padding(padding: const EdgeInsets.symmetric(vertical: 16), child: Text(tr('لا توجد حجوزات جارية'), textAlign: TextAlign.center, style: tx(Fs.md, w: 700, color: Z8.textDim))),
                  for (final b in active)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                        InkWell(onTap: () => _track(b), child: TicketCard(b)),
                        const SizedBox(height: 8),
                        Row(children: [
                          Expanded(child: Z8Button(tr('تتبع'), icon: Icons.my_location, outline: true, onTap: () => _track(b))),
                          const SizedBox(width: 8),
                          Expanded(child: Z8Button(tr('محادثة'), icon: Icons.chat_bubble_outline, outline: true, onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => ChatScreen(state: s, bookingId: b.id))))),
                          if (b.canCancel) ...[
                            const SizedBox(width: 8),
                            Expanded(child: Z8Button(tr('إلغاء'), icon: Icons.close, outline: true, onTap: () => _cancel(b))),
                          ],
                        ]),
                      ]),
                    ),
                  if (past.isNotEmpty) ...[
                    const SizedBox(height: 12),
                    Text(tr('حجوزات سابقة'), style: tx(Fs.md, w: 900, color: Z8.petrolDeep)),
                    const SizedBox(height: 8),
                    for (final b in past)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: Panel(child: Row(children: [
                          Icon(b.state == BookingState.cancelled ? Icons.cancel_outlined : Icons.check_circle_outline, color: b.state == BookingState.cancelled ? Z8.ember : Z8.emerald),
                          const SizedBox(width: 12),
                          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Text(b.plate, style: tx(Fs.md, w: 800), textDirection: TextDirection.ltr),
                            Text('${b.branchName}${b.createdAt == null ? '' : ' · ${DateFormat('yyyy/MM/dd', 'en').format(b.createdAt!)}'}', style: tx(Fs.sm, color: Z8.textDim)),
                          ])),
                          Text(b.state == BookingState.cancelled ? tr('ملغي') : tr('مكتمل'), style: tx(Fs.sm, w: 800, color: b.state == BookingState.cancelled ? Z8.ember : Z8.emerald)),
                        ])),
                      ),
                  ],
                ]),
              ),
            ),
          );
        },
      );
}
