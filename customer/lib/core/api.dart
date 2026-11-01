// عميل الـ API للمسارات العامة (بدون حساب): الحجز، التحقق برمز OTP، المحادثة
import 'package:dio/dio.dart';
import 'config.dart';

class ApiException implements Exception {
  ApiException(this.message, {this.status});
  final String message;
  final int? status;
  @override
  String toString() => message;
}

/// واجهة مجرّدة ليسهل استبدالها في الاختبارات
abstract class CustomerApi {
  Future<List<Map<String, dynamic>>> branches();
  Future<Map<String, dynamic>> branchInfo(String branchId);
  Future<Map<String, dynamic>> otpSend(String branchId, String phone);
  Future<Map<String, dynamic>> otpVerify(String branchId, String phone, String code);
  Future<Map<String, dynamic>> lookup(String branchId, {String phone = '', String? otpToken});
  Future<List<String>> brands(String branchId);
  Future<List<String>> models(String branchId, String brand);
  Future<Map<String, dynamic>> bookSaved(String branchId, {required String carId, String? otpToken, String? odometer, String serviceType = 'basic', Map<String, dynamic>? selection});
  Future<Map<String, dynamic>> bookNew(String branchId, {required String name, required String phone, required Map<String, dynamic> car, String? otpToken, Map<String, dynamic>? selection});
  Future<List<Map<String, dynamic>>> oils(String branchId);
  Future<Map<String, dynamic>?> autoService(String branchId, {required String brand, required String model, required String year});
  Future<Map<String, dynamic>?> filterMatch(String branchId, {required String brand, required String model, required String year});
  Future<Map<String, dynamic>> invoices(String branchId, {String phone = '', String? otpToken, String? savedCarId});
  Future<Map<String, dynamic>> bookingStatus(String bookingId);
  Future<String> chatToken(String bookingId);
  Future<Map<String, dynamic>> chatMessages(String token);
  Future<void> chatSend(String token, String message);
}

class Api implements CustomerApi {
  Api({String? base, Dio? dio})
      : _dio = dio ?? Dio(BaseOptions(baseUrl: '${base ?? Config.apiBase}/api', connectTimeout: const Duration(seconds: 12), receiveTimeout: const Duration(seconds: 30), validateStatus: (_) => true));
  final Dio _dio;

  Future<dynamic> _send(String method, String path, {Object? body, Map<String, dynamic>? query}) async {
    try {
      final res = await _dio.request(path, data: body, queryParameters: query, options: Options(method: method));
      final code = res.statusCode ?? 0;
      if (code >= 200 && code < 300) return res.data;
      throw ApiException(_message(res.data, code), status: code);
    } on DioException catch (e) {
      throw ApiException(switch (e.type) {
        DioExceptionType.connectionTimeout || DioExceptionType.receiveTimeout || DioExceptionType.sendTimeout => 'انتهت مهلة الاتصال بالخادم — تحقق من الإنترنت',
        _ => 'تعذّر الاتصال بالخادم — تحقق من الإنترنت',
      });
    }
  }

  static String _message(dynamic data, int code) {
    if (data is Map) {
      final e = data['error'] ?? data['detail'];
      if (e is String && e.isNotEmpty) return e;
      if (e is List && e.isNotEmpty) return 'بيانات غير صالحة — راجع الحقول المطلوبة';
    }
    return switch (code) {
      401 => 'انتهت صلاحية التحقق — أعد التحقق برمز جديد',
      403 => 'غير مسموح',
      404 => 'غير موجود',
      429 => 'محاولات كثيرة — انتظر قليلاً ثم حاول مجدداً',
      >= 500 => 'خطأ في الخادم — حاول مجدداً',
      _ => 'خطأ غير متوقع ($code)',
    };
  }

  Map<String, dynamic> _map(dynamic d) => d is Map ? Map<String, dynamic>.from(d) : <String, dynamic>{};
  List<String> _strings(dynamic d) => d is List ? d.map((e) => '$e').toList() : <String>[];

