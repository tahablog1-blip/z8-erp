// اختيارات العميل لحجزه: الخدمات (يُجمع بينها) والزيت والكمية لكل خدمة + فلتر الزيت والخدمة التلقائية
import 'package:flutter/foundation.dart';
import '../models.dart';

class ServicePick {
  ServicePick(this.kind) : qty = kind.defaultQty;
  final ServiceKind kind;
  OilProduct? oil;
  double qty;
  double get total => (oil?.price ?? 0) * qty;
}

class BookingSelection extends ChangeNotifier {
  final Map<ServiceKind, ServicePick> picks = {};
  bool withFilter = false;
  OilProduct? filter;          // فلتر الزيت المطابق للسيارة (لو مربوط من الفرع)
  OilProduct? autoService;     // خدمة تغيير الزيت (أجرة) تُضاف تلقائياً مع زيت الماكينة

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

  /// كل خدمة مختارة يجب أن يكون لها زيت
  bool get complete => picks.isNotEmpty && picks.values.every((p) => p.oil != null);

  List<({String label, double qty, double line})> get lines {
    final out = <({String label, double qty, double line})>[];
    for (final p in picks.values) {
      if (p.oil != null) out.add((label: '${p.kind.label}: ${p.oil!.title}', qty: p.qty, line: p.total));
    }
    final engine = picks[ServiceKind.engine];
    if (engine?.oil != null && autoService != null) out.add((label: autoService!.name, qty: 1, line: autoService!.price));
    if (withFilter && filter != null) out.add((label: filter!.title, qty: 1, line: filter!.price));
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
    }
    final engine = picks[ServiceKind.engine];
    if (engine?.oil != null && autoService != null) {
      items.add({'productId': autoService!.id, 'label': autoService!.name, 'qty': 1, 'priceInc': autoService!.price});
    }
    if (withFilter && filter != null) {
      items.add({'productId': filter!.id, 'label': filter!.title, 'qty': 1, 'priceInc': filter!.price});
    }
    return {'items': items, 'withFilter': picks.containsKey(ServiceKind.engine) ? withFilter : null, 'fromInvoice': null};
  }
}
