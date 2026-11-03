// مسارات مشتركة بين الشاشات: التحقق من الهوية ثم فتح الوجهة
import 'package:flutter/material.dart';
import '../state/app_state.dart';
import 'book_screen.dart';
import 'login_screen.dart';
import 'near_screen.dart';
import 'ticket_screen.dart';

/// يطلب تأكيد الجوال لو لزم. true = العميل معروف الآن.
Future<bool> ensureLogin(BuildContext context, AppState s) async {
  if (!s.needsLogin) return true;
  final ok = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => LoginScreen(state: s)));
  return ok == true;
}

/// الفرع يمنع الحجز إلا أمامه؟ نتحقق من موقع العميل أولاً. true = مسموح.
Future<bool> ensureNear(BuildContext context, AppState s) async {
  if (!s.geofenceOn) return true;
  final ok = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => NearScreen(state: s)));
  return ok == true;
}

/// حجز دور جديد (يتطلب تحققاً أولاً لو الشركة فعّلت OTP)، ثم التذكرة الحيّة عند النجاح
Future<void> openBook(BuildContext context, AppState s) async {
  final nav = Navigator.of(context);
  final needLogin = s.info?.otpRequired == true && !s.verified;
  if (needLogin) {
    final ok = await nav.push<bool>(MaterialPageRoute(builder: (_) => LoginScreen(state: s)));
    if (ok != true || !context.mounted) return;
  }
  if (!await ensureNear(context, s) || !context.mounted) return;
  final done = await nav.push<bool>(MaterialPageRoute(builder: (_) => BookScreen(state: s)));
  if (done == true && context.mounted) {
    nav.push(MaterialPageRoute(builder: (_) => TicketScreen(state: s)));
  }
}

/// تسجيل سيارة جديدة في «سياراتي» بدون حجز
Future<bool> openRegisterCar(BuildContext context, AppState s) async {
  final nav = Navigator.of(context);
  final needLogin = s.info?.otpRequired == true && !s.verified;
  if (needLogin) {
    final ok = await nav.push<bool>(MaterialPageRoute(builder: (_) => LoginScreen(state: s)));
    if (ok != true || !context.mounted) return false;
  }
  final done = await nav.push<bool>(MaterialPageRoute(builder: (_) => BookScreen(state: s, registerOnly: true)));
  return done == true;
}
