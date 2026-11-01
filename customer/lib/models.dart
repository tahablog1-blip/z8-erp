// نماذج البيانات القادمة من المسارات العامة للحجز
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
  const BranchInfo({required this.name, required this.waiting, required this.inService, required this.estWaitMinutes, required this.otpRequired});
  final String name;
  final int waiting, inService, estWaitMinutes;
  final bool otpRequired;
  factory BranchInfo.fromJson(Map<String, dynamic> j) {
    final otp = j['otp'];
    return BranchInfo(
      name: _s(j['branchName']), waiting: _i(j['waiting']), inService: _i(j['inService']), estWaitMinutes: _i(j['estWaitMinutes']),
      otpRequired: otp is Map && otp['required'] == true,
    );
  }
}

class SavedCar {
  const SavedCar({required this.id, required this.plate, required this.brand, required this.name, required this.year, required this.serviceType});
  final String id, plate, brand, name, year, serviceType;
  String get title => [brand, name].where((e) => e.isNotEmpty).join(' ');
  factory SavedCar.fromJson(Map<String, dynamic> j) => SavedCar(
        id: _s(j['id']), plate: _s(j['plate']), brand: _s(j['brand']), name: _s(j['name']), year: _s(j['model_year']),
        serviceType: _s(j['service_type']).isEmpty ? 'basic' : _s(j['service_type']));
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

class ServiceNote {
  const ServiceNote({required this.number, required this.type, required this.title, required this.description});
  final String number, type, title, description;
  factory ServiceNote.fromJson(Map<String, dynamic> j) =>
      ServiceNote(number: _s(j['note_number']), type: _s(j['type']), title: _s(j['title']), description: _s(j['description']));
}