  @override
  Future<List<Map<String, dynamic>>> branches() async {
    final d = await _send('GET', '/cars/public/branches', query: {if (Config.companyId.isNotEmpty) 'company': Config.companyId});
    return d is List ? d.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList() : <Map<String, dynamic>>[];
  }

  @override
  Future<Map<String, dynamic>> branchInfo(String b) async => _map(await _send('GET', '/cars/public/booking/$b'));
  @override
  Future<Map<String, dynamic>> otpSend(String b, String phone) async =>
      _map(await _send('POST', '/cars/public/booking/$b/otp/send', body: {'channel': 'phone', 'value': phone}));
  @override
  Future<Map<String, dynamic>> otpVerify(String b, String phone, String code) async =>
      _map(await _send('POST', '/cars/public/booking/$b/otp/verify', body: {'channel': 'phone', 'value': phone, 'code': code}));
  @override
  Future<Map<String, dynamic>> lookup(String b, {String phone = '', String? otpToken}) async =>
      _map(await _send('POST', '/cars/public/booking/$b/lookup', body: {'phone': phone, 'otpToken': otpToken}));
  @override
  Future<List<String>> brands(String b) async => _strings(await _send('GET', '/cars/public/car-brands/$b'));
  @override
  Future<List<String>> models(String b, String brand) async => _strings(await _send('GET', '/cars/public/car-models/$b', query: {'brand': brand}));
  @override
  Future<Map<String, dynamic>> bookSaved(String b, {required String carId, String? otpToken, String? odometer, String serviceType = 'basic', Map<String, dynamic>? selection}) async =>
      _map(await _send('POST', '/cars/public/booking/$b',
          body: {'savedCarId': carId, 'odometer': odometer, 'serviceType': serviceType, 'otpToken': otpToken, ...?selection}));
  @override
  Future<Map<String, dynamic>> bookNew(String b, {required String name, required String phone, required Map<String, dynamic> car, String? otpToken, Map<String, dynamic>? selection}) async =>
      _map(await _send('POST', '/cars/public/booking/$b', body: {'serviceType': 'basic', 'name': name, 'phone': phone, 'car': car, 'otpToken': otpToken, ...?selection}));

  @override
  Future<List<Map<String, dynamic>>> oils(String b) async {
    final d = _map(await _send('GET', '/cars/public/booking-products/$b'));
    final l = d['oils'];
    return l is List ? l.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList() : <Map<String, dynamic>>[];
  }

  @override
  Future<Map<String, dynamic>?> autoService(String b, {required String brand, required String model, required String year}) async {
    final d = _map(await _send('GET', '/products/public/booking-service/$b', query: {'brand': brand, 'model': model, 'year': year}));
    final s = d['service'];
    return s is Map ? Map<String, dynamic>.from(s) : null;
  }

  @override
  Future<Map<String, dynamic>?> filterMatch(String b, {required String brand, required String model, required String year}) async {
    final d = await _send('GET', '/cars/public/car-oil-filter-match/$b', query: {'brand': brand, 'model': model, 'year': year, 'kind': 'oil'});
    return d is Map ? Map<String, dynamic>.from(d) : null;
  }

  @override
  Future<Map<String, dynamic>> invoices(String b, {String phone = '', String? otpToken, String? savedCarId}) async =>
      _map(await _send('POST', '/cars/public/booking/$b/invoices', body: {'phone': phone, 'otpToken': otpToken, 'savedCarId': savedCarId}));
  @override
  Future<Map<String, dynamic>> bookingStatus(String id) async => _map(await _send('GET', '/cars/public/booking-status/$id'));
  @override
  Future<String> chatToken(String id) async {
    final d = _map(await _send('GET', '/service-notes/public/car-token/$id'));
    final t = d['token'] ?? d['public_token'];
    if (t is! String || t.isEmpty) throw ApiException('المحادثة غير متاحة لهذا الحجز');
    return t;
  }
  @override
  Future<Map<String, dynamic>> chatMessages(String token) async => _map(await _send('GET', '/service-notes/public/$token/messages'));
  @override
  Future<void> chatSend(String token, String message) async {
    await _send('POST', '/service-notes/public/$token/messages', body: {'message': message, 'messageType': 'text'});
  }
}
