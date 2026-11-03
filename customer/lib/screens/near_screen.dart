import 'package:flutter/material.dart';
import '../core/i18n.dart';
import '../core/location.dart';
import '../core/theme.dart';
import '../core/widgets.dart';
import '../state/app_state.dart';

/// بوابة القرب من الفرع: لا يُفتح الحجز إلا لو العميل أمام الفرع فعلاً (يرجع true عند النجاح)
class NearScreen extends StatefulWidget {
  const NearScreen({super.key, required this.state});
  final AppState state;
  @override
  State<NearScreen> createState() => _NearScreenState();
}

class _NearScreenState extends State<NearScreen> {
  bool checking = true;
  String? msg;

  AppState get s => widget.state;

  @override
  void initState() {
    super.initState();
    _check();
  }

  Future<void> _check() async {
    setState(() { checking = true; msg = null; });
    final m = await s.verifyNear();
    if (!mounted) return;
    if (m == null) return Navigator.of(context).pop(true);
    setState(() { checking = false; msg = m; });
  }

  @override
  Widget build(BuildContext context) {
    final why = s.geoWhy;
    final needsSettings = why == GeoStatus.serviceOff || why == GeoStatus.denied || why == GeoStatus.deniedForever;
    return Scaffold(
      appBar: AppBar(title: Text(tr('التحقق من موقعك'), style: tx(Fs.lg, w: 900)), backgroundColor: Z8.ink2, surfaceTintColor: Colors.transparent),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
            if (checking) ...[
              const CircularProgressIndicator(),
              const SizedBox(height: 20),
              Text(tr('جارٍ تحديد موقعك…'), style: tx(Fs.md, w: 800)),
            ] else ...[
              Icon(needsSettings ? Icons.location_off_outlined : Icons.near_me_disabled_outlined, size: 56, color: Z8.ember),
              const SizedBox(height: 16),
              Text(tr(msg ?? ''), textAlign: TextAlign.center, style: tx(Fs.md, w: 800)),
              if (s.geoDistanceM != null) ...[
                const SizedBox(height: 8),
                Text(tr('أنت على بعد {0} م من الفرع', [s.geoDistanceM]), style: tx(Fs.sm, w: 700, color: Z8.textDim)),
              ],
              const SizedBox(height: 8),
              Text(tr('الحجز متاح وأنت أمام الفرع فقط ({0} م)', [s.info?.geofenceRadiusM ?? 150]), textAlign: TextAlign.center, style: tx(Fs.sm, color: Z8.textDim)),
              const SizedBox(height: 24),
              if (needsSettings) ...[
                Z8Button(tr('فتح إعدادات الموقع'), icon: Icons.settings_outlined, onTap: () => s.location.openSettings(why!)),
                const SizedBox(height: 10),
              ],
              Z8Button(tr('إعادة المحاولة'), icon: Icons.refresh, outline: needsSettings, onTap: _check),
            ],
          ]),
        ),
      ),
    );
  }
}
