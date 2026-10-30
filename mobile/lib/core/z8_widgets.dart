// lib/core/z8_widgets.dart — مكوّنات Z8 المشتركة بنفس لغة الموقع: حواف حادة، حدود line، ألوان petrol/emerald/ember
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'theme.dart';

enum BtnVariant { primary, ghost, danger, success, soft }

class Z8Button extends StatelessWidget {
  const Z8Button(this.label, {super.key, this.onTap, this.variant = BtnVariant.primary, this.icon, this.busy = false, this.height = 44, this.expand = false, this.size = Fs.md, this.hPad = 16});
  final String label;
  final VoidCallback? onTap;
  final BtnVariant variant;
  final IconData? icon;
  final bool busy;
  final double height, size, hPad;
  final bool expand;

  @override
  Widget build(BuildContext context) {
    final (bg, fg, border) = switch (variant) {
      BtnVariant.primary => (Z8.petrol, Colors.white, Z8.petrol),
      BtnVariant.success => (Z8.emerald, Colors.white, Z8.emerald),
      BtnVariant.danger => (Z8.emberBg, Z8.ember, Z8.ember.withValues(alpha: .35)),
      BtnVariant.soft => (Z8.petrolSoft, Z8.petrol, Z8.petrolSoft),
      BtnVariant.ghost => (Z8.ink2, Z8.text, Z8.line),
    };
    final enabled = onTap != null && !busy;
    final child = Row(mainAxisSize: expand ? MainAxisSize.max : MainAxisSize.min, mainAxisAlignment: MainAxisAlignment.center, children: [
      if (busy) SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: fg))
      else if (icon != null) Icon(icon, size: size + 3, color: fg),
      if ((busy || icon != null) && label.isNotEmpty) const SizedBox(width: 8),
      if (label.isNotEmpty) Flexible(child: Text(label, overflow: TextOverflow.ellipsis, style: tx(size, w: 700, color: fg))),
    ]);
    return Opacity(
      opacity: enabled || busy ? 1 : .5,
      child: Material(
        color: bg,
        shape: RoundedRectangleBorder(side: BorderSide(color: border), borderRadius: BorderRadius.zero),
        child: InkWell(
          onTap: enabled ? () { HapticFeedback.selectionClick(); onTap!(); } : null,
          child: Container(height: height, padding: EdgeInsets.symmetric(horizontal: hPad), alignment: Alignment.center, child: child),
        ),
      ),
    );
  }
}

class Z8Card extends StatelessWidget {
  const Z8Card({super.key, required this.child, this.padding = const EdgeInsets.all(16), this.color = Z8.ink2, this.border = Z8.line, this.shadow = true});
  final Widget child;
  final EdgeInsetsGeometry padding;
  final Color color, border;
  final bool shadow;
  @override
  Widget build(BuildContext context) => Container(
        padding: padding,
        decoration: BoxDecoration(color: color, border: Border.all(color: border), boxShadow: shadow ? Z8.shadowCard : null),
        child: child,
      );
}

class Z8Badge extends StatelessWidget {
  const Z8Badge(this.text, {super.key, this.fg = Z8.petrol, this.bg = Z8.petrolSoft});
  final String text;
  final Color fg, bg;
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
        color: bg,
        child: Text(text, style: tx(Fs.xs, w: 800, color: fg)),
      );
}

/// حقل نص بتسمية ظاهرة فوقه (نفس Field في الموقع)
class Z8Field extends StatelessWidget {
  const Z8Field({super.key, required this.label, required this.controller, this.keyboard, this.obscure = false, this.onSubmitted, this.autofocus = false, this.hint, this.maxLines = 1, this.onChanged, this.textAlign});
  final String label;
  final TextEditingController controller;
  final TextInputType? keyboard;
  final bool obscure, autofocus;
  final ValueChanged<String>? onSubmitted, onChanged;
  final String? hint;
  final int maxLines;
  final TextAlign? textAlign;
  @override
  Widget build(BuildContext context) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(label, style: tx(Fs.sm, w: 700)),
        const SizedBox(height: 6),
        TextField(
          controller: controller, keyboardType: keyboard, obscureText: obscure, autofocus: autofocus, maxLines: maxLines,
          onSubmitted: onSubmitted, onChanged: onChanged, textAlign: textAlign ?? TextAlign.start,
          style: tx(Fs.md, w: 600),
          decoration: InputDecoration(hintText: hint, hintStyle: tx(Fs.md, color: Z8.textDim), filled: true, fillColor: Z8.ink2),
        ),
      ]);
}

/// لوحة أرقام لمس كبيرة (رمز الجهاز / رمز الكاشير)
class Numpad extends StatelessWidget {
  const Numpad({super.key, required this.onDigit, required this.onBackspace, this.onClear, this.keySize = 76});
  final ValueChanged<String> onDigit;
  final VoidCallback onBackspace;
  final VoidCallback? onClear;
  final double keySize;

  Widget _key(Widget child, VoidCallback? onTap, {Color bg = Z8.ink2}) => Padding(
        padding: const EdgeInsets.all(5),
        child: Material(
          color: bg,
          shape: const RoundedRectangleBorder(side: BorderSide(color: Z8.line), borderRadius: BorderRadius.zero),
          child: InkWell(onTap: onTap == null ? null : () { HapticFeedback.selectionClick(); onTap(); }, child: SizedBox(width: keySize, height: keySize * .78, child: Center(child: child))),
        ),
      );

  @override
  Widget build(BuildContext context) {
    Widget digit(String d) => _key(Text(d, style: tx(Fs.x2, w: 700, tnum: true)), () => onDigit(d));
    return Column(mainAxisSize: MainAxisSize.min, children: [
      for (final row in const [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9']]) Row(mainAxisSize: MainAxisSize.min, children: [for (final d in row) digit(d)]),
      Row(mainAxisSize: MainAxisSize.min, children: [
        _key(Text('مسح', style: tx(Fs.md, w: 700, color: Z8.textDim)), onClear, bg: Z8.ink3),
        digit('0'),
        _key(const Icon(Icons.backspace_outlined, color: Z8.textDim), onBackspace, bg: Z8.ink3),
      ]),
    ]);
  }
}

void showToast(BuildContext context, String msg, {bool error = false}) {
  final m = ScaffoldMessenger.of(context);
  m.hideCurrentSnackBar();
  m.showSnackBar(SnackBar(
    behavior: SnackBarBehavior.floating,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.zero),
    backgroundColor: error ? Z8.ember : Z8.petrolDeep,
    content: Text(msg, style: tx(Fs.md, w: 700, color: Colors.white)),
    duration: const Duration(seconds: 3),
  ));
}

Future<bool> confirmDialog(BuildContext context, String title, String body, {String ok = 'تأكيد', bool danger = false}) async {
  final r = await showDialog<bool>(
    context: context,
    builder: (c) => AlertDialog(
      title: Text(title, style: tx(Fs.lg, w: 800)),
      content: Text(body, style: tx(Fs.md)),
      actions: [
        Z8Button('إلغاء', variant: BtnVariant.ghost, onTap: () => Navigator.pop(c, false)),
        Z8Button(ok, variant: danger ? BtnVariant.danger : BtnVariant.primary, onTap: () => Navigator.pop(c, true)),
      ],
    ),
  );
  return r ?? false;
}
