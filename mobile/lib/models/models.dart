// lib/models/models.dart — نماذج البيانات (مرآة أنواع TypeScript بالموقع)
import '../core/format.dart';

class Cashier {
  Cashier(this.id, this.fullName, this.hasPin);
  final String id, fullName;
  final bool hasPin;
  factory Cashier.fromJson(Map j) => Cashier('${j['id']}', '${j['fullName']}', j['hasPin'] == true);
  String get initial { final t = fullName.trim(); return t.isEmpty ? '?' : String.fromCharCode(t.runes.first); }
}

class AppUser {
  AppUser(this.id, this.fullName, this.role, this.branchId, this.permissions);
  final String id, fullName, role;
  final String? branchId;
  final List<String> permissions;
  factory AppUser.fromJson(Map j) => AppUser('${j['id']}', '${j['fullName']}', '${j['role']}', j['branchId']?.toString(), [for (final p in (j['permissions'] as List? ?? const [])) '$p']);
  bool has(String k) => role == 'admin' || permissions.contains(k);
  bool hasAny(List<String> ks) => ks.any(has);
}

class Branch {
  Branch(this.id, this.name);
  final String id, name;
  factory Branch.fromJson(Map j) => Branch('${j['id']}', '${j['name']}');
}

class Product {
  Product({required this.id, required this.name, required this.category, required this.price, required this.priceVat, this.barcode, this.sku, this.spec, this.stockQty, this.isService = false, this.minQty = 0, this.hasImage = false});
  final String id, name, category;
  final double price, priceVat;
  final String? barcode, sku, spec;
  final double? stockQty;
  final bool isService, hasImage;
  final int minQty;
  factory Product.fromJson(Map j) => Product(
        id: '${j['id']}', name: '${j['name']}', category: '${j['category'] ?? ''}',
        price: toNum(j['price']), priceVat: toNum(j['price_vat']),
        barcode: j['barcode']?.toString(), sku: j['sku']?.toString(), spec: j['spec']?.toString(),
        stockQty: j['stock_qty'] == null ? null : toNum(j['stock_qty']),
        isService: j['is_service'] == true, minQty: (j['min_qty'] as num?)?.toInt() ?? 0, hasImage: j['has_image'] == true,
      );
}

class CartLine {
  CartLine({required this.productId, required this.label, required this.qty, required this.unitPrice, required this.unitPriceVat, this.isService = false, this.maxQty});
  final String productId, label;
  int qty;
  final double unitPrice, unitPriceVat;
  final bool isService;
  final double? maxQty;     // المخزون المتاح (لمنع الزيادة عن الرصيد)
  double get totalInc => unitPriceVat * qty;
  Map<String, dynamic> toBody() => {'productId': productId, 'label': label, 'qty': qty, 'unitPrice': unitPrice, 'unitPriceVat': unitPriceVat};
  Map<String, dynamic> toHeld() => {'productId': productId, 'label': label, 'qty': qty, 'unitPrice': unitPrice, 'unitPriceVat': unitPriceVat, 'isService': isService, 'maxQty': maxQty};
  factory CartLine.fromHeld(Map j) => CartLine(productId: '${j['productId']}', label: '${j['label']}', qty: (j['qty'] as num).toInt(), unitPrice: toNum(j['unitPrice']), unitPriceVat: toNum(j['unitPriceVat']), isService: j['isService'] == true, maxQty: j['maxQty'] == null ? null : toNum(j['maxQty']));
}

class Customer {
  Customer(this.id, this.name, this.phone);
  final String id, name;
  final String? phone;
  factory Customer.fromJson(Map j) => Customer('${j['id']}', '${j['name']}', j['phone']?.toString());
}

/// جلسة الجهاز (المبالغ تُحجب من الخادم عن الكاشير العادي)
class ShiftInfo {
  ShiftInfo({required this.id, required this.branchName, required this.openedAt, required this.userName, required this.invoiceCount});
  final String id, branchName, userName;
  final DateTime? openedAt;
  final int invoiceCount;
  factory ShiftInfo.fromReport(Map j) {
    final s = j['shift'] as Map;
    return ShiftInfo(
      id: '${s['id']}', branchName: '${s['branch_name'] ?? ''}', userName: '${s['user_name'] ?? ''}',
      openedAt: DateTime.tryParse('${s['opened_at'] ?? ''}'), invoiceCount: ((j['sales'] as Map?)?['invoiceCount'] as num?)?.toInt() ?? 0,
    );
  }
}

class QueueCar {
  QueueCar({required this.id, required this.plate, required this.title, required this.queueNo, required this.workStatus, this.customerId, this.items = const []});
  final String id, plate, title, workStatus;
  final int queueNo;
  final String? customerId;
  final List<CartLine> items;      // أصناف أمر العمل المجهّز
  factory QueueCar.fromJson(Map j) => QueueCar(
        id: '${j['id']}', plate: '${j['plate'] ?? ''}', queueNo: (j['queue_no'] as num?)?.toInt() ?? 0, workStatus: '${j['work_status'] ?? ''}',
        title: [j['brand'], j['name'], j['model_year']].where((e) => e != null && '$e'.isNotEmpty).join(' '), customerId: j['customer_id']?.toString(),
        items: [for (final i in (j['prepared_items'] as List? ?? const [])) CartLine(productId: '${(i as Map)['productId']}', label: '${i['label']}', qty: (i['qty'] as num).toInt(), unitPrice: toNum(i['unitPrice']), unitPriceVat: toNum(i['unitPriceVat']), isService: i['isService'] == true)],
      );
}

class InvoiceRow {
  InvoiceRow({required this.id, required this.invoiceNo, required this.totalInc, required this.customerName, required this.issuedAt, required this.isReturned});
  final String id, invoiceNo;
  final double totalInc;
  final String? customerName;
  final DateTime? issuedAt;
  final bool isReturned;
  factory InvoiceRow.fromJson(Map j) => InvoiceRow(id: '${j['id']}', invoiceNo: '${j['invoice_no']}', totalInc: toNum(j['total_inc']), customerName: j['customer_name']?.toString(), issuedAt: DateTime.tryParse('${j['issued_at'] ?? ''}'), isReturned: j['is_returned'] == true);
}
