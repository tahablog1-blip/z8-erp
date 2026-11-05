import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../core/geo.dart';
import '../core/brand.dart';
import '../core/i18n.dart';
import '../core/theme.dart';
import '../core/widgets.dart';
import '../models.dart';
import '../state/app_state.dart';

/// كل الفروع (خدمة وبيع تجزئة) مرتّبة بالأقرب إليك مع المسافة ووقت الوصول التقريبي.
/// تظهر القائمة فوراً ثم تُعاد ترتيبها حين يصل الموقع.
class BranchesScreen extends StatefulWidget {
  const BranchesScreen({super.key, required this.state, this.pickMode = false});
  final AppState state;
  final bool pickMode; // true = مفتوحة من الرئيسية (تعود بعد الاختيار)
  @override
  State<BranchesScreen> createState() => _BranchesScreenState();
}

class _BranchesScreenState extends State<BranchesScreen> {
  AppState get state => widget.state;
  bool get pickMode => widget.pickMode;

  @override
  void initState() {
    super.initState();
    // عند الفتح من «تغيير الفرع» لم تكن القائمة محمّلة (تُحمَّل فقط في أول تشغيل) — نحمّلها فوراً بلا سحب للتحديث
    if (pickMode || state.branches.isEmpty) Future.microtask(state.loadBranches);
  }

  Future<void> _select(BuildContext context, Branch b) async {
    final nav = Navigator.of(context);
    await state.selectBranch(b);
    if (pickMode && nav.mounted) nav.pop();
  }

  Future<void> _directions(Branch b) => launchUrl(
        Uri.parse('https://www.google.com/maps/dir/?api=1&destination=${b.latitude},${b.longitude}&travelmode=driving'),
        mode: LaunchMode.externalApplication);

  @override
  Widget build(BuildContext context) => ListenableBuilder(
        listenable: state,
        builder: (context, _) {
          final list = state.branches;
          final nearestId = list.where((b) => b.distanceKm != null).map((b) => b.id).firstOrNull;
          return Scaffold(
            appBar: AppBar(
              title: Text(pickMode ? tr('تغيير الفرع') : tr('اختر الفرع'), style: tx(Fs.lg, w: 900, color: Colors.white)),
              backgroundColor: Colors.transparent, foregroundColor: Colors.white, surfaceTintColor: Colors.transparent,
              flexibleSpace: const BrandBackdrop(),
            ),
            body: SafeArea(
              child: RefreshIndicator(
                onRefresh: state.loadBranches,
                child: ListView(padding: const EdgeInsets.all(16), children: [
                  if (state.locationDenied)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: Panel(color: Z8.brassSoft, child: Row(children: [
                        const Icon(Icons.location_off_outlined, color: Z8.petrolDeep),
                        const SizedBox(width: 12),
                        Expanded(child: Text(tr('فعّل الموقع ليظهر لك أقرب فرع ووقت الوصول إليه'), style: tx(Fs.sm, w: 700))),
                        TextButton(onPressed: state.loadBranches, child: Text(tr('إعادة المحاولة'), style: tx(Fs.sm, w: 800, color: Z8.petrol))),
                      ])),
                    )
                  else if (state.where == null && list.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: Row(children: [
                        const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2)),
                        const SizedBox(width: 10),
                        Text(tr('جارٍ تحديد موقعك…'), style: tx(Fs.sm, color: Z8.textDim)),
                      ]),
                    ),
                  if (state.branchesError != null) ...[
                    ErrorBar(state.branchesError!),
                    const SizedBox(height: 12),
                    Z8Button(tr('إعادة المحاولة'), outline: true, onTap: state.loadBranches),
                  ] else if (state.branchesLoading && list.isEmpty)
                    const Padding(padding: EdgeInsets.all(48), child: Center(child: CircularProgressIndicator()))
                  else if (list.isEmpty)
                    Padding(padding: const EdgeInsets.all(32), child: Text(tr('لا توجد فروع متاحة حالياً'), textAlign: TextAlign.center, style: tx(Fs.md, color: Z8.textDim))),
                  for (final b in list)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: _BranchCard(
                        b, nearest: b.id == nearestId, current: pickMode && b.id == state.branchId,
                        onSelect: b.isService ? () => _select(context, b) : null,
                        onDirections: b.hasLocation ? () => _directions(b) : null,
                      ),
                    ),
                ]),
              ),
            ),
          );
        },
      );
}

class _BranchCard extends StatelessWidget {
  const _BranchCard(this.b, {required this.nearest, required this.current, this.onSelect, this.onDirections});
  final Branch b;
  final bool nearest, current;
  final VoidCallback? onSelect, onDirections;

  @override
  Widget build(BuildContext context) => Panel(
        color: nearest ? Z8.petrolSoft : null,
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(children: [
            Expanded(child: Text(b.name, style: tx(Fs.lg, w: 900, color: Z8.petrolDeep))),
            _Chip(b.isService ? tr('خدمة') : tr('بيع تجزئة'), b.isService ? Z8.petrol : Z8.brass, b.isService ? Colors.white : Z8.text),
          ]),
          if (nearest) ...[
            const SizedBox(height: 6),
            Row(children: [const Icon(Icons.near_me, size: 16, color: Z8.petrol), const SizedBox(width: 4), Text(tr('الأقرب إليك'), style: tx(Fs.sm, w: 900, color: Z8.petrol))]),
          ],
          if (b.address != null) ...[
            const SizedBox(height: 6),
            Text(b.address!, style: tx(Fs.sm, color: Z8.textDim)),
          ],
          const SizedBox(height: 10),
          if (b.distanceKm != null)
            Row(children: [
              const Icon(Icons.directions_car_outlined, size: 18, color: Z8.textDim),
              const SizedBox(width: 6),
              Expanded(child: Text(tr('{0} · يصلك خلال ≈ {1}', [formatKm(b.distanceKm!), formatMinutes(b.etaMinutes!)]), style: tx(Fs.sm, w: 800))),
            ])
          else if (!b.hasLocation)
            Text(tr('موقع الفرع غير محدد بعد'), style: tx(Fs.xs, color: Z8.textDim)),
          if (b.isService && b.waiting != null) ...[
            const SizedBox(height: 6),
            Row(children: [
              const Icon(Icons.hourglass_empty, size: 18, color: Z8.textDim),
              const SizedBox(width: 6),
              Expanded(child: Text(b.waiting == 0 ? tr('لا يوجد انتظار الآن') : tr('بانتظار الخدمة: {0} · انتظار تقريبي {1}', [b.waiting, formatMinutes(b.estWaitMinutes ?? 0)]), style: tx(Fs.sm, w: 700))),
            ]),
          ] else if (!b.isService) ...[
            const SizedBox(height: 6),
            Text(tr('بيع بالقطعة — لا يوجد حجز دور في هذا الفرع'), style: tx(Fs.sm, color: Z8.textDim)),
          ],
          const SizedBox(height: 12),
          Row(children: [
            if (onSelect != null)
              Expanded(child: Z8Button(current ? tr('الفرع الحالي') : tr('احجز من هذا الفرع'), onTap: current ? null : onSelect)),
            if (onSelect != null && onDirections != null) const SizedBox(width: 8),
            if (onDirections != null) Expanded(child: Z8Button(tr('الاتجاهات'), icon: Icons.directions, outline: true, onTap: onDirections)),
          ]),
        ]),
      );
}

class _Chip extends StatelessWidget {
  const _Chip(this.text, this.bg, this.fg);
  final String text;
  final Color bg, fg;
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
        color: bg,
        child: Text(text, style: tx(Fs.xs, w: 900, color: fg)),
      );
}
