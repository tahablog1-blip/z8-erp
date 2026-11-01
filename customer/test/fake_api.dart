import 'package:z8_customer/core/api.dart';
import 'package:z8_customer/core/geo.dart';
import 'package:z8_customer/core/location.dart';

const branch = '11111111-2222-3333-4444-555555555555';
const retailBranch = '22222222-2222-3333-4444-555555555555';
const farBranch = '33333333-2222-3333-4444-555555555555';

class FakeApi implements CustomerApi {
  FakeApi({this.otpRequired = true});
  final bool otpRequired;
  final sentMessages = <String>[];
  final bookings = <Map<String, dynamic>>[];
  String? lastOtpToken;
  int ahead = 2;
  String state = 'waiting';
  bool expireOtp = false;
  Map<String, dynamic>? lastSelection;
  final invoiceCalls = <String?>[];

  List<Map<String, dynamic>> branchList = [
    {'id': branch, 'name': 'فرع الخليج', 'category': 'service', 'address': 'حي الخليج', 'latitude': 24.7136, 'longitude': 46.6753, 'waiting': 3, 'inService': 1, 'estWaitMinutes': 54, 'bookable': true},
    {'id': retailBranch, 'name': 'معرض التجزئة', 'category': 'retail', 'address': 'طريق الملك', 'latitude': 24.7200, 'longitude': 46.6800, 'waiting': null, 'inService': null, 'estWaitMinutes': null, 'bookable': false},
    {'id': farBranch, 'name': 'فرع الشرق', 'category': 'service', 'address': null, 'latitude': 24.9, 'longitude': 46.9, 'waiting': 0, 'inService': 0, 'estWaitMinutes': 0, 'bookable': true},
    {'id': 'noloc', 'name': 'فرع بلا موقع', 'category': 'service', 'address': null, 'latitude': null, 'longitude': null, 'waiting': 0, 'inService': 0, 'estWaitMinutes': 0, 'bookable': true},
  ];
  @override
  Future<List<Map<String, dynamic>>> branches() async => branchList;

  @override
  Future<Map<String, dynamic>> branchInfo(String b) async {
    if (b != branch) throw ApiException('الفرع غير متاح للحجز حالياً', status: 404);
    return {'branchName': 'فرع الخليج', 'waiting': 3, 'inService': 1, 'estWaitMinutes': 24, 'otp': {'phone': true, 'email': false, 'required': otpRequired}};
  }

  @override
  Future<Map<String, dynamic>> otpSend(String b, String phone) async => {'to': phone, 'resendIn': 60};
  @override
  Future<Map<String, dynamic>> otpVerify(String b, String phone, String code) async {
    if (code != '1234') throw ApiException('الرمز غير صحيح', status: 400);
    return {'token': 'tok-1', 'channel': 'phone', 'target': phone, 'profile': _profile()};
  }

  Map<String, dynamic> _profile() => {
        'found': true,
        'customer': {'id': 'c1', 'name': 'أحمد', 'phone': '0500000000'},
        'cars': [{'id': 'car-1', 'plate': '1234 ABC', 'brand': 'تويوتا', 'name': 'كامري', 'model_year': '2020', 'service_type': 'basic'}],
      };

  @override
  Future<Map<String, dynamic>> lookup(String b, {String phone = '', String? otpToken}) async => otpToken == null && phone.length < 9 ? {'found': false} : _profile();
  @override
  Future<List<String>> brands(String b) async => ['تويوتا', 'هيونداي'];
  @override
  Future<List<String>> models(String b, String brand) async => ['كامري', 'كورولا'];

  Map<String, dynamic> _booking(String plate) => {
        'bookingId': 'bk-1', 'state': state, 'queueNo': 4, 'ahead': ahead, 'estWaitMinutes': ahead * 8,
        'plate': plate, 'customerName': 'أحمد', 'station': null, 'branchName': 'فرع الخليج',
      };

  @override
  Future<Map<String, dynamic>> bookSaved(String b, {required String carId, String? otpToken, String? odometer, String serviceType = 'basic', Map<String, dynamic>? selection}) async {
    lastSelection = selection;
    if (expireOtp) throw ApiException('انتهت صلاحية التحقق — أعد التحقق برمز جديد', status: 401);
    lastOtpToken = otpToken;
    bookings.add({'saved': carId});
    return _booking('1234 ABC');
  }

  @override
  Future<Map<String, dynamic>> bookNew(String b, {required String name, required String phone, required Map<String, dynamic> car, String? otpToken, Map<String, dynamic>? selection}) async {
    lastSelection = selection;
    lastOtpToken = otpToken;
    bookings.add({'name': name, 'phone': phone, 'car': car});
    return _booking('${car['plateNumbers']} ${car['plateLetters']}');
  }

