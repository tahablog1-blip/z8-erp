// لغات التطبيق: العربية (الأصل) + الإنجليزية + البنغالية + الهندية + الأردية (الباكستانية)
// النصوص العربية في الكود هي المفاتيح: tr(القالب_العربي, [متغيرات]) يرجع ترجمة اللغة الحالية.
import 'package:flutter/material.dart';
import 'translations.dart';

enum AppLang {
  ar('ar', 'العربية', true),
  en('en', 'English', false),
  bn('bn', 'বাংলা', false),
  hi('hi', 'हिन्दी', false),
  ur('ur', 'اردو', true);

  const AppLang(this.code, this.nativeName, this.rtl);
  final String code, nativeName;
  final bool rtl;
  Locale get locale => Locale(code);
  static AppLang? fromCode(String? c) {
    for (final l in AppLang.values) {
      if (l.code == c) return l;
    }
    return null;
  }
}

class L {
  static AppLang current = AppLang.ar;
}

/// ترجمة قالب عربي. المتغيرات {0} {1}… تُستبدل بعد الترجمة. غير الموجود في الجدول يبقى عربياً.
String tr(String ar, [List<Object?> args = const []]) {
  var s = L.current == AppLang.ar ? ar : (kTranslations[ar]?[L.current.code] ?? ar);
  for (var i = 0; i < args.length; i++) {
    s = s.replaceAll('{$i}', '${args[i]}');
  }
  return s;
}
