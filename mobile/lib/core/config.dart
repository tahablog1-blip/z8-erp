// lib/core/config.dart — عنوان الخادم: يُمرَّر عند البناء  --dart-define=API_BASE=https://...
class Config {
  static const String apiBase = String.fromEnvironment('API_BASE', defaultValue: 'https://z8masdr.duckdns.org');
  static const String appName = 'Z8 POS';
}