  @override
  Future<Map<String, dynamic>> bookingStatus(String id) async {
    if (id != 'bk-1') throw ApiException('الحجز غير موجود', status: 404);
    return _booking('1234 ABC');
  }

  @override
  Future<Map<String, dynamic>> catalog(String b) async => {
        'oils': [
          {'id': 'o-eng', 'name': 'شل هيلكس', 'spec': '5W-30', 'brand': 'شل', 'price': 40.0, 'oilType': 'engine', 'image': null},
          {'id': 'o-gear', 'name': 'كاسترول قير', 'spec': '75W-90', 'brand': 'كاسترول', 'price': 55.0, 'oilType': 'gearbox', 'image': '/api/products/public/product-image/o-gear'},
          {'id': 'o-diff', 'name': 'موبيل دفرنس', 'spec': '80W', 'brand': 'موبيل', 'price': 35.0, 'oilType': 'differential', 'image': null},
          {'id': 'o-misc', 'name': 'زيت عام', 'spec': '', 'brand': '', 'price': 20.0, 'oilType': null, 'image': null},
        ],
        'brands': [
          {'name': 'شل', 'logo': '/api/products/public/brand-logo/b1'},
          {'name': 'كاسترول', 'logo': null},
          {'name': 'موبيل', 'logo': null},
        ],
        'filters': <dynamic>[],
        'services': [
          {'id': 'fee-gear', 'name': 'أجرة تغيير زيت قير', 'oilType': 'gearbox', 'price': 25.0},
        ],
      };
  @override
  Future<Map<String, dynamic>?> autoService(String b, {required String brand, required String model, required String year}) async =>
      {'id': 'svc1', 'name': 'خدمة تغيير زيت', 'price': 30.0};
  @override
  Future<Map<String, dynamic>?> filterMatch(String b, {required String brand, required String model, required String year}) async =>
      brand == 'تويوتا' ? {'id': 'f1', 'name': 'فلتر كامري', 'spec': '', 'price': 25.0} : null;

  @override
  Future<Map<String, dynamic>> invoices(String b, {String phone = '', String? otpToken, String? savedCarId}) async {
    if (expireOtp) throw ApiException('انتهت صلاحية التحقق — أعد التحقق برمز جديد', status: 401);
    invoiceCalls.add(savedCarId);
    final all = [
      {'id': 'i1', 'invoiceNo': 'A-100', 'issuedAt': '2026-10-01T09:00:00Z', 'total': 150.0, 'plate': '1234 ABC', 'carLabel': 'تويوتا كامري 2020', 'odometer': 80000, 'items': [{'label': 'زيت ماكينة', 'qty': 4.0, 'lineInc': 120.0}, {'label': 'فلتر زيت', 'qty': 1.0, 'lineInc': 30.0}]},
      {'id': 'i2', 'invoiceNo': 'A-101', 'issuedAt': '2026-08-01T09:00:00Z', 'total': 90.0, 'plate': '1234 ABC', 'carLabel': 'تويوتا كامري 2020', 'odometer': 70000, 'items': [{'label': 'زيت قير', 'qty': 2.0, 'lineInc': 90.0}]},
      {'id': 'i3', 'invoiceNo': 'B-200', 'issuedAt': '2026-09-01T09:00:00Z', 'total': 60.0, 'plate': '9999 XYZ', 'carLabel': 'هيونداي سوناتا', 'odometer': 50000, 'items': [{'label': 'زيت دفرنس', 'qty': 1.0, 'lineInc': 60.0}]},
    ];
    return {'pdfPhone': '0500000000', 'invoices': savedCarId == 'car-1' ? all.where((i) => i['plate'] == '1234 ABC').toList() : all};
  }

  @override
  Future<String> chatToken(String id) async => 'chat-token';
  @override
  Future<Map<String, dynamic>> chatMessages(String token) async => {
        'messages': [
          {'id': 'm1', 'sender_type': 'employee', 'message': 'أهلاً، سيارتك في الدور', 'created_at': '2026-11-01T10:00:00Z'},
          ...sentMessages.map((m) => {'id': 'x$m', 'sender_type': 'customer', 'message': m, 'created_at': '2026-11-01T10:05:00Z'}),
        ],
        'notes': <dynamic>[],
      };
  @override
  Future<void> chatSend(String token, String message) async => sentMessages.add(message);
}

class FakeLocation implements LocationProvider {
  FakeLocation({this.quick, this.fresh});
  final LatLng? quick, fresh;
  @override
  Future<LatLng?> current() async => fresh;
  @override
  Future<LatLng?> lastKnown() async => quick;
}
