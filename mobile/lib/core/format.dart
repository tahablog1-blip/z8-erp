// lib/core/format.dart — تنسيق الأرقام والتواريخ (أرقام لاتينية بخانتين كما في الموقع)
import 'package:intl/intl.dart';

final _money = NumberFormat('#,##0.00', 'en');
final _int = NumberFormat('#,##0', 'en');

String money(num? v) => _money.format(v ?? 0);
String moneySar(num? v) => '${_money.format(v ?? 0)} ر.س';
String count(num? v) => _int.format(v ?? 0);

String timeHm(DateTime d) => DateFormat('HH:mm', 'en').format(d.toLocal());
String dateTimeShort(DateTime d) => DateFormat('yyyy/MM/dd HH:mm', 'en').format(d.toLocal());

double toNum(dynamic v) => v is num ? v.toDouble() : (double.tryParse('${v ?? ''}') ?? 0);
