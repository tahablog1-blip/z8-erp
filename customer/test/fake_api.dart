import 'package:z8_customer/core/api.dart';

const branch = '11111111-2222-3333-4444-555555555555';

class FakeApi implements CustomerApi {
  FakeApi({this.otpRequired = true});
  final bool otpRequired;
  final sentMessages = <String>[];
  final bookings = <Map<String, dynamic>>[];
  String? lastOtpToken;
  int ahead = 2;
  String state = 'waiting';
  bool expireOtp = false;

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
  Future<Map<String, dynamic>> bookSaved(String b, {required String carId, String? otpToken, String? odometer, String serviceType = 'basic'}) async {
    if (expireOtp) throw ApiException('انتهت صلاحية التحقق — أعد التحقق برمز جديد', status: 401);
    lastOtpToken = otpToken;
    bookings.add({'saved': carId});
    return _booking('1234 ABC');
  }

  @override
  Future<Map<String, dynamic>> bookNew(String b, {required String name, required String phone, required Map<String, dynamic> car, String? otpToken}) async {
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
