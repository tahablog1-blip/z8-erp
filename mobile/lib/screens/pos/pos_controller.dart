// lib/screens/pos/pos_controller.dart — منطق نقطة البيع: المنتجات، السلة، الجلسة، الدفع، إصدار الفاتورة، المعلّقة
import 'dart:convert';
import 'dart:math';
import 'package:flutter/foundation.dart';
import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/store.dart';
import '../../models/models.dart';
import '../../state/app_state.dart';

enum PayMethod { cash, card, transfer, credit }

extension PayMethodX on PayMethod {
  String get label => switch (this) { PayMethod.cash => 'نقدي', PayMethod.card => 'شبكة', PayMethod.transfer => 'تحويل', PayMethod.credit => 'آجل' };
}

class PayLine {
  PayLine(this.method, this.amount);
  PayMethod method;
  double amount;
}

class HeldInvoice {
  HeldInvoice({required this.id, required this.time, required this.note, required this.cart, this.carId, this.customer});
  final String id, note;
  final DateTime time;
  final List<CartLine> cart;
  final String? carId;
  final Customer? customer;
  Map<String, dynamic> toJson() => {'id': id, 'time': time.toIso8601String(), 'note': note, 'carId': carId, 'customer': customer == null ? null : {'id': customer!.id, 'name': customer!.name, 'phone': customer!.phone}, 'cart': [for (final l in cart) l.toHeld()]};
  factory HeldInvoice.fromJson(Map j) => HeldInvoice(
        id: '${j['id']}', time: DateTime.tryParse('${j['time']}') ?? DateTime.now(), note: '${j['note'] ?? ''}', carId: j['carId']?.toString(),
        customer: j['customer'] == null ? null : Customer.fromJson(j['customer'] as Map), cart: [for (final l in (j['cart'] as List)) CartLine.fromHeld(l as Map)],
      );
}

class PosController extends ChangeNotifier {
  PosController({required this.app, KeyValueStore? store}) : store = store ?? app.store;
  final AppState app;
  final KeyValueStore store;
  Api get api => app.api;
  AppUser get user => app.user!;
  String get branchId => user.branchId ?? app.branch?.id ?? '';

  // ── بيانات ──
  bool loading = true;
  String? loadError;
  List<Product> products = [];
  Map<String, double> stock = {};
  bool stockKnown = false;
  ShiftInfo? shift;
  List<QueueCar> queue = [];
  List<InvoiceRow> invoices = [];
  List<HeldInvoice> held = [];

  // ── الفاتورة الجارية ──
  final List<CartLine> cart = [];
  QueueCar? car;
  Customer? customer;
  String idemKey = _newKey();
  bool saleBusy = false;
  String? saleError;
  InvoiceRow? lastInvoice;

  bool get canCreate => user.hasAny(['invoices.create', 'invoices.create_direct', 'invoices.create_service']);
  bool get canDirect => user.hasAny(['invoices.create', 'invoices.create_direct']);
  bool get canService => user.hasAny(['invoices.create', 'invoices.create_service']);
  bool get canViewInvoices => user.hasAny(['invoices.view_today', 'invoices.view_all', 'invoices.view_pending']);

  static String _newKey() => '${DateTime.now().microsecondsSinceEpoch}-${Random().nextInt(1 << 32)}';

  Future<void> load() async {
    loading = true; loadError = null; notifyListeners();
    try {
      final r = await Future.wait([
        api.get('/products'),
        api.get('/shifts/current'),
        if (canService) api.get('/cars/billing-queue').catchError((_) => <dynamic>[]) else Future.value(<dynamic>[]),
      ]);
      products = [for (final p in (r[0] as List)) Product.fromJson(p as Map)].where((p) => (p.price > 0 || p.priceVat > 0)).toList();
      shift = r[1] == null ? null : ShiftInfo.fromReport(r[1] as Map);
      queue = [for (final c in (r[2] as List)) QueueCar.fromJson(c as Map)];
      await _loadStock();
      held = await _loadHeld();
    } on ApiException catch (e) {
      loadError = e.message;
    }
    loading = false; notifyListeners();
  }

  Future<void> _loadStock() async {
    try {
      final levels = await api.get('/inventory/levels') as List;
      final m = <String, double>{};
      for (final l in levels) {
        final x = l as Map;
        if (x['loc_type'] == 'branch' && '${x['loc_id']}' == branchId) m['${x['product_id']}'] = toNum(x['qty']);
      }
      stock = m; stockKnown = true;
    } catch (_) { stockKnown = false; }       // صلاحية المخزون اختيارية — الخادم يرفض البيع بأكثر من الرصيد على أي حال
  }

  Future<void> reloadQueue() async {
    if (!canService) return;
    try { queue = [for (final c in (await api.get('/cars/billing-queue') as List)) QueueCar.fromJson(c as Map)]; notifyListeners(); } catch (_) {}
  }

  Future<void> loadInvoices() async {
    try { invoices = [for (final i in (await api.get('/invoices', query: {'limit': 60}) as List)) InvoiceRow.fromJson(i as Map)]; notifyListeners(); } on ApiException catch (e) { loadError = e.message; notifyListeners(); }
  }

  // ── الجلسة ──
  Future<String?> openShift(double openingCash) async {
    try {
      await api.post('/shifts/open', body: {'branchId': branchId, 'openingCash': openingCash});
      final cur = await api.get('/shifts/current');
      shift = cur == null ? null : ShiftInfo.fromReport(cur as Map);
      notifyListeners();
      return null;
    } on ApiException catch (e) { return e.message; }
  }

