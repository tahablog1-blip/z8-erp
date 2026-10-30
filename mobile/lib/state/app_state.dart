// lib/state/app_state.dart — حالة التطبيق: تفعيل الجهاز بالرمز → بطاقات الكاشيرين → رمز الكاشير → الأقسام
import 'package:flutter/foundation.dart';
import '../core/api.dart';
import '../core/store.dart';
import '../models/models.dart';

enum Phase { boot, needsCode, cards, pin, pos, section }

class AppState extends ChangeNotifier {
  AppState({required this.api, required this.store}) {
    api.onUnauthorized = _expired;
  }
  final Api api;
  final KeyValueStore store;

  Phase phase = Phase.boot;
  bool busy = false;
  String? error;
  String? deviceToken, deviceId;
  Branch? branch;
  List<Cashier> cashiers = [];
  Cashier? picked;
  AppUser? user;
  String? sectionKind, sectionLabel;
  bool enteringOtherCode = false;       // شاشة إدخال رمز قسم آخر فوق بطاقات الكاشيرين

  static const _kDeviceKey = 'device_key', _kDeviceToken = 'device_token';

  Future<String> _deviceKey() async {
    var k = await store.read(_kDeviceKey);
    if (k == null) { k = randomDeviceKey(); await store.write(_kDeviceKey, k); }
    return k;
  }

  void _set({Phase? p, bool? b, String? e, bool clearError = false}) {
    if (p != null) phase = p;
    if (b != null) busy = b;
    error = clearError ? null : (e ?? error);
    notifyListeners();
  }

  Future<void> boot() async {
    deviceToken = await store.read(_kDeviceToken);
    if (deviceToken == null) return _set(p: Phase.needsCode, clearError: true);
    try {
      await _loadCards();
      _set(p: Phase.cards, clearError: true);
    } on ApiException catch (e) {
      if (e.status == 401 || e.status == 403 || e.status == 409) { await _forgetDevice(); _set(p: Phase.needsCode, e: e.message); }
      else { _set(p: Phase.cards, e: e.message); }      // انقطاع شبكة: نُبقي الجهاز مفعّلاً ونعرض البطاقات المحفوظة (فارغة) مع الخطأ
    }
  }

  Future<void> _loadCards() async {
    final r = await api.post('/terminal/cashiers', body: {'deviceToken': deviceToken}) as Map;
    branch = Branch.fromJson(r['branch'] as Map);
    cashiers = [for (final c in (r['cashiers'] as List)) Cashier.fromJson(c as Map)];
  }

  Future<void> refreshCards() async {
    try { await _loadCards(); _set(clearError: true); } on ApiException catch (e) { _set(e: e.message); }
  }

  /// إدخال رمز من 9 أرقام (تفعيل الجهاز أو فتح قسم)
  Future<void> enterCode(String code) async {
    _set(b: true, clearError: true);
    try {
      final r = await api.post('/terminal/enter', body: {'code': code, 'deviceKey': await _deviceKey(), 'deviceName': 'تابلت ${(await _deviceKey()).substring(0, 4)}'}) as Map;
      final kind = '${r['kind']}';
      deviceId = '${r['deviceId']}';
      branch = Branch.fromJson(r['branch'] as Map);
      if (kind == 'cashier') {
        deviceToken = '${r['deviceToken']}';
        await store.write(_kDeviceToken, deviceToken!);
        cashiers = [for (final c in (r['cashiers'] as List)) Cashier.fromJson(c as Map)];
        enteringOtherCode = false;
        _set(p: Phase.cards, b: false);
      } else {
        api.token = '${r['token']}';
        user = AppUser.fromJson(r['user'] as Map);
        sectionKind = kind;
        sectionLabel = '${r['kindLabel']}';
        enteringOtherCode = false;
        _set(p: Phase.section, b: false);
      }
    } on ApiException catch (e) {
      _set(b: false, e: e.message);
    }
  }

  void pick(Cashier c) { picked = c; _set(p: Phase.pin, clearError: true); }
  void backToCards() { picked = null; _set(p: Phase.cards, clearError: true); }
  void openOtherCode() { enteringOtherCode = true; _set(clearError: true); }
  void closeOtherCode() { enteringOtherCode = false; _set(clearError: true); }

  Future<void> loginCashier(String pin) async {
    if (picked == null) return;
    _set(b: true, clearError: true);
    try {
      final r = await api.post('/terminal/cashier-login', body: {'deviceToken': deviceToken, 'userId': picked!.id, 'pin': pin}) as Map;
      api.token = '${r['token']}';
      user = AppUser.fromJson(r['user'] as Map);
      _set(p: Phase.pos, b: false);
    } on ApiException catch (e) {
      if (e.status == 403 || e.status == 401 && e.message.contains('الجهاز')) { _set(b: false, e: e.message); }
      else { _set(b: false, e: e.message); }
    }
  }

  /// تسجيل الخروج: ننهي جلسة المستخدم ونعود للبطاقات — الجلسة المالية (الدرج) تبقى مفتوحة على الجهاز ليكملها كاشير آخر
  Future<void> logout() async {
    try { await api.post('/auth/logout'); } catch (_) {/* حتى لو فشل الطلب نخرج محلياً */}
    _clearUser();
    try { await _loadCards(); } catch (_) {}
    _set(p: Phase.cards, clearError: true);
  }

  void _clearUser() { api.token = null; user = null; picked = null; sectionKind = null; sectionLabel = null; }

  void _expired() {
    if (phase != Phase.pos && phase != Phase.section) return;
    _clearUser();
    _set(p: deviceToken != null ? Phase.cards : Phase.needsCode, e: 'انتهت الجلسة — سجّل الدخول من جديد');
  }

  Future<void> _forgetDevice() async { await store.delete(_kDeviceToken); deviceToken = null; cashiers = []; branch = null; }

  /// إعادة ضبط الجهاز (يتطلب إدخال رمز تفعيل من جديد)
  Future<void> resetDevice() async { await _forgetDevice(); _clearUser(); _set(p: Phase.needsCode, clearError: true); }
}
