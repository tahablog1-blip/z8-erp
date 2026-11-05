import 'dart:async';
import 'package:flutter/material.dart';
import '../core/brand.dart';
import '../core/i18n.dart';
import '../core/theme.dart';
import '../core/widgets.dart';
import '../core/ads.dart';
import '../state/app_state.dart';
import 'branches_screen.dart';
import 'flows.dart';
import 'notifications_screen.dart';
import 'language_screen.dart';
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
    _t = Timer.periodic(const Duration(seconds: 30), (_) {
      s.refreshInfo();
      s.refreshInbox();     // الجرس والمحادثات تتحدّث تلقائياً
      s.refreshBookings();  // تتبع الحجوزات الجارية
    });
  }

  @override
  void dispose() { _t?.cancel(); super.dispose(); }

  Future<void> _bell() async {
    if (!await ensureLogin(context, s) || !mounted) return;
    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => NotificationsScreen(state: s)));
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
        listenable: s,
        builder: (context, _) {
          final info = s.info;
          final tracked = s.activeBookings.isNotEmpty ? s.activeBookings : [if (s.booking?.active == true) s.booking!];
          return Scaffold(
            appBar: AppBar(
              backgroundColor: Colors.transparent, foregroundColor: Colors.white, surfaceTintColor: Colors.transparent,
              flexibleSpace: const BrandBackdrop(),
              toolbarHeight: 84,
              title: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
                Image.asset('assets/images/logo-white.png', height: 34, fit: BoxFit.contain, alignment: AlignmentDirectional.centerStart, errorBuilder: (_, _, _) => const SizedBox(height: 34)),
                const SizedBox(height: 4),
                Text(info?.name ?? tr('مصدر الزيوت'), style: tx(Fs.md, w: 900, color: Colors.white)),
              ]),
              actions: [
                IconButton(
                  tooltip: tr('الإشعارات'),
                  onPressed: _bell,
                  icon: Badge(isLabelVisible: s.unreadNotices > 0, label: Text('${s.unreadNotices}'), backgroundColor: Z8.ember,
                      child: const Icon(Icons.notifications_none)),
                ),
                PopupMenuButton<String>(
                  onSelected: (v) {
                    if (v == 'branch') Navigator.of(context).push(MaterialPageRoute(builder: (_) => BranchesScreen(state: s, pickMode: true)));
                    if (v == 'lang') Navigator.of(context).push(MaterialPageRoute(builder: (_) => LanguageScreen(state: s)));
                    if (v == 'out') s.logout();
                  },
                  itemBuilder: (_) => [
                    PopupMenuItem(value: 'branch', child: Text(tr('تغيير الفرع'))),
                    PopupMenuItem(value: 'lang', child: Text(tr('اللغة'))),
                    if (s.verified || s.phone.isNotEmpty) PopupMenuItem(value: 'out', child: Text(tr('تسجيل الخروج'))),
                  ],
                ),
              ],
            ),
            body: SafeArea(
              child: RefreshIndicator(
                onRefresh: s.refreshAll,
                child: ListView(padding: const EdgeInsets.all(16), children: [
                  if (s.infoError != null) ...[ErrorBar(s.infoError!), const SizedBox(height: 12)],
                  if (s.ads.isNotEmpty) ...[AdsCarousel(s.ads), const SizedBox(height: 16)],
                  if (info != null)
                    Panel(
                      child: Row(children: [
                        Expanded(child: _Num(tr('بانتظار الخدمة'), '${info.waiting}')),
                        Expanded(child: _Num(tr('داخل الخدمة'), '${info.inService}')),
                        Expanded(child: _Num(tr('الانتظار التقريبي'), info.estWaitMinutes == 0 ? tr('لا انتظار') : tr('{0} د', [info.estWaitMinutes]))),
                      ]),
                    ),
                  const SizedBox(height: 16),
                  Text(tr('تتبع حجوزاتي'), style: tx(Fs.md, w: 900, color: Z8.petrolDeep)),
                  const SizedBox(height: 8),
                  if (tracked.isEmpty)
                    Panel(child: Column(children: [
                      Text(tr('لا توجد حجوزات جارية الآن'), style: tx(Fs.md, w: 700, color: Z8.textDim)),
                      const SizedBox(height: 12),
                      Z8Button(tr('حجز جديد'), icon: Icons.event_available, onTap: () => openBook(context, s)),
                    ]))
                  else
                    for (final t in tracked)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 12),
                        child: InkWell(onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => TicketScreen(state: s, bookingId: t.id))), child: TicketCard(t)),
                      ),
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
