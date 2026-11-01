// عنوان الخادم والفرع الافتراضي — يمرَّران عند البناء بـ --dart-define (API_BASE و BRANCH_ID)
class Config {
  static const String apiBase = String.fromEnvironment('API_BASE', defaultValue: 'https://z8masdr.duckdns.org');
  static const String defaultBranchId = String.fromEnvironment('BRANCH_ID', defaultValue: '');
  static const String appName = 'مصدر الزيوت';
}

final _uuid = RegExp(r'[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}');

/// يستخرج معرّف الفرع من رابط الحجز (.../booking/ID) أو من المعرّف نفسه
String? parseBranchId(String input) => _uuid.firstMatch(input.trim())?.group(0)?.toLowerCase();