  Future<String?> closeShift(double counted, String? notes) async {
    if (shift == null) return 'لا توجد جلسة مفتوحة';
    try {
      await api.post('/shifts/${shift!.id}/close', body: {'countedCash': counted, 'notes': notes});
      shift = null; clearSale(); notifyListeners();
      return null;
    } on ApiException catch (e) { return e.message; }
  }

  // ── السلة ──
  List<String> get categories => ['الكل', ...{for (final p in products) if (p.category.trim().isNotEmpty) p.category.trim()}];

  double availableOf(Product p) => p.isService ? double.infinity : (stockKnown ? (stock[p.id] ?? 0) : double.infinity);

  void add(Product p) {
    final avail = availableOf(p);
    final i = cart.indexWhere((l) => l.productId == p.id);
    final cur = i >= 0 ? cart[i].qty : 0;
    if (cur + 1 > avail) { saleError = 'الكمية غير كافية للصنف: ${p.name} (المتاح ${count(avail)})'; notifyListeners(); return; }
    saleError = null;
    if (i >= 0) { cart[i].qty++; } else { cart.add(CartLine(productId: p.id, label: p.name, qty: 1, unitPrice: p.price, unitPriceVat: p.priceVat, isService: p.isService, maxQty: avail.isFinite ? avail : null)); }
    notifyListeners();
  }

  void setQty(CartLine l, int q) {
    if (q <= 0) { cart.remove(l); }
    else if (l.maxQty != null && q > l.maxQty!) { saleError = 'الكمية غير كافية للصنف: ${l.label} (المتاح ${count(l.maxQty)})'; }
    else { l.qty = q; saleError = null; }
    notifyListeners();
  }

  Product? byBarcode(String code) {
    final c = code.trim();
    if (c.isEmpty) return null;
    for (final p in products) { if (p.barcode == c || p.sku == c) return p; }
    return null;
  }

  double get total => cart.fold(0, (s, l) => s + l.totalInc);
  int get itemsCount => cart.fold(0, (s, l) => s + l.qty);

  void clearSale() { cart.clear(); car = null; customer = null; saleError = null; idemKey = _newKey(); }

  void pickCar(QueueCar c) {
    clearSale();
    car = c;
    for (final l in c.items) { cart.add(CartLine(productId: l.productId, label: l.label, qty: l.qty, unitPrice: l.unitPrice, unitPriceVat: l.unitPriceVat, isService: l.isService)); }
    notifyListeners();
  }

  void setCustomer(Customer? c) { customer = c; notifyListeners(); }

  Future<List<Customer>> searchCustomers(String q) async {
    final term = q.trim();
    if (term.length < 2) return [];
    try {
      final all = await api.get('/customers') as List;
      final lower = term.toLowerCase();
      return [for (final c in all) Customer.fromJson(c as Map)].where((c) => c.name.toLowerCase().contains(lower) || (c.phone ?? '').contains(term)).take(8).toList();
    } on ApiException { return []; }
  }

  Future<Customer?> createCustomer(String name, String phone) async {
    try {
      final c = await api.post('/customers', body: {'name': name, 'phone': phone.isEmpty ? null : phone});
      return Customer.fromJson(c as Map);
    } on ApiException catch (e) { saleError = e.message; notifyListeners(); return null; }
  }

  // ── الإصدار ──
  Future<InvoiceRow?> submit(List<PayLine> payments) async {
    if (cart.isEmpty) return null;
    saleBusy = true; saleError = null; notifyListeners();
    try {
      final body = {
        'branchId': branchId, 'source': car != null ? 'car' : 'pos', 'carId': car?.id, 'invoiceType': 'simplified',
        'customerId': customer?.id, 'customerName': customer?.name, 'customerVat': null,
        'items': [for (final l in cart) l.toBody()],
        'payments': [for (final p in payments.where((p) => p.amount > 0)) {'method': p.method.name, 'amount': p.amount}],
        'discountAmount': 0, 'discountReason': null, 'idempotencyKey': idemKey,
      };
      final inv = InvoiceRow.fromJson(await api.post('/invoices', body: body) as Map);
      lastInvoice = inv;
      clearSale();
      saleBusy = false; notifyListeners();
      load();            // تحديث المخزون وطابور الخدمة
      return inv;
    } on ApiException catch (e) {
      saleError = e.message; saleBusy = false; notifyListeners();
      return null;
    }
  }

  // ── الفواتير المعلّقة (محلية على الجهاز، كما في الموقع) ──
  static const _heldKey = 'held_invoices';
  Future<List<HeldInvoice>> _loadHeld() async {
    try { return [for (final j in (jsonDecode(await store.read(_heldKey) ?? '[]') as List)) HeldInvoice.fromJson(j as Map)]; } catch (_) { return []; }
  }
  Future<void> _saveHeld() => store.write(_heldKey, jsonEncode([for (final h in held) h.toJson()]));

  Future<void> holdCurrent(String note) async {
    if (cart.isEmpty) return;
    held.insert(0, HeldInvoice(id: 'H${DateTime.now().millisecondsSinceEpoch}', time: DateTime.now(), note: note.trim(), cart: [for (final l in cart) CartLine.fromHeld(l.toHeld())], carId: car?.id, customer: customer));
    await _saveHeld(); clearSale(); notifyListeners();
  }

  Future<void> resume(HeldInvoice h) async {
    clearSale();
    cart.addAll(h.cart);
    customer = h.customer;
    if (h.carId != null) { for (final c in queue) { if (c.id == h.carId) car = c; } }
    held.removeWhere((x) => x.id == h.id);
    await _saveHeld(); notifyListeners();
  }

  Future<void> deleteHeld(String id) async { held.removeWhere((x) => x.id == id); await _saveHeld(); notifyListeners(); }
}
