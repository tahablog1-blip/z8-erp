// المسافة ووقت الوصول التقريبي بين العميل والفرع
import 'i18n.dart';
import 'dart:math';

class LatLng {
  const LatLng(this.lat, this.lng);
  final double lat, lng;
}

/// مسافة الخط المستقيم بالكيلومتر (Haversine)
double haversineKm(LatLng a, LatLng b) {
  const r = 6371.0;
  double rad(double d) => d * pi / 180;
  final dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  final h = pow(sin(dLat / 2), 2) + cos(rad(a.lat)) * cos(rad(b.lat)) * pow(sin(dLng / 2), 2);
  return 2 * r * asin(min(1, sqrt(h)));
}

/// تقدير زمن القيادة: المسافة الطرقية ≈ 1.3 × الخط المستقيم، بسرعة متوسطة 30 كم/س داخل المدينة
/// و50 كم/س للمسافات الأطول. تقدير تقريبي لا يعتمد على الازدحام الفعلي.
int estimateDriveMinutes(double straightKm) {
  final road = straightKm * 1.3;
  final speed = road <= 8 ? 30.0 : 50.0;
  return max(1, (road / speed * 60).ceil());
}

String formatKm(double km) => km < 1 ? tr('{0} م', [(km * 1000).round()]) : tr('{0} كم', [km.toStringAsFixed(km < 10 ? 1 : 0)]);

String formatMinutes(int m) {
  if (m < 60) return tr('{0} دقيقة', [m]);
  final h = m ~/ 60, r = m % 60;
  return r == 0 ? tr('{0} ساعة', [h]) : tr('{0} ساعة و{1} دقيقة', [h, r]);
}
