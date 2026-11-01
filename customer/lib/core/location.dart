import 'package:geolocator/geolocator.dart';
import 'geo.dart';

/// مصدر موقع العميل — واجهة ليسهل استبدالها في الاختبارات
abstract class LocationProvider {
  /// موقع الجهاز، أو null لو الإذن مرفوض/الخدمة مغلقة/تعذّر التحديد
  Future<LatLng?> current();

  /// آخر موقع معروف (فوري إن وُجد) — لعرض الأقرب بلا انتظار
  Future<LatLng?> lastKnown();
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
  Future<LatLng?> lastKnown() async {
    try {
      final p = await Geolocator.getLastKnownPosition();
      return p == null ? null : LatLng(p.latitude, p.longitude);
    } catch (_) {
      return null;
    }
  }
}
