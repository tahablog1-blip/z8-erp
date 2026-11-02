// لوجوهات الشركات المصنّعة (assets/car_brands) — تُولَّد من frontend/src/lib/carBrands.ts. الأسماء بعد التطبيع.
// اللوجوهات من حزمة car-brand-logos (MIT)، والعلامات التجارية ملك أصحابها وتُستخدم للتعريف بالماركة فقط.
import 'package:flutter/material.dart';
import 'theme.dart';

const _index = <String, String>{
  'acura': 'acura',
  'alfaromeo': 'alfa-romeo',
  'astonmartin': 'aston-martin',
  'audi': 'audi',
  'bentley': 'bentley',
  'bmw': 'bmw',
  'buick': 'buick',
  'byd': 'byd',
  'cadillac': 'cadillac',
  'changan': 'changan',
  'chery': 'chery',
  'chevrolet': 'chevrolet',
  'chevy': 'chevrolet',
  'chrysler': 'chrysler',
  'citroen': 'citroen',
  'dacia': 'dacia',
  'daihatsu': 'daihatsu',
  'dodge': 'dodge',
  'dongfeng': 'dongfeng',
  'ferrari': 'ferrari',
  'fiat': 'fiat',
  'ford': 'ford',
  'geely': 'geely',
  'genesis': 'genesis',
  'gm': 'chevrolet',
  'gmc': 'gmc',
  'greatwall': 'great-wall',
  'haval': 'haval',
  'honda': 'honda',
  'hyundai': 'hyundai',
  'infiniti': 'infiniti',
  'isuzu': 'isuzu',
  'jaguar': 'jaguar',
  'jeep': 'jeep',
  'jetour': 'jetour',
  'kia': 'kia',
  'lamborghini': 'lamborghini',
  'landrover': 'land-rover',
  'lexus': 'lexus',
  'lincoln': 'lincoln',
  'lotus': 'lotus',
  'mahindra': 'mahindra',
  'maserati': 'maserati',
  'maxus': 'maxus',
  'mazda': 'mazda',
  'mclaren': 'mclaren',
  'mercedes': 'mercedes-benz',
  'mercedesbenz': 'mercedes-benz',
  'mg': 'mg',
  'mini': 'mini',
  'mitsubishi': 'mitsubishi',
  'nissan': 'nissan',
  'opel': 'opel',
  'peugeot': 'peugeot',
  'porsche': 'porsche',
  'proton': 'proton',
  'ram': 'ram',
  'rangerover': 'land-rover',
  'renault': 'renault',
  'rollsroyce': 'rolls-royce',
  'seat': 'seat',
  'skoda': 'skoda',
  'smart': 'smart',
  'subaru': 'subaru',
  'suzuki': 'suzuki',
  'tata': 'tata',
  'tesla': 'tesla',
  'toyota': 'toyota',
  'volkswagen': 'volkswagen',
  'volvo': 'volvo',
  'vw': 'volkswagen',
  'استونمارتن': 'aston-martin',
  'اكيورا': 'acura',
  'الفاروميو': 'alfa-romeo',
  'امجي': 'mg',
  'انفينيتي': 'infiniti',
  'اوبل': 'opel',
  'اودي': 'audi',
  'ايسوزو': 'isuzu',
  'بروتون': 'proton',
  'بنتلي': 'bentley',
  'بورش': 'porsche',
  'بيامدبليو': 'bmw',
  'بيجو': 'peugeot',
  'بيوايدي': 'byd',
  'بيوك': 'buick',
  'تاتا': 'tata',
  'تسلا': 'tesla',
  'تويوتا': 'toyota',
  'جاكوار': 'jaguar',
  'جريتوال': 'great-wall',
  'جريتوول': 'great-wall',
  'جمس': 'gmc',
  'جيامسي': 'gmc',
  'جيب': 'jeep',
  'جيتور': 'jetour',
  'جيلي': 'geely',
  'جينيسيس': 'genesis',
  'داسيا': 'dacia',
  'دايهاتسو': 'daihatsu',
  'دودج': 'dodge',
  'دونغفنغ': 'dongfeng',
  'رام': 'ram',
  'رولزرويس': 'rolls-royce',
  'رينو': 'renault',
  'سكودا': 'skoda',
  'سمارت': 'smart',
  'سوبارو': 'subaru',
  'سوزوكي': 'suzuki',
  'سيات': 'seat',
  'سيتروين': 'citroen',
  'شانجان': 'changan',
  'شانغان': 'changan',
  'شفروليه': 'chevrolet',
  'شيري': 'chery',
  'شيفروليه': 'chevrolet',
  'فورد': 'ford',
  'فولفو': 'volvo',
  'فولكسفاجن': 'volkswagen',
  'فولكسفاغن': 'volkswagen',
  'فولكسواجن': 'volkswagen',
  'فيات': 'fiat',
  'فيراري': 'ferrari',
  'كاديلاك': 'cadillac',
  'كرايسلر': 'chrysler',
  'كيا': 'kia',
  'لامبورجيني': 'lamborghini',
  'لاندروفر': 'land-rover',
  'لكزس': 'lexus',
  'لوتس': 'lotus',
  'لينكولن': 'lincoln',
  'مازدا': 'mazda',
  'مازيراتي': 'maserati',
  'ماكسوس': 'maxus',
  'ماكلارين': 'mclaren',
  'ماهيندرا': 'mahindra',
  'مرسيدس': 'mercedes-benz',
  'مرسيدسبنز': 'mercedes-benz',
  'ميتسوبيشي': 'mitsubishi',
  'ميني': 'mini',
  'نيسان': 'nissan',
  'هافال': 'haval',
  'هوندا': 'honda',
  'هيونداي': 'hyundai',
  'هيوندي': 'hyundai',
};

String _norm(String s) => s
    .toLowerCase()
    .replaceAll(RegExp('[أإآ]'), 'ا')
    .replaceAll('ى', 'ي')
    .replaceAll('ة', 'ه')
    .replaceAll(RegExp(r'[^a-z0-9\u0600-\u06FF]+'), '');

/// مسار لوجو الماركة، أو null لو غير معروفة
String? carBrandAsset(String? brand) {
  if (brand == null || brand.trim().isEmpty) return null;
  final slug = _index[_norm(brand)];
  return slug == null ? null : 'assets/car_brands/$slug.png';
}

/// لوجو ماركة السيارة داخل مربع ثابت؛ لو غير معروفة تظهر أيقونة سيارة
class CarBrandLogo extends StatelessWidget {
  const CarBrandLogo(this.brand, {super.key, this.size = 40});
  final String? brand;
  final double size;
  @override
  Widget build(BuildContext context) {
    final a = carBrandAsset(brand);
    return SizedBox(
      width: size, height: size,
      child: a == null
          ? Icon(Icons.directions_car_outlined, color: Z8.petrol, size: size * .8)
          : Image.asset(a, fit: BoxFit.contain, errorBuilder: (_, _, _) => Icon(Icons.directions_car_outlined, color: Z8.petrol, size: size * .8)),
    );
  }
}
