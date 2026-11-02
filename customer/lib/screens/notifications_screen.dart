import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../core/i18n.dart';
import '../core/theme.dart';
import '../core/widgets.dart';
import '../models.dart';
import '../state/app_state.dart';
import 'cars_screen.dart';
import 'chat_screen.dart';
import 'flows.dart';
import 'ticket_screen.dart';

/// نص الإشعار حسب نوعه (مترجم محلياً). رسائل الفرع تُعرض كما كتبها الموظف.
({String title, String body, IconData icon}) noticeText(AppNotice n) => switch (n.kind) {
      'car_registered' => (title: tr('تم تسجيل سيارتك'), body: tr('أُضيفت سيارتك ({0}) إلى سياراتي.', [n.meta]), icon: Icons.directions_car_outlined),
      'booking' => (title: tr('تم حجز دورك'), body: tr('تم حجز دورك لسيارتك {0}. تابع دورك من الصفحة الرئيسية.', [n.meta]), icon: Icons.event_available),
      'turn_near' => (title: tr('اقترب دورك'), body: tr('اقترب موعد دخول سيارتك {0} — توجّه إلى بوابة الدخول.', [n.meta]), icon: Icons.notifications_active_outlined),
      'in_service' => (title: tr('سيارتك داخل الخدمة الآن'), body: tr('بدأت خدمة سيارتك {0}. يمكنك مراسلة الفرع من المحادثات.', [n.meta]), icon: Icons.build_circle_outlined),
      'done' => (title: tr('انتهت خدمة سيارتك'), body: tr('تمت خدمة سيارتك {0} — شكراً لثقتك. فاتورتك في سياراتي.', [n.meta]), icon: Icons.check_circle_outline),
      'due' => (title: tr('اقترب موعد تغيير الزيت'), body: tr('مرّت أكثر من 5 أشهر على آخر خدمة لسيارتك {0} — احجز دورك الآن.', [n.meta]), icon: Icons.oil_barrel_outlined),
      'message' => (title: tr('رسالة جديدة من الفرع'), body: n.meta.isNotEmpty && !n.meta.startsWith('🎤') ? n.meta : tr('أرسل لك الفرع رسالة'), icon: Icons.chat_bubble_outline),
      _ => (title: n.title, body: n.body, icon: Icons.notifications_none),
    };

class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key, required this.state});
  final AppState state;
  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  AppState get s => widget.state;

  @override
  void initState() {
    super.initState();
    s.refreshInbox();
  }

  /// الضغط على إشعار: يُعلَّم مقروءاً ثم يفتح وجهته (الرسالة ← المحادثة مباشرة)
  Future<void> _open(AppNotice n) async {
    final nav = Navigator.of(context);
    if (!n.read) s.markNoticesRead([n.id]);
    switch (n.kind) {
      case 'message':
        if (n.refId == null) return;
        await nav.push(MaterialPageRoute(builder: (_) => ChatScreen(state: s, bookingId: n.refId!)));
        s.refreshInbox();
      case 'booking' || 'turn_near' || 'in_service':
        if (s.booking != null) nav.push(MaterialPageRoute(builder: (_) => TicketScreen(state: s)));
      case 'due':
        await openBook(context, s);
      default:
        nav.push(MaterialPageRoute(builder: (_) => CarsScreen(state: s)));
    }
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
        listenable: s,
        builder: (context, _) => Scaffold(
          appBar: AppBar(
            title: Text(tr('الإشعارات'), style: tx(Fs.lg, w: 900)), backgroundColor: Z8.ink2, surfaceTintColor: Colors.transparent,
            actions: [if (s.unreadNotices > 0) TextButton(onPressed: () => s.markNoticesRead(), child: Text(tr('تعليم الكل كمقروء'), style: tx(Fs.sm, w: 800, color: Z8.petrol)))],
          ),
          body: SafeArea(
            child: RefreshIndicator(
              onRefresh: s.refreshInbox,
              child: ListView(padding: const EdgeInsets.all(16), children: [
                if (s.notices.isEmpty)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 32),
                    child: Text(tr('لا توجد إشعارات بعد'), textAlign: TextAlign.center, style: tx(Fs.md, w: 700, color: Z8.textDim)),
                  ),
                for (final n in s.notices)
                  Builder(builder: (context) {
                    final t = noticeText(n);
                    return Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: InkWell(
                        onTap: () => _open(n),
                        child: Panel(
                          color: n.read ? null : Z8.petrolSoft,
                          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Icon(t.icon, color: Z8.petrol),
                            const SizedBox(width: 12),
                            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                              Text(t.title, style: tx(Fs.md, w: n.read ? 700 : 900)),
                              const SizedBox(height: 2),
                              Text(t.body, maxLines: 3, overflow: TextOverflow.ellipsis, style: tx(Fs.sm, color: Z8.textDim)),
                              if (n.at != null) ...[const SizedBox(height: 4), Text(DateFormat('d/M HH:mm').format(n.at!), style: tx(Fs.xs, color: Z8.textDim, tnum: true))],
                            ])),
                            if (!n.read) Container(width: 9, height: 9, margin: const EdgeInsets.only(top: 6), color: Z8.ember),
                          ]),
                        ),
                      ),
                    );
                  }),
              ]),
            ),
          ),
        ),
      );
}
