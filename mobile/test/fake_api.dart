// خادم وهمي في الذاكرة لاختبار تدفق التطبيق بلا شبكة
import 'dart:convert';
import 'dart:io';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:z8_pos/core/api.dart';

typedef Handler = dynamic Function(String method, String path, Object? body, String? token);

class FakeApi extends Api {
  FakeApi(this.handler) : super(base: 'http://fake');
  final Handler handler;
  final List<String> calls = [];

  dynamic _run(String m, String p, Object? body) {
    calls.add('$m $p');
    final r = handler(m, p, body, token);
    if (r is ApiException) { if (r.status == 401 && token != null) onUnauthorized?.call(); throw r; }
    return r;
  }

  @override
  Future<dynamic> get(String p, {Map<String, dynamic>? query}) async => _run('GET', p, query);
  @override
  Future<dynamic> post(String p, {Object? body, String? bearer}) async => _run('POST', p, body);
  @override
  Future<dynamic> put(String p, {Object? body}) async => _run('PUT', p, body);
}

/// يحمّل خط Cairo الحقيقي ليظهر النص في لقطات الشاشة كما على الجهاز
Future<void> loadFonts() async {
  TestWidgetsFlutterBinding.ensureInitialized();
  final loader = FontLoader('Cairo')..addFont(rootBundle.load('assets/fonts/Cairo.ttf'));
  await loader.load();
  // خط الأيقونات من حزمة Flutter نفسها ليظهر الشكل الحقيقي في اللقطات
  final iconFile = File('/opt/tools/flutter/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf');
  if (iconFile.existsSync()) {
    final mi = FontLoader('MaterialIcons')..addFont(Future.value(ByteData.sublistView(iconFile.readAsBytesSync())));
    await mi.load();
  }
}


String j(Object o) => jsonEncode(o);
