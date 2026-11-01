// حالة التطبيق: الفرع المحفوظ → تحقق OTP → ملف العميل وسياراته → الحجز الحيّ
import 'dart:async';
import 'package:flutter/foundation.dart';
import '../core/api.dart';
import '../core/config.dart';
import '../core/store.dart';
import '../models.dart';

enum Phase { boot, needsBranch, ready }

class AppState extends ChangeNotifier {
  AppState({required this.api, required this.store});
  final CustomerApi api;
  final KeyValueStore store;

  Phase phase = Phase.boot;
  String? branchId;
  BranchInfo? info;
  String? infoError;
  String? otpToken;
  String phone = '';
  Profile profile = Profile.empty;
  Booking? booking;
  bool busy = false;

  static const _kBranch = 'branch', _kToken = 'otp', _kPhone = 'phone', _kBooking = 'booking';
  bool get verified => otpToken != null;

  Future<void> init() async {
    branchId = (await store.read(_kBranch)) ?? (Config.defaultBranchId.isEmpty ? null : Config.defaultBranchId);
    otpToken = await store.read(_kToken);
    phone = (await store.read(_kPhone)) ?? '';
    if (branchId == null) {
      phase = Phase.needsBranch;
      notifyListeners();
      return;
    }
    phase = Phase.ready;
    notifyListeners();
    await refreshAll();
  }

  /// يقبل رابط الحجز أو المعرّف نفسه
  Future<String?> setBranch(String input) async {
    final id = parseBranchId(input);
    if (id == null) return 'الرابط أو الرمز غير صحيح';
    try {
      final j = await api.branchInfo(id);
      info = BranchInfo.fromJson(j);
    } on ApiException catch (e) {
      return e.message;
    }
    branchId = id;
    await store.write(_kBranch, id);
    phase = Phase.ready;
    infoError = null;
    notifyListeners();
    await refreshAll();
    return null;
  }

  Future<void> changeBranch() async {
    await store.delete(_kBranch);
    await logout();
    branchId = null;
    info = null;
    phase = Phase.needsBranch;
    notifyListeners();
  }

  Future<void> refreshAll() async {
    await refreshInfo();
    await loadProfile();
    await restoreBooking();
  }

  Future<void> refreshInfo() async {
    if (branchId == null) return;
    try {
      info = BranchInfo.fromJson(await api.branchInfo(branchId!));
      infoError = null;
    } on ApiException catch (e) {
      infoError = e.message;
    }
    notifyListeners();
  }

  Future<void> loadProfile() async {
    if (branchId == null) return;
    if (info?.otpRequired == true && otpToken == null) return;
    if (info?.otpRequired != true && phone.length < 9) return;
    try {
      profile = Profile.fromJson(await api.lookup(branchId!, phone: phone, otpToken: otpToken));
    } on ApiException catch (e) {
      if (e.status == 401) await _dropOtp();
    }
    notifyListeners();
  }

  Future<void> _dropOtp() async {
    otpToken = null;
    profile = Profile.empty;
    await store.delete(_kToken);
  }

  Future<void> logout() async {
    await _dropOtp();
    phone = '';
    booking = null;
    await store.delete(_kPhone);
    await store.delete(_kBooking);
    notifyListeners();
  }

  // ── التحقق برمز OTP ──
  Future<String?> sendOtp(String rawPhone) async {
    try {
      await api.otpSend(branchId!, rawPhone);
      return null;
    } on ApiException catch (e) {
      return e.message;
    }
  }

  Future<String?> verifyOtp(String rawPhone, String code) async {
    try {
      final r = await api.otpVerify(branchId!, rawPhone, code);
      otpToken = '${r['token']}';
      phone = rawPhone;
      await store.write(_kToken, otpToken!);
      await store.write(_kPhone, phone);
      final p = r['profile'];
      profile = p is Map ? Profile.fromJson(Map<String, dynamic>.from(p)) : Profile.empty;
      notifyListeners();
      return null;
    } on ApiException catch (e) {
      return e.message;
    }
  }

  /// بدون OTP (الشركة لم تفعّل واتساب/بريد): نتعرّف على العميل برقم الجوال فقط
  Future<void> useOpenPhone(String rawPhone) async {
    phone = rawPhone;
    await store.write(_kPhone, rawPhone);
    await loadProfile();
  }

  // ── الحجز ──
  Future<String?> bookSaved(SavedCar car, {String? odometer}) => _book(() => api.bookSaved(branchId!, carId: car.id, otpToken: otpToken, odometer: odometer, serviceType: car.serviceType));

  Future<String?> bookNew({required String name, required String phoneNo, required Map<String, dynamic> car}) =>
      _book(() => api.bookNew(branchId!, name: name, phone: phoneNo, car: car, otpToken: otpToken));

  Future<String?> _book(Future<Map<String, dynamic>> Function() call) async {
    busy = true;
    notifyListeners();
    try {
      booking = Booking.fromJson(await call());
      await store.write(_kBooking, booking!.id);
      busy = false;
      notifyListeners();
      unawaited(loadProfile());
      return null;
    } on ApiException catch (e) {
      busy = false;
      if (e.status == 401) await _dropOtp();
      notifyListeners();
      return e.message;
    }
  }

  Future<void> restoreBooking() async {
    final id = booking?.id ?? await store.read(_kBooking);
    if (id == null || id.isEmpty) return;
    await refreshBooking(id);
  }

  Future<void> refreshBooking([String? id]) async {
    final bid = id ?? booking?.id;
    if (bid == null) return;
    try {
      final b = Booking.fromJson(await api.bookingStatus(bid));
      booking = b;
      if (b.state == BookingState.done) await store.delete(_kBooking);
    } on ApiException catch (e) {
      if (e.status == 404) {
        booking = null;
        await store.delete(_kBooking);
      }
    }
    notifyListeners();
  }
}
