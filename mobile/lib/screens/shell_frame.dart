// lib/screens/shell_frame.dart — إطار شاشات الدخول: لوحة يمنى بهوية Z8 (كحلي كالقائمة الجانبية) + منطقة المحتوى
import 'package:flutter/material.dart';
import '../core/theme.dart';

class AuthFrame extends StatelessWidget {
  const AuthFrame({super.key, required this.child, this.title, this.subtitle, this.footer});
  final Widget child;
  final String? title, subtitle;
  final Widget? footer;

  @override
  Widget build(BuildContext context) {
    final panel = Container(
      color: Z8.sbBg,
      padding: const EdgeInsets.all(40),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisAlignment: MainAxisAlignment.center, children: [
        Container(
          width: 76, height: 76, padding: const EdgeInsets.all(10), color: const Color(0x1AFFFFFF),
          child: Image.asset('assets/images/logo-white.png', fit: BoxFit.contain),
        ),
        const SizedBox(height: 28),
        Text('مصدر الزيوت', style: tx(Fs.x3, w: 800, color: Colors.white)),
        const SizedBox(height: 6),
        Text('نقطة البيع — التابلت', style: tx(Fs.lg, w: 600, color: Z8.sbText2)),
        const SizedBox(height: 40),
        Container(height: 1, width: 120, color: const Color(0x1AFFFFFF)),
        const SizedBox(height: 20),
        Text('Z8 Platform', style: tx(Fs.sm, w: 600, color: Z8.sbText2.withValues(alpha: .7))),
      ]),
    );
    final body = Container(
      color: Z8.ink,
      child: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(28),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 560),
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              if (title != null) ...[
                Text(title!, textAlign: TextAlign.center, style: tx(Fs.x2, w: 800)),
                if (subtitle != null) Padding(padding: const EdgeInsets.only(top: 6), child: Text(subtitle!, textAlign: TextAlign.center, style: tx(Fs.md, color: Z8.textDim))),
                const SizedBox(height: 24),
              ],
              child,
              if (footer != null) Padding(padding: const EdgeInsets.only(top: 20), child: footer),
            ]),
          ),
        ),
      ),
    );
    return Scaffold(
      body: LayoutBuilder(builder: (context, c) {
        if (c.maxWidth < 760) return body;      // هاتف/تابلت عمودي ضيق: بلا اللوحة الجانبية
        return Row(children: [Expanded(flex: 4, child: panel), Expanded(flex: 7, child: body)]);   // RTL: اللوحة على اليمين
      }),
    );
  }
}
