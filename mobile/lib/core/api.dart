// lib/core/api.dart — عميل الـ API: Bearer + أخطاء بعربية واحدة كما في lib/api.ts بالموقع
import 'package:dio/dio.dart';
import 'config.dart';

class ApiException implements Exception {
  ApiException(this.message, {this.status});
  final String message;
  final int? status;
  @override
  String toString() => message;
}

class Api {
  Api({String? base, Dio? dio})
      : _dio = dio ?? Dio(BaseOptions(baseUrl: '${base ?? Config.apiBase}/api', connectTimeout: const Duration(seconds: 12), receiveTimeout: const Duration(seconds: 30), validateStatus: (_) => true));
  final Dio _dio;
  String? token;
  /// يُستدعى عند 401 لطلب مصادق (انتهت الجلسة أو أُنهيت من الإدارة)
  void Function()? onUnauthorized;

  Future<dynamic> _send(String method, String path, {Object? body, Map<String, dynamic>? query, String? bearer}) async {
    final t = bearer ?? token;
    try {
      final res = await _dio.request(path, data: body, queryParameters: query, options: Options(method: method, headers: {if (t != null) 'Authorization': 'Bearer $t'}));
      final code = res.statusCode ?? 0;
      if (code >= 200 && code < 300) return res.data;
      if (code == 401 && t != null && bearer == null) onUnauthorized?.call();
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
      403 => 'ليس لديك صلاحية لهذا الإجراء',
      404 => 'غير موجود',
      429 => 'محاولات كثيرة — انتظر قليلاً ثم حاول مجدداً',
      >= 500 => 'خطأ في الخادم — حاول مجدداً',
      _ => 'خطأ غير متوقع ($code)',
    };
  }

  Future<dynamic> get(String p, {Map<String, dynamic>? query}) => _send('GET', p, query: query);
  Future<dynamic> post(String p, {Object? body, String? bearer}) => _send('POST', p, body: body ?? {}, bearer: bearer);
  Future<dynamic> put(String p, {Object? body}) => _send('PUT', p, body: body ?? {});

  /// تحميل ملف ثنائي (PDF الفاتورة)
  Future<List<int>> bytes(String path) async {
    final res = await _dio.get<List<int>>(path, options: Options(responseType: ResponseType.bytes, headers: {if (token != null) 'Authorization': 'Bearer $token'}));
    if ((res.statusCode ?? 0) >= 300) throw ApiException('تعذّر تحميل الملف', status: res.statusCode);
    return res.data ?? const [];
  }
}
