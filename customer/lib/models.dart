// نماذج البيانات القادمة من المسارات العامة للحجز
import 'core/i18n.dart';
String _s(dynamic v) => v == null ? '' : '$v';
int _i(dynamic v) => v is num ? v.toInt() : int.tryParse(_s(v)) ?? 0;

/// فرع في قائمة الفروع العامة. distanceKm/etaMinutes تُحسب عند توفر موقع العميل.
class Branch {
  Branch({required this.id, required this.name, required this.isService, required this.address, required this.latitude, required this.longitude,
      required this.waiting, required this.inService, required this.estWaitMinutes});
  final String id, name;
  final bool isService;          // خدمة (يُحجز له دور) أو تجزئة (بيع بالقطعة)
  final String? address;
  final double? latitude, longitude;
  final int? waiting, inService, estWaitMinutes;
  double? distanceKm;
  int? etaMinutes;
  bool get hasLocation => latitude != null && longitude != null;
  factory Branch.fromJson(Map<String, dynamic> j) {
    int? n(dynamic v) => v == null ? null : _i(v);
    double? d(dynamic v) => v is num ? v.toDouble() : double.tryParse(_s(v));
    final addr = _s(j['address']).trim();
    return Branch(
      id: _s(j['id']), name: _s(j['name']), isService: _s(j['category']) != 'retail', address: addr.isEmpty ? null : addr,
      latitude: d(j['latitude']), longitude: d(j['longitude']), waiting: n(j['waiting']), inService: n(j['inService']), estWaitMinutes: n(j['estWaitMinutes']));
  }
}

class BranchInfo {
  const BranchInfo({required this.name, required this.waiting, required this.inService, required this.estWaitMinutes, required this.otpRequired, this.geofence = false, this.geofenceRadiusM = 150});
  final String name;
  final int waiting, inService, estWaitMinutes, geofenceRadiusM;
  final bool otpRequired, geofence;      // geofence: الحجز لا يتم إلا أمام الفرع
  factory BranchInfo.fromJson(Map<String, dynamic> j) {
    final otp = j['otp'];
    return BranchInfo(
      name: _s(j['branchName']), waiting: _i(j['waiting']), inService: _i(j['inService']), estWaitMinutes: _i(j['estWaitMinutes']),
      otpRequired: otp is Map && otp['required'] == true,
      geofence: j['geofence'] is Map && j['geofence']['enabled'] == true,
      geofenceRadiusM: j['geofence'] is Map ? (_i(j['geofence']['radiusM']) == 0 ? 150 : _i(j['geofence']['radiusM'])) : 150,
    );
  }
}

class SavedCar {
  const SavedCar({required this.id, required this.plate, required this.brand, required this.name, required this.year, required this.serviceType, this.cylinders = '', this.engineSize = '', this.fuel = '', this.color = '', this.chassis = '', this.lastOdometer});
  final String id, plate, brand, name, year, serviceType, cylinders, engineSize, fuel, color, chassis;
  final int? lastOdometer;      // آخر ممشى سُجّل لها في زيارة
  String get title => [brand, name].where((e) => e.isNotEmpty).join(' ');
  factory SavedCar.fromJson(Map<String, dynamic> j) => SavedCar(
        id: _s(j['id']), plate: _s(j['plate']), brand: _s(j['brand']), name: _s(j['name']), year: _s(j['model_year']),
        serviceType: _s(j['service_type']).isEmpty ? 'basic' : _s(j['service_type']),
        cylinders: _s(j['cylinders']), engineSize: _s(j['engine_size']), fuel: _s(j['fuel_type']), color: _s(j['color']), chassis: _s(j['chassis_number']),
        lastOdometer: j['last_odometer'] is num ? (j['last_odometer'] as num).toInt() : null);
}

class Profile {
  const Profile({required this.name, required this.phone, required this.cars});
  final String name, phone;
  final List<SavedCar> cars;
  static const empty = Profile(name: '', phone: '', cars: []);
  factory Profile.fromJson(Map<String, dynamic> j) {
    if (j['found'] != true) return empty;
    final c = j['customer'];
    final cars = j['cars'];
    return Profile(
      name: c is Map ? _s(c['name']) : '', phone: c is Map ? _s(c['phone']) : '',
      cars: cars is List ? cars.whereType<Map>().map((e) => SavedCar.fromJson(Map<String, dynamic>.from(e))).toList() : const []);
  }
}

