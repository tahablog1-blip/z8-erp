// حالة التطبيق: الفرع المحفوظ → تحقق OTP → ملف العميل وسياراته → الحجز الحيّ
import 'dart:async';
import 'package:flutter/foundation.dart';
import '../core/api.dart';
import '../core/config.dart';
import '../core/geo.dart';
import '../core/location.dart';
import '../core/store.dart';
import '../models.dart';

enum Phase { boot, needsBranch, ready }

class AppState extends ChangeNotifier {
  AppState({required this.api, required this.store, required this.location});
  final CustomerApi api;
  final KeyValueStore store;
  final LocationProvider location;

  Phase phase = Phase.boot;
  String? branchId;
  BranchInfo? info;
  String? infoError;
  String? otpToken;
  String phone = '';
  Profile profile = Profile.empty;
  Booking? booking;
  bool busy = false;

  // ── الفروع والموقع ──
  List<Branch> branches = const [];
  String? branchesError;
  bool branchesLoading = false;
  LatLng? where;
  bool locationDenied = false;

  static const _kBranch = 'branch', _kToken = 'otp', _kPhone = 'phone', _kBooking = 'booking';
  bool get verified => otpToken != null;

  Future<void> init() async {
    branchId = (await store.read(_kBranch)) ?? (Config.defaultBranchId.isEmpty ? null : Config.defaultBranchId);
    otpToken = await store.read(_kToken);
    phone = (await store.read(_kPhone)) ?? '';
    if (branchId == null) {
      phase = Phase.needsBranch;
      notifyListeners();
      await loadBranches();
      return;
    }
    phase = Phase.ready;
    notifyListeners();
    await refreshAll();
  }

  /// تحميل كل الفروع، ثم ترتيبها بالأقرب تدريجياً: القائمة تظهر فوراً، وما إن يصل الموقع تُعاد الترتيب مع المسافة ووقت الوصول
  Future<void> loadBranches() async {
    branchesLoading = true;
    branchesError = null;
    notifyListeners();
    try {
      branches = (await api.branches()).map(Branch.fromJson).toList();
    } on ApiException catch (e) {
      branchesError = e.message;
    }
    branchesLoading = false;
    _rank();
    notifyListeners();
    if (branches.isEmpty) return;
    final quick = await location.lastKnown();
    if (quick != null) {
      where = quick;
      _rank();
      notifyListeners();
    }
    final fresh = await location.current();
    if (fresh != null) {
      where = fresh;
      locationDenied = false;
    } else if (quick == null) {
      locationDenied = true;
    }
    _rank();
    notifyListeners();
  }

  void _rank() {
    final w = where;
    for (final b in branches) {
      if (w != null && b.hasLocation) {
        b.distanceKm = haversineKm(w, LatLng(b.latitude!, b.longitude!));
        b.etaMinutes = estimateDriveMinutes(b.distanceKm!);
      } else {
        b.distanceKm = null;
        b.etaMinutes = null;
      }
    }
    branches = [...branches]..sort((a, c) {
        if (a.distanceKm != null && c.distanceKm != null) return a.distanceKm!.compareTo(c.distanceKm!);
        if (a.distanceKm != null) return -1;
        if (c.distanceKm != null) return 1;
        return a.name.compareTo(c.name);
      });
  }

  /// الأقرب بين فروع الخدمة (يُحجز له دور)
  Branch? get nearestService {
    for (final b in branches) {
      if (b.isService && b.distanceKm != null) return b;
    }
    return null;
  }

  /// اختيار فرع خدمة للحجز منه
  Future<void> selectBranch(Branch b) async {
    branchId = b.id;
    await store.write(_kBranch, b.id);
    phase = Phase.ready;
    info = null;
    infoError = null;
    notifyListeners();
    await refreshAll();
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
