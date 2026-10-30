// lib/screens/pos/pos_screen.dart — إطار التطبيق بعد الدخول: قائمة جانبية كحلية (نفس قائمة الموقع) + هيدر + المحتوى
import 'package:flutter/material.dart';
import '../../core/theme.dart';
import '../../core/z8_widgets.dart';
import '../../state/app_state.dart';
import 'history_view.dart';
import 'pos_controller.dart';
import 'sale_view.dart';
import 'shift_widgets.dart';

enum PosPage { service, direct, history }

class PosScreen extends StatefulWidget {
  const PosScreen({super.key, required this.app});
  final AppState app;
  @override
  State<PosScreen> createState() => _PosScreenState();
}

class _PosScreenState extends State<PosScreen> {
  late final PosController pos = PosController(app: widget.app);
  PosPage page = PosPage.direct;

  @override
  void initState() {
    super.initState();
    page = pos.canDirect ? PosPage.direct : (pos.canService ? PosPage.service : PosPage.history);
    pos.load();
  }

  @override
  void dispose() { pos.dispose(); super.dispose(); }

  String get title => switch (page) { PosPage.service => 'نقطة بيع الخدمة', PosPage.direct => 'البيع المباشر', PosPage.history => 'سجل الفواتير' };

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: pos,
      builder: (context, _) => Scaffold(
        body: Row(children: [
          _Sidebar(page: page, pos: pos, onPage: (p) => setState(() => page = p)),
          Expanded(child: Column(children: [
            _Header(title: title, pos: pos, app: widget.app),
            Expanded(child: Container(color: Z8.ink, child: pos.loading
                ? const Center(child: CircularProgressIndicator(color: Z8.petrol))
                : pos.loadError != null && pos.products.isEmpty
                    ? Center(child: Column(mainAxisSize: MainAxisSize.min, children: [Text(pos.loadError!, style: tx(Fs.md, w: 700, color: Z8.ember)), const SizedBox(height: 12), Z8Button('إعادة المحاولة', onTap: pos.load)]))
                    : page == PosPage.history ? HistoryView(pos: pos) : SaleView(pos: pos, app: widget.app, service: page == PosPage.service))),
          ])),
        ]),
      ),
    );
  }
}

class _Sidebar extends StatelessWidget {
  const _Sidebar({required this.page, required this.pos, required this.onPage});
  final PosPage page;
  final PosController pos;
  final ValueChanged<PosPage> onPage;

  @override
  Widget build(BuildContext context) {
    Widget item(IconData icon, String label, PosPage p) {
      final active = page == p;
      return Material(
        color: active ? Z8.sbActive : Colors.transparent,
        child: InkWell(
          hoverColor: Z8.sbHover, onTap: () => onPage(p),
          child: Container(height: 46, padding: const EdgeInsets.symmetric(horizontal: 18), child: Row(children: [
            Icon(icon, size: 22, color: active ? Colors.white : const Color(0xFFD8E5FA)),
            const SizedBox(width: 12),
            Expanded(child: Text(label, style: tx(Fs.md, w: active ? 800 : 700, color: active ? Colors.white : Z8.sbText2))),
          ])),
        ),
      );
    }

    return Container(
      width: 232, color: Z8.sbBg,
      child: Column(children: [
        Container(
          padding: const EdgeInsets.fromLTRB(16, 18, 16, 16),
          decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: Color(0x1AFFFFFF)))),
          child: Row(children: [
            Container(width: 42, height: 42, padding: const EdgeInsets.all(6), color: const Color(0x1AFFFFFF), child: Image.asset('assets/images/logo-white.png')),
            const SizedBox(width: 12),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('مصدر الزيوت', style: tx(Fs.lg, w: 800, color: Colors.white)),
              Text('نقطة البيع', style: tx(Fs.xs, color: Z8.sbText2)),
            ])),
          ]),
        ),
        const SizedBox(height: 10),
        if (pos.canService) item(Icons.point_of_sale_rounded, 'نقطة بيع الخدمة', PosPage.service),
        if (pos.canDirect) item(Icons.shopping_cart_checkout_rounded, 'البيع المباشر', PosPage.direct),
        if (pos.canViewInvoices) item(Icons.receipt_long_rounded, 'سجل الفواتير', PosPage.history),
        const Spacer(),
        Container(
          decoration: const BoxDecoration(border: Border(top: BorderSide(color: Color(0x1AFFFFFF)))),
          padding: const EdgeInsets.all(14),
          child: Row(children: [
            Container(width: 34, height: 34, decoration: const BoxDecoration(color: Z8.sbActive, shape: BoxShape.circle), alignment: Alignment.center, child: Text(String.fromCharCode(pos.user.fullName.trim().runes.first), style: tx(Fs.md, w: 800, color: Colors.white))),
            const SizedBox(width: 10),
            Expanded(child: Text(pos.user.fullName, maxLines: 1, overflow: TextOverflow.ellipsis, style: tx(Fs.sm, w: 700, color: Colors.white))),
          ]),
        ),
      ]),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.title, required this.pos, required this.app});
  final String title;
  final PosController pos;
  final AppState app;

  @override
  Widget build(BuildContext context) {
    final now = DateTime.now();
    const days = ['الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت', 'الأحد'];
    const months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
    return Container(
      height: 60, padding: const EdgeInsets.symmetric(horizontal: 20),
      decoration: const BoxDecoration(color: Z8.ink2, border: Border(bottom: BorderSide(color: Z8.line))),
      child: Row(children: [
        Expanded(child: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(title, style: tx(Fs.xl, w: 800, h: 1.2)),
          Text('${days[now.weekday - 1]}، ${now.day} ${months[now.month - 1]}  ·  ${app.branch?.name ?? ''}', style: tx(Fs.xs, color: Z8.textDim)),
        ])),
        SessionPill(pos: pos, app: app),
        const SizedBox(width: 8),
        GearButton(pos: pos, app: app),
      ]),
    );
  }
}
