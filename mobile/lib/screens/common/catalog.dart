// lib/screens/common/catalog.dart — كتالوج الأصناف المشترك (بيع مباشر + إعداد أمر العمل): بحث/باركود + فئات + شبكة بطاقات
import 'package:flutter/material.dart';
import '../../core/config.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../models/models.dart';

class ProductTile extends StatelessWidget {
  const ProductTile({super.key, required this.product, required this.out, required this.onTap});
  final Product product;
  final bool out;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) {
    final p = product;
    return Material(
      color: Z8.ink2,
      shape: const RoundedRectangleBorder(side: BorderSide(color: Z8.line), borderRadius: BorderRadius.zero),
      child: InkWell(
        onTap: out ? null : onTap,
        child: Padding(padding: const EdgeInsets.all(10), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Container(
            height: 84, color: Z8.ink3,
            child: Stack(children: [
              Center(child: p.hasImage
                  ? Image.network('${Config.apiBase}/api/products/public/product-image/${p.id}', fit: BoxFit.contain, errorBuilder: (_, _, _) => const Icon(Icons.category_rounded, size: 34, color: Z8.textDim))
                  : Icon(p.isService ? Icons.build_rounded : Icons.category_rounded, size: 34, color: Z8.textDim)),
              if (out) PositionedDirectional(top: 6, start: 6, child: Container(padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2), color: Z8.emberBg, child: Text('نفد', style: tx(Fs.xs, w: 800, color: Z8.ember)))),
            ]),
          ),
          const SizedBox(height: 8),
          Expanded(child: Text(p.name, maxLines: 2, overflow: TextOverflow.ellipsis, textAlign: TextAlign.center, style: tx(Fs.sm, w: 800, h: 1.25))),
          Text(p.sku ?? p.barcode ?? '', maxLines: 1, overflow: TextOverflow.ellipsis, textAlign: TextAlign.center, style: tx(Fs.xs, color: Z8.textDim, tnum: true)),
          const SizedBox(height: 6),
          Row(children: [
            Container(width: 38, height: 38, decoration: BoxDecoration(shape: BoxShape.circle, color: out ? Z8.ink4 : Z8.emerald), child: const Icon(Icons.add_rounded, color: Colors.white, size: 24)),
            const SizedBox(width: 8),
            Expanded(child: Text(money(p.priceVat), style: tx(Fs.lg, w: 800, tnum: true))),
            Text('ر.س', style: tx(Fs.xs, w: 700, color: Z8.textDim)),
          ]),
        ])),
      ),
    );
  }
}

class CatalogPane extends StatefulWidget {
  const CatalogPane({super.key, required this.products, required this.onAdd, this.isOut, this.onScan, this.hint = 'امسح الباركود أو ابحث بالاسم'});
  final List<Product> products;
  final void Function(Product) onAdd;
  final bool Function(Product)? isOut;
  final bool Function(String code)? onScan;   // يُرجع true إن وجد الصنف وأضافه
  final String hint;
  @override
  State<CatalogPane> createState() => _CatalogPaneState();
}

class _CatalogPaneState extends State<CatalogPane> {
  final search = TextEditingController();
  String category = 'الكل';

  List<String> get categories => ['الكل', ...{for (final p in widget.products) if (p.category.trim().isNotEmpty) p.category.trim()}];

  List<Product> get filtered {
    final q = search.text.trim().toLowerCase();
    return widget.products.where((p) {
      if (category != 'الكل' && p.category.trim() != category) return false;
      if (q.isEmpty) return true;
      return p.name.toLowerCase().contains(q) || (p.barcode ?? '').toLowerCase().contains(q) || (p.sku ?? '').toLowerCase().contains(q);
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    final items = filtered;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      TextField(
        controller: search, onChanged: (_) => setState(() {}),
        onSubmitted: (v) { if (widget.onScan != null && widget.onScan!(v)) { search.clear(); setState(() {}); } },
        style: tx(Fs.md, w: 600),
        decoration: InputDecoration(prefixIcon: const Icon(Icons.qr_code_scanner_rounded, color: Z8.textDim), hintText: widget.hint, hintStyle: tx(Fs.md, color: Z8.textDim), filled: true, fillColor: Z8.ink2),
      ),
      const SizedBox(height: 12),
      SizedBox(height: 50, child: ListView(scrollDirection: Axis.horizontal, children: [
        for (final c in categories) Padding(
          padding: const EdgeInsetsDirectional.only(end: 8),
          child: Material(
            color: category == c ? Z8.petrolDeep : Z8.ink2,
            shape: RoundedRectangleBorder(side: BorderSide(color: category == c ? Z8.petrolDeep : Z8.line), borderRadius: BorderRadius.zero),
            child: InkWell(onTap: () => setState(() => category = c), child: Container(padding: const EdgeInsets.symmetric(horizontal: 20), alignment: Alignment.center, child: Text(c, style: tx(Fs.md, w: 800, color: category == c ? Colors.white : Z8.text)))),
          ),
        ),
      ])),
      const SizedBox(height: 12),
      Expanded(child: items.isEmpty
          ? Center(child: Text('لا توجد أصناف مطابقة', style: tx(Fs.md, color: Z8.textDim)))
          : GridView.builder(
              gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(maxCrossAxisExtent: 215, mainAxisExtent: 232, crossAxisSpacing: 12, mainAxisSpacing: 12),
              itemCount: items.length,
              itemBuilder: (c, i) => ProductTile(product: items[i], out: widget.isOut?.call(items[i]) ?? false, onTap: () => widget.onAdd(items[i])),
            )),
    ]);
  }
}
