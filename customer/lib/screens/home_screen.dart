import 'dart:async';
import 'package:flutter/material.dart';
import '../core/brand.dart';
import '../core/i18n.dart';
import '../core/theme.dart';
import '../core/widgets.dart';
import '../models.dart';
import '../state/app_state.dart';
import 'branches_screen.dart';
import 'cars_screen.dart';
import 'chats_screen.dart';
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
    });
  }

  @override
  void dispose() { _t?.cancel(); super.dispose(); }

  Future<void> _bell() async {
    if (!await ensureLogin(context, s) || !mounted) return;
    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => NotificationsScreen(state: s)));
  }

  Future<void> _cars() async {
    if (!await ensureLogin(context, s) || !mounted) return;
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => CarsScreen(state: s)));
  }

  Future<void> _chats() async {
    if (!await ensureLogin(context, s) || !mounted) return;
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => ChatsScreen(state: s)));
  }

  Future<void> _register() async {
    if (await openRegisterCar(context, s) && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('تم تسجيل سيارتك'))));
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
              backgroundColor: Colors.transparent, foregroundColor: Colors.white, surfaceTintColor: Colors.transparent,
              flexibleSpace: const BrandBackdrop(),
              title: Text(info?.name ?? tr('مصدر الزيوت'), style: tx(Fs.lg, w: 900, color: Colors.white)),
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
                  if (info != null)
                    Panel(
                      child: Row(children: [
                        Expanded(child: _Num(tr('بانتظار الخدمة'), '${info.waiting}')),
                        Expanded(child: _Num(tr('داخل الخدمة'), '${info.inService}')),
                        Expanded(child: _Num(tr('الانتظار التقريبي'), info.estWaitMinutes == 0 ? tr('لا انتظار') : tr('{0} د', [info.estWaitMinutes]))),
                      ]),
                    ),
                  const SizedBox(height: 16),
                  if (b != null) ...[
                    Text(tr('حجزك الحالي'), style: tx(Fs.md, w: 900, color: Z8.petrolDeep)),
                    const SizedBox(height: 8),
                    InkWell(onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => TicketScreen(state: s))), child: TicketCard(b)),
                    const SizedBox(height: 16),
                  ],
                  Text(tr('الأقسام'), style: tx(Fs.md, w: 900, color: Z8.petrolDeep)),
                  const SizedBox(height: 8),
                  GridView.count(
                    crossAxisCount: 2, shrinkWrap: true, physics: const NeverScrollableScrollPhysics(), mainAxisSpacing: 10, crossAxisSpacing: 10, childAspectRatio: 1.35,
                    children: [
                      _Tile(Icons.directions_car_outlined, tr('سياراتي'), _cars),
                      _Tile(Icons.event_available, tr('حجز جديد'), () => b != null && b.state != BookingState.done
                          ? Navigator.of(context).push(MaterialPageRoute(builder: (_) => TicketScreen(state: s)))     // لديك دور فعّال: نفتح تذكرته
                          : openBook(context, s)),
                      _Tile(Icons.add_circle_outline, tr('تسجيل سيارة جديدة'), _register),
                      _Tile(Icons.forum_outlined, tr('المحادثات'), _chats, badge: s.unreadChats),
                    ],
                  ),
                  if (!s.verified && s.phone.isEmpty && info?.otpRequired == true) ...[
                    const SizedBox(height: 16),
                    Text(tr('أكّد رقم جوالك لتظهر سياراتك المحفوظة ويكون الحجز أسرع.'), style: tx(Fs.sm, color: Z8.textDim)),
                  ],
                ]),
              ),
            ),
          );
        },
      );
}

class _Tile extends StatelessWidget {
  const _Tile(this.icon, this.label, this.onTap, {this.badge = 0});
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final int badge;
  @override
  Widget build(BuildContext context) => InkWell(
        onTap: onTap,
        child: Panel(
          child: Center(
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              Badge(isLabelVisible: badge > 0, label: Text('$badge'), backgroundColor: Z8.ember, child: Icon(icon, size: 34, color: Z8.petrol)),
              const SizedBox(height: 8),
              Text(label, textAlign: TextAlign.center, style: tx(Fs.md, w: 800)),
            ]),
          ),
        ),
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
