// اختيارات العميل لحجزه: الخدمات (يُجمع بينها) والزيت والكمية لكل خدمة + أجرة الخدمة وفلتر الزيت
import 'package:flutter/foundation.dart';
import '../models.dart';

class ServicePick {
  ServicePick(this.kind) : qty = kind.defaultQty;
  final ServiceKind kind;
  OilProduct? oil;
  double qty;
  double get total => (oil?.price ?? 0) * qty;
}

typedef Line = ({String label, double qty, double line});

class BookingSelection extends ChangeNotifier {
  final Map<ServiceKind, ServicePick> picks = {};
  bool withFilter = false;
  OilProduct? filter;                 // فلتر الزيت المطابق للسيارة (لو مربوط من الفرع)
  OilProduct? autoService;            // خدمة تغيير زيت الماكينة بحسب قواعد تسعير السيارة

  bool has(ServiceKind k) => picks.containsKey(k);

  void toggle(ServiceKind k) {
    if (picks.remove(k) == null) picks[k] = ServicePick(k);
    if (!has(ServiceKind.engine)) withFilter = false;
    notifyListeners();
  }

  void setOil(ServiceKind k, OilProduct o) {
    picks[k]?.oil = o;
    notifyListeners();
  }

  void setQty(ServiceKind k, double q) {
    final p = picks[k];
    if (p == null) return;
    p.qty = q.clamp(0.5, 30).toDouble();
    notifyListeners();
  }

  void setFilter(bool on) {
    withFilter = on;
    notifyListeners();
  }

  /// أجرة الخدمة التلقائية لزيت الماكينة فقط (من قواعد تسعير السيارة).
  /// الجير والدفرنس والدبل لها أكثر من خدمة في قائمة الخدمات، فتُحدَّد أجرتها داخل الفرع.
  ({String id, String name, double price})? feeFor(ServiceKind k) {
    if (k == ServiceKind.engine && autoService != null) return (id: autoService!.id, name: autoService!.name, price: autoService!.price);
    return null;
  }

  /// خدمات مختارة أجرتها تُحدَّد في الفرع (جير/دفرنس/دبل)
  List<ServiceKind> get feeAtBranch => [for (final k in picks.keys) if (k != ServiceKind.engine) k];

  /// كل خدمة مختارة يجب أن يكون لها زيت
  bool get complete => picks.isNotEmpty && picks.values.every((p) => p.oil != null);

  /// بنود الفاتورة التقديرية بالترتيب: (زيت + أجرة الماكينة) لكل خدمة ثم الفلتر
  List<Line> get lines {
    final out = <Line>[];
    for (final p in picks.values) {
      if (p.oil == null) continue;
      out.add((label: '${p.kind.label}: ${p.oil!.title}', qty: p.qty, line: p.total));
      final fee = feeFor(p.kind);
      if (fee != null) out.add((label: fee.name, qty: 1, line: fee.price));
    }
    if (withFilter && filter != null && has(ServiceKind.engine)) out.add((label: filter!.title, qty: 1, line: filter!.price));
    return out;
  }

  double get total => lines.fold(0, (s, l) => s + l.line);

  /// الحمولة المرسلة مع الحجز (نفس عقد صفحة الحجز على الموقع)
  Map<String, dynamic>? payload() {
    if (picks.isEmpty) return null;
    final items = <Map<String, dynamic>>[];
    for (final p in picks.values) {
      final o = p.oil;
      if (o == null) continue;
      items.add({'productId': o.id, 'label': '${p.kind.label}: ${o.title}', 'qty': p.qty, 'priceInc': o.price});
      final fee = feeFor(p.kind);
      if (fee != null) items.add({'productId': fee.id, 'label': fee.name, 'qty': 1, 'priceInc': fee.price});
    }
    if (withFilter && filter != null && has(ServiceKind.engine)) {
      items.add({'productId': filter!.id, 'label': filter!.title, 'qty': 1, 'priceInc': filter!.price});
    }
    return {'items': items, 'withFilter': has(ServiceKind.engine) ? withFilter : null, 'fromInvoice': null};
  }
}