enum BookingState { waiting, inService, done }

class Booking {
  const Booking({required this.id, required this.state, required this.queueNo, required this.ahead, required this.estWaitMinutes, required this.plate, required this.customerName, required this.station, required this.branchName});
  final String id, plate, customerName, branchName;
  final String? station;
  final BookingState state;
  final int queueNo, ahead, estWaitMinutes;
  factory Booking.fromJson(Map<String, dynamic> j) => Booking(
        id: _s(j['bookingId']),
        state: switch (_s(j['state'])) { 'in_service' => BookingState.inService, 'done' => BookingState.done, _ => BookingState.waiting },
        queueNo: _i(j['queueNo']), ahead: _i(j['ahead']), estWaitMinutes: _i(j['estWaitMinutes']),
        plate: _s(j['plate']), customerName: _s(j['customerName']), station: j['station'] == null ? null : _s(j['station']), branchName: _s(j['branchName']));
}

class ChatMessage {
  const ChatMessage({required this.id, required this.fromCustomer, required this.text, required this.at});
  final String id, text;
  final bool fromCustomer;
  final DateTime? at;
  factory ChatMessage.fromJson(Map<String, dynamic> j) => ChatMessage(
        id: _s(j['id']), fromCustomer: _s(j['sender_type']) == 'customer', text: _s(j['message']), at: DateTime.tryParse(_s(j['created_at']))?.toLocal());
}

/// إشعار في صندوق الجرس
class AppNotice {
  const AppNotice({required this.id, required this.kind, required this.title, required this.body, required this.meta, required this.refId, required this.at, required this.read});
  final String id, kind, title, body, meta;
  final String? refId;       // رقم الزيارة (للمحادثة/الدور)
  final DateTime? at;
  final bool read;
  factory AppNotice.fromJson(Map<String, dynamic> j) => AppNotice(
        id: _s(j['id']), kind: _s(j['kind']), title: _s(j['title']), body: _s(j['body']), meta: _s(j['meta']),
        refId: j['refId'] == null ? null : _s(j['refId']), at: DateTime.tryParse(_s(j['at']))?.toLocal(), read: j['read'] == true);
}

/// محادثة بين العميل وفرع بخصوص زيارة
class ChatThread {
  const ChatThread({required this.bookingId, required this.plate, required this.carLabel, required this.branchName, required this.lastMessage, required this.lastFromCustomer, required this.lastAt, required this.unread});
  final String bookingId, plate, carLabel, branchName, lastMessage;
  final bool lastFromCustomer;
  final DateTime? lastAt;
  final int unread;
  factory ChatThread.fromJson(Map<String, dynamic> j) => ChatThread(
        bookingId: _s(j['bookingId']), plate: _s(j['plate']), carLabel: _s(j['carLabel']), branchName: _s(j['branchName']),
        lastMessage: _s(j['lastMessage']), lastFromCustomer: j['lastFromCustomer'] == true,
        lastAt: DateTime.tryParse(_s(j['lastAt']))?.toLocal(), unread: j['unread'] is num ? (j['unread'] as num).toInt() : 0);
}

class ServiceNote {
  const ServiceNote({required this.number, required this.type, required this.title, required this.description});
  final String number, type, title, description;
  factory ServiceNote.fromJson(Map<String, dynamic> j) =>
      ServiceNote(number: _s(j['note_number']), type: _s(j['type']), title: _s(j['title']), description: _s(j['description']));
}

/// أنواع الخدمة التي يختارها العميل (يمكن الجمع بينها في حجز واحد)
enum ServiceKind {
  engine('تغيير زيت ماكينة', 'engine', 4),
  gear('تغيير زيت جير', 'gearbox', 2),
  differential('تغيير زيت دفرنس', 'differential', 1),
  transfer('تغيير زيت دبل', 'transfer', 1);

  const ServiceKind(this.label, this.oilType, this.defaultQty);
  final String label;
  final String oilType;     // يطابق products.oil_type
  final int defaultQty;     // عدد القطع (عبوات) — أعداد صحيحة فقط، والفني يؤكد الكمية
}

