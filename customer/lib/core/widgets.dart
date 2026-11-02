import 'package:flutter/material.dart';
import 'i18n.dart';
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
                    Flexible(child: FittedBox(fit: BoxFit.scaleDown, child: Text(label, maxLines: 1, style: tx(Fs.md, w: 800, color: fg)))),
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
        child: Material(type: MaterialType.transparency, child: child),   // ليظهر تأثير اللمس فوق خلفية الكرت
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
        child: Text(tr(text), style: tx(Fs.sm, w: 800, color: Z8.ember)),
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


/// ورقة اختيار من قائمة (مع بحث لو القائمة طويلة). ترجع القيمة المختارة أو null.
Future<String?> showPickSheet(BuildContext context, {required String title, required List<String> options, String? current, String? clearLabel}) {
  return showModalBottomSheet<String>(
    context: context, backgroundColor: Z8.ink2, isScrollControlled: true, shape: const RoundedRectangleBorder(),
    builder: (_) => _PickSheet(title: title, options: options, current: current, clearLabel: clearLabel),
  );
}

const _clearSentinel = '\u0000clear';

class _PickSheet extends StatefulWidget {
  const _PickSheet({required this.title, required this.options, this.current, this.clearLabel});
  final String title;
  final List<String> options;
  final String? current, clearLabel;
  @override
  State<_PickSheet> createState() => _PickSheetState();
}

class _PickSheetState extends State<_PickSheet> {
  String q = '';
  @override
  Widget build(BuildContext context) {
    final shown = widget.options.where((o) => q.isEmpty || o.toLowerCase().contains(q.toLowerCase())).toList();
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SizedBox(
        height: MediaQuery.sizeOf(context).height * .7,
        child: Column(children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 6),
            child: Row(children: [
              Expanded(child: Text(widget.title, style: tx(Fs.lg, w: 900))),
              IconButton(onPressed: () => Navigator.pop(context), icon: const Icon(Icons.close)),
            ]),
          ),
          if (widget.options.length > 12)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
              child: TextField(onChanged: (v) => setState(() => q = v.trim()), style: tx(Fs.md, w: 600), decoration: const InputDecoration(prefixIcon: Icon(Icons.search))),
            ),
          Expanded(
            child: ListView(children: [
              if (widget.clearLabel != null)
                ListTile(title: Text(widget.clearLabel!, style: tx(Fs.md, w: 700, color: Z8.textDim)), onTap: () => Navigator.pop(context, _clearSentinel)),
              for (final o in shown)
                ListTile(
                  title: Text(o, style: tx(Fs.md, w: o == widget.current ? 900 : 600, color: o == widget.current ? Z8.petrol : Z8.text)),
                  trailing: o == widget.current ? const Icon(Icons.check, color: Z8.petrol) : null,
                  onTap: () => Navigator.pop(context, o),
                ),
            ]),
          ),
        ]),
      ),
    );
  }
}

/// حقل بقائمة اختيار فقط (لا كتابة): السنة وحجم الماكينة. القيمة الفارغة = غير محدد.
class Z8Choice extends StatelessWidget {
  const Z8Choice({super.key, required this.label, required this.value, required this.options, required this.onChanged, this.hint = '', this.clearLabel});
  final String label, value, hint;
  final List<String> options;
  final ValueChanged<String> onChanged;
  final String? clearLabel;
  @override
  Widget build(BuildContext context) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(label, style: tx(Fs.xs, w: 800, color: Z8.petrolDeep)),
        const SizedBox(height: 4),
        InkWell(
          onTap: () async {
            final v = await showPickSheet(context, title: label, options: options, current: value.isEmpty ? null : value, clearLabel: clearLabel);
            if (v == null) return;
            onChanged(v == _clearSentinel ? '' : v);
          },
          child: InputDecorator(
            decoration: const InputDecoration(suffixIcon: Icon(Icons.arrow_drop_down)),
            child: Text(value.isEmpty ? hint : value, style: tx(Fs.md, w: 700, color: value.isEmpty ? Z8.textDim : Z8.text)),
          ),
        ),
      ]);
}

/// حقل نصي قابل للتعديل مع قائمة اقتراحات: يمكن اختيار قيمة من القائمة ثم تعديلها بالكتابة.
class Z8Combo extends StatelessWidget {
  const Z8Combo({super.key, required this.label, required this.controller, required this.options, this.onPicked, this.onChanged, this.hint, this.enabled = true});
  final String label;
  final TextEditingController controller;
  final List<String> options;
  final ValueChanged<String>? onPicked, onChanged;
  final String? hint;
  final bool enabled;
  @override
  Widget build(BuildContext context) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(label, style: tx(Fs.xs, w: 800, color: Z8.petrolDeep)),
        const SizedBox(height: 4),
        TextField(
          controller: controller, enabled: enabled, onChanged: onChanged, style: tx(Fs.md, w: 700),
          decoration: InputDecoration(
            hintText: hint, hintStyle: tx(Fs.md, color: Z8.textDim),
            suffixIcon: options.isEmpty
                ? null
                : IconButton(
                    icon: const Icon(Icons.arrow_drop_down),
                    onPressed: !enabled ? null : () async {
                      FocusScope.of(context).unfocus();
                      final v = await showPickSheet(context, title: label, options: options, current: controller.text);
                      if (v == null) return;
                      controller.text = v;
                      onPicked?.call(v);
                    },
                  ),
          ),
        ),
      ]);
}
