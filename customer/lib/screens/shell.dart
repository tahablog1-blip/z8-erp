import 'package:flutter/material.dart';
import '../core/i18n.dart';
import '../core/theme.dart';
import '../core/widgets.dart';
import '../state/app_state.dart';
import 'bookings_screen.dart';
import 'cars_screen.dart';
import 'chats_screen.dart';
import 'home_screen.dart';
import 'invoices_screen.dart';
import 'login_screen.dart';

/// الإطار الرئيسي: شريط تبويبات سفلي — الرئيسية · فواتيري · سيارة جديدة · الحجوزات · المحادثات
class MainShell extends StatelessWidget {
  const MainShell({super.key, required this.state});
  final AppState state;

  @override
  Widget build(BuildContext context) => ListenableBuilder(
        listenable: state,
        builder: (context, _) {
          final s = state;
          // يُعاد بناء صفحة التبويب عند تغيّر الفرع أو هوية العميل فلا تبقى بيانات قديمة
          final id = '${s.branchId}-${s.verified}-${s.phone}';
          final pages = <Widget>[
            HomeScreen(state: s),
            LoginGate(state: s, title: tr('فواتيري'), icon: Icons.receipt_long_outlined, child: InvoicesScreen(key: ValueKey('inv-$id-${s.invoicesEpoch}'), state: s)),
            LoginGate(state: s, title: tr('سياراتي'), icon: Icons.directions_car_outlined, child: CarsScreen(key: ValueKey('cars-$id'), state: s)),
            LoginGate(state: s, title: tr('حجوزاتي'), icon: Icons.event_note_outlined, child: BookingsScreen(key: ValueKey('bk-$id'), state: s)),
            LoginGate(state: s, title: tr('المحادثات'), icon: Icons.forum_outlined, child: ChatsScreen(key: ValueKey('ch-$id'), state: s)),
          ];
          return Scaffold(
            body: IndexedStack(index: s.tab, children: pages),
            bottomNavigationBar: NavigationBar(
              selectedIndex: s.tab,
              onDestinationSelected: s.goTab,
              backgroundColor: Z8.ink2,
              surfaceTintColor: Colors.transparent,
              height: 68,
              labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
              destinations: [
                NavigationDestination(icon: const Icon(Icons.home_outlined), selectedIcon: const Icon(Icons.home), label: tr('الرئيسية')),
                NavigationDestination(icon: const Icon(Icons.receipt_long_outlined), selectedIcon: const Icon(Icons.receipt_long), label: tr('فواتيري')),
                NavigationDestination(icon: const Icon(Icons.add_circle_outline), selectedIcon: const Icon(Icons.add_circle), label: tr('سيارة جديدة')),
                NavigationDestination(
                  icon: Badge(isLabelVisible: s.activeBookings.isNotEmpty, label: Text('${s.activeBookings.length}'), backgroundColor: Z8.petrol, child: const Icon(Icons.event_note_outlined)),
                  selectedIcon: const Icon(Icons.event_note), label: tr('الحجوزات')),
                NavigationDestination(
                  icon: Badge(isLabelVisible: s.unreadChats > 0, label: Text('${s.unreadChats}'), backgroundColor: Z8.ember, child: const Icon(Icons.forum_outlined)),
                  selectedIcon: const Icon(Icons.forum), label: tr('المحادثات')),
              ],
            ),
          );
        },
      );
}

/// صفحة تبويب تحتاج هوية العميل: لو لم يؤكد جواله بعد تعرض دعوة للتأكيد بدل المحتوى
class LoginGate extends StatelessWidget {
  const LoginGate({super.key, required this.state, required this.title, required this.icon, required this.child});
  final AppState state;
  final String title;
  final IconData icon;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    if (!state.needsLogin) return child;
    return Scaffold(
      appBar: AppBar(title: Text(title, style: tx(Fs.lg, w: 900)), backgroundColor: Z8.ink2, surfaceTintColor: Colors.transparent),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
            Icon(icon, size: 56, color: Z8.petrol),
            const SizedBox(height: 16),
            Text(tr('أكّد رقم جوالك لتظهر بياناتك هنا'), textAlign: TextAlign.center, style: tx(Fs.md, w: 800)),
            const SizedBox(height: 20),
            Z8Button(tr('تأكيد رقم الجوال'), icon: Icons.verified_user_outlined, onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => LoginScreen(state: state)))),
          ]),
        ),
      ),
    );
  }
}