class OilProduct {
  const OilProduct({required this.id, required this.name, required this.spec, required this.brand, required this.price, required this.oilType, required this.image, this.inStock = true});
  final String id, name, spec, brand;
  final bool inStock;   // متوفر بمخزون الفرع؟
  final double price;
  final String? oilType, image;
  String get title => spec.isEmpty ? name : '$name $spec';
  factory OilProduct.fromJson(Map<String, dynamic> j) => OilProduct(
        id: _s(j['id']), name: _s(j['name']), spec: _s(j['spec']), brand: _s(j['brand']),
        price: j['price'] is num ? (j['price'] as num).toDouble() : double.tryParse(_s(j['price'])) ?? 0,
        oilType: j['oilType'] == null ? null : _s(j['oilType']), image: j['image'] == null ? null : _s(j['image']),
        inStock: j['inStock'] != false);
}

class InvoiceItem {
  const InvoiceItem({required this.label, required this.qty, required this.lineInc});
  final String label;
  final double qty, lineInc;
  factory InvoiceItem.fromJson(Map<String, dynamic> j) => InvoiceItem(
        label: _s(j['label']), qty: j['qty'] is num ? (j['qty'] as num).toDouble() : 0, lineInc: j['lineInc'] is num ? (j['lineInc'] as num).toDouble() : 0);
}

class Invoice {
  const Invoice({required this.id, required this.no, required this.issuedAt, required this.total, required this.plate, required this.carLabel, required this.odometer, required this.items});
  final String id, no;
  final DateTime? issuedAt;
  final double total;
  final String? plate, carLabel;
  final int? odometer;
  final List<InvoiceItem> items;
  factory Invoice.fromJson(Map<String, dynamic> j) {
    final it = j['items'];
    return Invoice(
      id: _s(j['id']), no: _s(j['invoiceNo']), issuedAt: DateTime.tryParse(_s(j['issuedAt']))?.toLocal(),
      total: j['total'] is num ? (j['total'] as num).toDouble() : 0, plate: j['plate'] == null ? null : _s(j['plate']),
      carLabel: j['carLabel'] == null ? null : _s(j['carLabel']), odometer: j['odometer'] == null ? null : _i(j['odometer']),
      items: it is List ? it.whereType<Map>().map((e) => InvoiceItem.fromJson(Map<String, dynamic>.from(e))).toList() : const []);
  }
}

class InvoiceList {
  const InvoiceList(this.invoices, this.pdfPhone);
  final List<Invoice> invoices;
  final String pdfPhone;
}

/// محرك مربوط بفلاتر خاصة (مثل 4 سلندر أو 6 سلندر)
class EngineChoice {
  const EngineChoice({required this.label, this.cylinders, this.engineSize});
  final String label;
  final String? cylinders, engineSize;
  /// نص العرض بلغة المستخدم (التسمية القادمة من الخادم عربية)
  String get display => [
        if ((cylinders ?? '').isNotEmpty) tr('{0} سلندر', [cylinders]),
        if ((engineSize ?? '').isNotEmpty) engineSize!,
      ].join(' · ');
  factory EngineChoice.fromJson(Map<String, dynamic> j) => EngineChoice(
        label: _s(j['label']), cylinders: j['cylinders'] == null ? null : _s(j['cylinders']), engineSize: j['engineSize'] == null ? null : _s(j['engineSize']));
}

class OilBrand {
  const OilBrand(this.name, this.logo);
  final String name;
  final String? logo;
  factory OilBrand.fromJson(Map<String, dynamic> j) => OilBrand(_s(j['name']), j['logo'] == null ? null : _s(j['logo']));
}

class Catalog {
  const Catalog({required this.oils, required this.brands});
  final List<OilProduct> oils;
  final List<OilBrand> brands;
  static const empty = Catalog(oils: [], brands: []);
  factory Catalog.fromJson(Map<String, dynamic> j) {
    List<T> l<T>(String k, T Function(Map<String, dynamic>) f) {
      final v = j[k];
      return v is List ? v.whereType<Map>().map((e) => f(Map<String, dynamic>.from(e))).toList() : <T>[];
    }
    return Catalog(oils: l('oils', OilProduct.fromJson), brands: l('brands', OilBrand.fromJson));
  }
}
