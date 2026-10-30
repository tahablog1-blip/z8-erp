import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:z8_pos/app.dart';
import 'package:z8_pos/core/api.dart';
import 'package:z8_pos/core/store.dart';
import 'package:z8_pos/state/app_state.dart';
import 'fake_api.dart';

const branch = {'id': 'b1', 'name': 'فرع الخليج'};
final cashiers = [
  {'id': 'u1', 'fullName': 'أحمد العتيبي', 'hasPin': true},
  {'id': 'u2', 'fullName': 'سارة الحربي', 'hasPin': true},
  {'id': 'u3', 'fullName': 'خالد بلا رمز', 'hasPin': false},
];
const userJson = {'id': 'u1', 'email': 'a@x', 'fullName': 'أحمد العتيبي', 'role': 'employee', 'companyId': 'c', 'branchId': 'b1', 'permissions': ['invoices.create_direct', 'invoices.create_service', 'shifts.manage_own', 'invoices.view_today']};
final products = [
  for (var i = 0; i < 12; i++) {'id': 'p$i', 'name': ['فلتر زيت تويوتا', 'زيت موتول 5W30', 'معطر سيارة', 'بطارية 70 أمبير', 'منظف زجاج', 'فلتر هواء'][i % 6] + ' ${i + 1}', 'category': ['فلاتر', 'زيوت', 'إضافات ومعطرات', 'بطاريات', 'أدوات تنظيف', 'فلاتر'][i % 6], 'price': 100.0 + i * 10, 'price_vat': 115.0 + i * 11.5, 'sku': 'SKU-100$i', 'barcode': '6290000000$i', 'is_service': false, 'min_qty': 0},
];

dynamic server(AppStateBox b, String m, String p, Object? body, String? token) {
  switch ('$m $p') {
    case 'POST /terminal/enter':
      if ((body as Map)['code'] == '123456789') return {'kind': 'cashier', 'kindLabel': 'كاشير', 'branch': branch, 'deviceToken': 'dtok', 'deviceId': 'd1', 'cashiers': cashiers};
      const sections = {'555555555': ('service_notes', 'ملاحظات الخدمة'), '666666666': ('cars', 'تسجيل السيارات'), '777777777': ('workorder', 'أمر عمل')};
      if (sections.containsKey(body['code'])) { final (k, l) = sections[body['code']]!; return {'kind': k, 'kindLabel': l, 'branch': branch, 'deviceId': 'd1', 'deviceToken': 'dtok', 'token': 'stok', 'user': userJson}; }
      return ApiException('الرمز غير صحيح', status: 401);
    case 'POST /terminal/cashiers':
      return {'branch': branch, 'cashiers': cashiers};
    case 'POST /terminal/cashier-login':
      return (body as Map)['pin'] == '1234' ? {'token': 'utok', 'user': userJson, 'deviceId': 'd1'} : ApiException('الرمز غير صحيح', status: 401);
    case 'POST /auth/logout':
      b.loggedOut = true; return null;
    case 'GET /products':
      return products;
    case 'GET /inventory/levels':
      return [for (final p in products) {'loc_type': 'branch', 'loc_id': 'b1', 'product_id': p['id'], 'qty': p['id'] == 'p2' ? 0 : 20}];
    case 'GET /shifts/current':
      return b.shiftOpen ? {'shift': {'id': 's1', 'branch_name': 'فرع الخليج', 'user_name': 'أحمد العتيبي', 'opened_at': '2026-10-30T10:00:00Z'}, 'sales': {'invoiceCount': 3}} : null;
    case 'POST /shifts/open':
      b.shiftOpen = true; return {'id': 's1'};
    case 'GET /cars/billing-queue':
      return [];
    case 'GET /cars/preparation-queue':
      return [{'id': 'car1', 'plate': 'ABC 1234', 'brand': 'تويوتا', 'name': 'كامري', 'queue_no': 3, 'work_status': 'queued', 'prepared_items': []}];
    case 'POST /cars/car1/prepare-confirm':
      b.prepareBody = body as Map; return {'plate': 'ABC 1234'};
    case 'GET /cars':
      return [{'id': 'car1', 'plate': 'ABC 1234', 'brand': 'تويوتا', 'name': 'كامري', 'queue_no': 3, 'customer_name': 'عميل'}];
    case 'POST /cars':
      b.carBody = body as Map; return {'plate': 'ABC 1234', 'queue_no': 4};
    case 'GET /service-notes/conversations':
      return [{'work_order_id': 'car1', 'plate': 'ABC 1234', 'customer_name': 'عميل', 'last_message': 'متى تكون جاهزة؟', 'unread': 2}];
    case 'GET /service-notes':
      return [{'id': 'n1', 'note_number': 'SN-0001', 'type': 'technical', 'status': 'new', 'plate': 'ABC 1234', 'customer_name': 'عميل', 'product_name': null}];
    case 'POST /invoices':
      b.invoiceBody = body as Map; return {'id': 'i1', 'invoice_no': 'INV-000007', 'total_inc': 230.0, 'is_returned': false, 'issued_at': '2026-10-30T10:05:00Z'};
  }
  return null;
}

class AppStateBox { bool shiftOpen = false, loggedOut = false; Map? invoiceBody, prepareBody, carBody; }

Future<(AppState, AppStateBox, FakeApi)> make(WidgetTester t, {bool activated = false}) async {
  final box = AppStateBox();
  final api = FakeApi((m, p, body, token) => server(box, m, p, body, token));
  final store = MemoryStore();
  if (activated) await store.write('device_token', 'dtok');
  final app = AppState(api: api, store: store);
  t.view.physicalSize = const Size(1280, 800); t.view.devicePixelRatio = 1;
  addTearDown(t.view.reset);
  await t.pumpWidget(Z8App(app: app));
  app.boot();
  await t.pumpAndSettle();
  return (app, box, api);
}

Future<void> tapDigits(WidgetTester t, String digits) async {
  for (final d in digits.split('')) { await t.tap(find.text(d).first); await t.pump(); }
}

