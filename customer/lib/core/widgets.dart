import 'package:flutter/material.dart';
import 'theme.dart';

class Z8Button extends StatelessWidget {
  const Z8Button(this.label, {super.key, required this.onTap, this.busy = false, this.outline = false, this.icon});
  final String label;
  final VoidCallback? onTap;
  final bool busy, outline;
  final IconData? icon;
  @override
  Widget build(BuildContext context) {
    final fg = outline ? Z8.petrol : Colors.white;
    return SizedBox(
      height: 48,
      width: double.infinity,
      child: Material(
        color: outline ? Colors.transparent : (onTap == null ? Z8.textDim : Z8.petrol),
        shape: RoundedRectangleBorder(side: outline ? const BorderSide(color: Z8.petrol) : BorderSide.none),
        child: InkWell(
          onTap: busy ? null : onTap,
          child: Center(
            child: busy
                ? SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: fg))
                : Row(mainAxisSize: MainAxisSize.min, children: [
                    if (icon != null) ...[Icon(icon, size: 20, color: fg), const SizedBox(width: 8)],
                    Text(label, style: tx(Fs.md, w: 800, color: fg)),
                  ]),
          ),
        ),
      ),
    );
  }
}

class Z8Field extends StatelessWidget {
  const Z8Field({super.key, required this.label, required this.controller, this.keyboard, this.hint, this.maxLength, this.onChanged, this.textAlign, this.ltr = false});
  final String label;
  final TextEditingController controller;
  final TextInputType? keyboard;
  final String? hint;
  final int? maxLength;
  final ValueChanged<String>? onChanged;
  final TextAlign? textAlign;
  final bool ltr;
  @override
  Widget build(BuildContext context) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(label, style: tx(Fs.xs, w: 800, color: Z8.petrolDeep)),
        const SizedBox(height: 4),
        TextField(
          controller: controller, keyboardType: keyboard, maxLength: maxLength, onChanged: onChanged,
          textDirection: ltr ? TextDirection.ltr : null, textAlign: textAlign ?? (ltr ? TextAlign.left : TextAlign.start),
          style: tx(Fs.md, w: 700),
          decoration: InputDecoration(hintText: hint, counterText: '', hintStyle: tx(Fs.md, color: Z8.textDim)),
        ),
      ]);
}

class Panel extends StatelessWidget {
  const Panel({super.key, required this.child, this.pad = 16, this.color});
  final Widget child;
  final double pad;
  final Color? color;
  @override
  Widget build(BuildContext context) => Container(
        width: double.infinity,
        padding: EdgeInsets.all(pad),
        decoration: BoxDecoration(color: color ?? Z8.ink2, border: Border.all(color: Z8.line), boxShadow: Z8.shadowCard),
        child: child,
      );
}

class ErrorBar extends StatelessWidget {
  const ErrorBar(this.text, {super.key});
  final String text;
  @override
  Widget build(BuildContext context) => Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        color: Z8.emberBg,
        child: Text(text, style: tx(Fs.sm, w: 800, color: Z8.ember)),
      );
}

String arabicDigitsToLatin(String s) {
  const ar = '٠١٢٣٤٥٦٧٨٩';
  final b = StringBuffer();
  for (final c in s.runes) {
    final ch = String.fromCharCode(c);
    final i = ar.indexOf(ch);
    b.write(i >= 0 ? '$i' : ch);
  }
  return b.toString();
}
