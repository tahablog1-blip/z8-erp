// lib/core/theme.dart — رموز هوية Z8 كما في الموقع (globals.css / tailwind.config.ts) بحواف حادة وخط Cairo
import 'package:flutter/material.dart';

class Z8 {
  // ── ألوان النهار ──
  static const ink = Color(0xFFF8FAFC), ink2 = Color(0xFFFFFFFF), ink3 = Color(0xFFF1F5F9), ink4 = Color(0xFFE2E8F0);
  static const petrol = Color(0xFF1E3A8A), petrolDeep = Color(0xFF163A70), petrolSoft = Color(0xFFDBEAFE);
  static const brass = Color(0xFFF59E0B), brassSoft = Color(0xFFFEF3C7);
  static const emerald = Color(0xFF22C55E), emeraldBg = Color(0x1A22C55E);
  static const ember = Color(0xFFEF4444), emberBg = Color(0x17EF4444);
  static const line = Color(0xFFE5E7EB), text = Color(0xFF0F172A), textDim = Color(0xFF64748B);
  static const navActive = Color(0xFF3B82F6);
  // ── لوحة القائمة الجانبية (نفس مفاتيح --sb-*) ──
  static const sbBg = Color(0xFF0B2F67), sbGroup = Color(0xFF123A76), sbHover = Color(0xFF1B477F), sbActive = Color(0xFF3478F6);
  static const sbText2 = Color(0xFFC8D7F0);

  static const shadowCard = [BoxShadow(color: Color(0x0A0F172A), blurRadius: 8, offset: Offset(0, 2)), BoxShadow(color: Color(0x0A0F172A), blurRadius: 2, offset: Offset(0, 1))];
  static const shadowPanel = [BoxShadow(color: Color(0x240F172A), blurRadius: 45, offset: Offset(0, 20))];

  static const double rCard = 0, rCtl = 0;      // حواف حادة في كل النظام
}

/// نمط نص بخط Cairo — الأوزان بالمحور المتغيّر (wght)
TextStyle tx(double size, {int w = 500, Color color = Z8.text, double? h, bool tnum = false}) => TextStyle(
      fontFamily: 'Cairo',
      fontSize: size,
      color: color,
      height: h,
      fontVariations: [FontVariation('wght', w.toDouble())],
      fontFeatures: tnum ? const [FontFeature.tabularFigures()] : null,
    );

// سلم الخطوط (الموقع: caption 11.5 · small 12.5 · body 13.5 · card-title 15 · section 18 · page-title 22) — مكبَّر قليلاً للتابلت
class Fs {
  static const double xs = 12, sm = 13.5, md = 15, lg = 17, xl = 20, x2 = 24, x3 = 30;
}

ThemeData z8Theme() {
  const cs = ColorScheme.light(
    primary: Z8.petrol, onPrimary: Colors.white, secondary: Z8.navActive, surface: Z8.ink2,
    onSurface: Z8.text, error: Z8.ember, outline: Z8.line,
  );
  return ThemeData(
    useMaterial3: true,
    colorScheme: cs,
    scaffoldBackgroundColor: Z8.ink,
    fontFamily: 'Cairo',
    splashFactory: InkRipple.splashFactory,
    dividerColor: Z8.line,
    textSelectionTheme: const TextSelectionThemeData(cursorColor: Z8.petrol),
    inputDecorationTheme: const InputDecorationTheme(
      isDense: true,
      border: OutlineInputBorder(borderRadius: BorderRadius.zero, borderSide: BorderSide(color: Z8.line)),
      enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.zero, borderSide: BorderSide(color: Z8.line)),
      focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.zero, borderSide: BorderSide(color: Z8.petrol, width: 1.5)),
      contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 12),
    ),
    dialogTheme: const DialogThemeData(shape: RoundedRectangleBorder(borderRadius: BorderRadius.zero), backgroundColor: Z8.ink2),
    cardTheme: const CardThemeData(shape: RoundedRectangleBorder(borderRadius: BorderRadius.zero), color: Z8.ink2, elevation: 0),
  );
}
