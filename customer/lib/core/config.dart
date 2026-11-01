// عنوان الخادم والفرع الافتراضي — يمرَّران عند البناء بـ --dart-define (API_BASE و BRANCH_ID)
class Config {
  static const String apiBase = String.fromEnvironment('API_BASE', defaultValue: 'https://z8masdr.duckdns.org');
  static const String defaultBranchId = String.fromEnvironment('BRANCH_ID', defaultValue: '');
  /// اختياري: يلزم فقط لو النظام يخدم أكثر من شركة
  static const String companyId = String.fromEnvironment('COMPANY_ID', defaultValue: '');
  static const String appName = 'مصدر الزيوت';
}

/// رابط صورة قادم من الخادم (قد يكون نسبياً مثل /api/products/public/product-image/ID)
String? absUrl(String? p) {
  if (p == null || p.isEmpty) return null;
  return p.startsWith('http') ? p : '${Config.apiBase}$p';
}
