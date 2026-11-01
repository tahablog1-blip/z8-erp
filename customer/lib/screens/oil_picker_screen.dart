import 'package:flutter/material.dart';
import '../core/config.dart';
import '../core/theme.dart';
import '../models.dart';

/// اختيار الزيت على مرحلتين: شركات الزيوت (شعار + اسم) ثم زيوت الشركة (صورة + اسم + سعر).
/// يرجع OilProduct عند الاختيار.
class OilPickerScreen extends StatefulWidget {
  const OilPickerScreen({super.key, required this.kind, required this.oils, required this.brands, required this.filteredByType});
  final ServiceKind kind;
  final List<OilProduct> oils;
  final List<OilBrand> brands;
  final bool filteredByType;
  @override
  State<OilPickerScreen> createState() => _OilPickerScreenState();
}

const _noBrand = 'أخرى';

class _OilPickerScreenState extends State<OilPickerScreen> {
  String? brand;   // null = مرحلة الشركات
  String q = '';

  String _brandOf(OilProduct o) => o.brand.isEmpty ? _noBrand : o.brand;

  /// الشركات التي لها زيوت ضمن القائمة، بترتيب إعدادات الشركات في الموقع ثم الباقي
  List<({String name, String? logo, int count})> get _brands {
    final counts = <String, int>{};
    for (final o in widget.oils) {
      counts[_brandOf(o)] = (counts[_brandOf(o)] ?? 0) + 1;
    }
    final out = <({String name, String? logo, int count})>[];
    for (final b in widget.brands) {
      if (counts.containsKey(b.name)) out.add((name: b.name, logo: b.logo, count: counts.remove(b.name)!));
    }
    final rest = counts.keys.toList()..sort();
    for (final n in rest) {
      out.add((name: n, logo: null, count: counts[n]!));
    }
    return out;
  }

  @override
  Widget build(BuildContext context) {
    final inBrand = brand != null;
    return PopScope(
      canPop: !inBrand,
      onPopInvokedWithResult: (didPop, _) { if (!didPop) setState(() { brand = null; q = ''; }); },
      child: Scaffold(
        appBar: AppBar(
          title: Text(inBrand ? brand! : widget.kind.label, style: tx(Fs.lg, w: 900)),
          backgroundColor: Z8.ink2, surfaceTintColor: Colors.transparent,
        ),
        body: SafeArea(child: inBrand ? _oils() : _brandGrid()),
      ),
    );
  }

  Widget _brandGrid() {
    final list = _brands;
    return ListView(padding: const EdgeInsets.all(16), children: [
      Text('اختر شركة الزيت', style: tx(Fs.md, w: 900, color: Z8.petrolDeep)),
      if (!widget.filteredByType) Padding(padding: const EdgeInsets.only(top: 2), child: Text('كل الزيوت المتاحة', style: tx(Fs.xs, color: Z8.textDim))),
      const SizedBox(height: 12),
      if (list.isEmpty)
        Padding(padding: const EdgeInsets.all(32), child: Center(child: Text('لا توجد زيوت متاحة', style: tx(Fs.md, color: Z8.textDim))))
      else
        GridView.count(
          crossAxisCount: 3, shrinkWrap: true, physics: const NeverScrollableScrollPhysics(), mainAxisSpacing: 10, crossAxisSpacing: 10, childAspectRatio: .82,
          children: [for (final b in list) _BrandCard(b.name, b.logo, b.count, () => setState(() => brand = b.name))],
        ),
    ]);
  }

  Widget _oils() {
    final shown = widget.oils.where((o) => _brandOf(o) == brand && (q.isEmpty || o.title.contains(q))).toList();
    return Column(children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
        child: TextField(onChanged: (v) => setState(() => q = v.trim()), style: tx(Fs.md, w: 600), decoration: InputDecoration(hintText: 'ابحث في زيوت $brand', prefixIcon: const Icon(Icons.search), hintStyle: tx(Fs.md, color: Z8.textDim))),
      ),
      Expanded(
        child: shown.isEmpty
            ? Center(child: Text('لا توجد نتائج', style: tx(Fs.md, color: Z8.textDim)))
            : GridView.count(
                padding: const EdgeInsets.all(16), crossAxisCount: 2, mainAxisSpacing: 12, crossAxisSpacing: 12, childAspectRatio: .72,
                children: [for (final o in shown) _OilCard(o, () => Navigator.pop(context, o))],
              ),
      ),
    ]);
  }
}

class _Img extends StatelessWidget {
  const _Img(this.url, {required this.fallback});
  final String? url;
  final IconData fallback;
  @override
  Widget build(BuildContext context) {
    final u = absUrl(url);
    final ph = Container(color: Z8.ink3, alignment: Alignment.center, child: Icon(fallback, size: 36, color: Z8.textDim));
    if (u == null) return ph;
    return Image.network(u, fit: BoxFit.contain, errorBuilder: (_, _, _) => ph, loadingBuilder: (_, child, p) => p == null ? child : ph);
  }
}

class _BrandCard extends StatelessWidget {
  const _BrandCard(this.name, this.logo, this.count, this.onTap);
  final String name;
  final String? logo;
  final int count;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => Material(
        color: Z8.ink2,
        shape: const RoundedRectangleBorder(side: BorderSide(color: Z8.line)),
        child: InkWell(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(8),
            child: Column(children: [
              Expanded(child: _Img(logo, fallback: Icons.oil_barrel_outlined)),
              const SizedBox(height: 6),
              Text(name, maxLines: 1, overflow: TextOverflow.ellipsis, style: tx(Fs.sm, w: 900)),
              Text('$count منتج', style: tx(Fs.xs, color: Z8.textDim)),
            ]),
          ),
        ),
      );
}

class _OilCard extends StatelessWidget {
  const _OilCard(this.o, this.onTap);
  final OilProduct o;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => Material(
        color: Z8.ink2,
        shape: const RoundedRectangleBorder(side: BorderSide(color: Z8.line)),
        child: InkWell(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(10),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Expanded(child: _Img(o.image, fallback: Icons.oil_barrel_outlined)),
              const SizedBox(height: 8),
              Text(o.name, maxLines: 2, overflow: TextOverflow.ellipsis, style: tx(Fs.sm, w: 900)),
              if (o.spec.isNotEmpty) Text(o.spec, maxLines: 1, overflow: TextOverflow.ellipsis, style: tx(Fs.xs, color: Z8.textDim)),
              const SizedBox(height: 4),
              Text('${o.price.toStringAsFixed(2)} ر.س', style: tx(Fs.md, w: 900, color: Z8.petrolDeep, tnum: true)),
            ]),
          ),
        ),
      );
}
