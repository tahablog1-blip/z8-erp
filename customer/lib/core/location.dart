import 'package:geolocator/geolocator.dart';
import 'geo.dart';

/// نتيجة طلب قراءة دقيقة للموقع (للتحقق من الوجود أمام الفرع)
enum GeoStatus { ok, serviceOff, denied, deniedForever, failed }

class GeoFix {
  const GeoFix({required this.lat, required this.lng, required this.accuracy, required this.mocked, required this.ageS});
  final double lat, lng, accuracy, ageS;
  final bool mocked;        // علامة «موقع وهمي» من نظام أندرويد
}

class GeoResult {
  const GeoResult(this.status, [this.fix]);
  final GeoStatus status;
  final GeoFix? fix;
}

/// مصدر موقع العميل — واجهة ليسهل استبدالها في الاختبارات
abstract class LocationProvider {
  /// موقع الجهاز، أو null لو الإذن مرفوض/الخدمة مغلقة/تعذّر التحديد
  Future<LatLng?> current();

  /// آخر موقع معروف (فوري إن وُجد) — لعرض الأقرب بلا انتظار
  Future<LatLng?> lastKnown();

  /// قراءة جديدة عالية الدقة مع سبب الفشل (خدمة الموقع مغلقة / الإذن مرفوض…)
  Future<GeoResult> fix();

  /// يفتح إعدادات الموقع أو إعدادات التطبيق حسب سبب الفشل
  Future<void> openSettings(GeoStatus why);
}

class DeviceLocation implements LocationProvider {
  const DeviceLocation();
  @override
  Future<LatLng?> current() async {
    try {
      if (!await Geolocator.isLocationServiceEnabled()) return null;
      var perm = await Geolocator.checkPermission();
      if (perm == LocationPermission.denied) perm = await Geolocator.requestPermission();
      if (perm == LocationPermission.denied || perm == LocationPermission.deniedForever) return null;
      // أي موقع مخزّن حديثاً يكفي للفرز فوراً، ثم نحدّثه بقراءة دقيقة
      final p = await Geolocator.getCurrentPosition(locationSettings: const LocationSettings(accuracy: LocationAccuracy.medium, timeLimit: Duration(seconds: 12)));
      return LatLng(p.latitude, p.longitude);
    } catch (_) {
      return null;
    }
  }

  @override
  Future<GeoResult> fix() async {
    try {
      if (!await Geolocator.isLocationServiceEnabled()) return const GeoResult(GeoStatus.serviceOff);
      var perm = await Geolocator.checkPermission();
      if (perm == LocationPermission.denied) perm = await Geolocator.requestPermission();
      if (perm == LocationPermission.deniedForever) return const GeoResult(GeoStatus.deniedForever);
      if (perm == LocationPermission.denied) return const GeoResult(GeoStatus.denied);
      final p = await Geolocator.getCurrentPosition(locationSettings: const LocationSettings(accuracy: LocationAccuracy.best, timeLimit: Duration(seconds: 20)));
      final age = DateTime.now().difference(p.timestamp).inMilliseconds / 1000.0;
      return GeoResult(GeoStatus.ok, GeoFix(lat: p.latitude, lng: p.longitude, accuracy: p.accuracy, mocked: p.isMocked, ageS: age < 0 ? 0 : age));
    } catch (_) {
      return const GeoResult(GeoStatus.failed);
    }
  }

  @override
  Future<void> openSettings(GeoStatus why) async {
    if (why == GeoStatus.serviceOff) {
      await Geolocator.openLocationSettings();
    } else {
      await Geolocator.openAppSettings();
    }
  }

  @override
  Future<LatLng?> lastKnown() async {
    try {
      final p = await Geolocator.getLastKnownPosition();
      return p == null ? null : LatLng(p.latitude, p.longitude);
    } catch (_) {
      return null;
    }
  }
}
