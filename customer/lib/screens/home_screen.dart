import 'dart:async';
import 'package:flutter/material.dart';
import '../core/theme.dart';
import '../core/widgets.dart';
import '../models.dart';
import '../state/app_state.dart';
import 'book_screen.dart';
import 'branches_screen.dart';
import 'login_screen.dart';
import 'ticket_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, required this.state});
  final AppState state;
  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  Timer? _t;
  AppState get s => widget.state;

  @override
  void initState() {
    super.initState();
    _t = Timer.periodic(const Duration(seconds: 30), (_) => s.refreshInfo());
  }

  @override
  void dispose() { _t?.cancel(); super.dispose(); }

  Future<void> _book() async {
    final nav = Navigator.of(context);
    final needLogin = s.info?.otpRequired == true && !s.verified;
    if (needLogin) {
      final ok = await nav.push<bool>(MaterialPageRoute(builder: (_) => LoginScreen(state: s)));
      if (ok != true || !mounted) return;
    }
    final done = await nav.push<bool>(MaterialPageRoute(builder: (_) => BookScreen(state: s)));
    if (done == true && mounted) {
      nav.push(MaterialPageRoute(builder: (_) => TicketScreen(state: s)));
    }
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
        listenable: s,
        builder: (context, _) {
          final info = s.info;
          final b = s.booking;
          return Scaffold(
            appBar: AppBar(
              backgroundColor: Z8.sbBg, foregroundColor: Colors.white, surfaceTintColor: Colors.transparent,
              title: Text(info?.name ?? 'مصدر الزيوت', style: tx(Fs.lg, w: 900, color: Colors.white)),
              actions: [
                PopupMenuButton<String>(
                  onSelected: (v) {
                    if (v == 'branch') Navigator.of(context).push(MaterialPageRoute(builder: (_) => BranchesScreen(state: s, pickMode: true)));
                    if (v == 'out') s.logout();
                  },
                  itemBuilder: (_) => [
                    const PopupMenuItem(value: 'branch', child: Text('تغيير الفرع')),
                    if (s.verified || s.phone.isNotEmpty) const PopupMenuItem(value: 'out', child: Text('تسجيل الخروج')),
                  ],
                ),
              ],
            ),
            body: SafeArea(
              child: RefreshIndicator(
                onRefresh: s.refreshAll,
                child: ListView(padding: const EdgeInsets.all(16), children: [
                  if (s.infoError != null) ...[ErrorBar(s.infoError!), const SizedBox(height: 12)],
                  if (info != null)
                    Panel(
                      child: Row(children: [
                        Expanded(child: _Num('بانتظار الخدمة', '${info.waiting}')),
                        Expanded(child: _Num('داخل الخدمة', '${info.inService}')),
                        Expanded(child: _Num('الانتظار التقريبي', info.estWaitMinutes == 0 ? 'لا انتظار' : '${info.estWaitMinutes} د')),
                      ]),
                    ),
                  const SizedBox(height: 16),
                  if (b != null) ...[
                    Text('حجزك الحالي', style: tx(Fs.md, w: 900, color: Z8.petrolDeep)),
                    const SizedBox(height: 8),
                    InkWell(onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => TicketScreen(state: s))), child: TicketCard(b)),
                    const SizedBox(height: 16),
                  ],
                  if (b == null || b.state == BookingState.done) Z8Button('احجز دورك الآن', icon: Icons.event_available, onTap: _book),
                  if (s.profile.cars.isNotEmpty) ...[
                    const SizedBox(height: 24),
                    Text('سياراتي', style: tx(Fs.md, w: 900, color: Z8.petrolDeep)),
                    const SizedBox(height: 8),
                    for (final c in s.profile.cars)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: Panel(child: Row(children: [
                          const Icon(Icons.directions_car_outlined, color: Z8.petrol),
                          const SizedBox(width: 12),
                          Expanded(child: Text(c.title.isEmpty ? 'سيارة' : c.title, style: tx(Fs.md, w: 800))),
                          Text(c.plate, style: tx(Fs.md, w: 800, color: Z8.textDim), textDirection: TextDirection.ltr),
                        ])),
                      ),
                  ] else if (!s.verified && info?.otpRequired == true) ...[
                    const SizedBox(height: 16),
                    Text('أكّد رقم جوالك لتظهر سياراتك المحفوظة ويكون الحجز أسرع.', style: tx(Fs.sm, color: Z8.textDim)),
                  ],
                ]),
              ),
            ),
          );
        },
      );
}

class _Num extends StatelessWidget {
  const _Num(this.label, this.value);
  final String label, value;
  @override
  Widget build(BuildContext context) => Column(children: [
        Text(value, style: tx(Fs.xl, w: 900, color: Z8.petrolDeep, tnum: true)),
        const SizedBox(height: 2),
        Text(label, textAlign: TextAlign.center, style: tx(Fs.xs, w: 700, color: Z8.textDim)),
      ]);
}
