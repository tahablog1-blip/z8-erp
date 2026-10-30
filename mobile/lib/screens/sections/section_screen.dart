// lib/screens/sections/section_screen.dart — إطار أقسام الرموز الخاصة: قائمة جانبية بقسم واحد + هيدر + المحتوى
import 'package:flutter/material.dart';
import '../../core/theme.dart';
import '../../core/z8_widgets.dart';
import '../../state/app_state.dart';
import 'car_register_view.dart';
import 'notes_view.dart';
import 'workorder_view.dart';

class SectionScreen extends StatelessWidget {
  const SectionScreen({super.key, required this.app});
  final AppState app;

  (IconData, Widget) get _view => switch (app.sectionKind) {
        'service_notes' => (Icons.forum_rounded, NotesView(app: app)),
        'cars' => (Icons.directions_car_rounded, CarRegisterView(app: app)),
        _ => (Icons.assignment_rounded, WorkOrderView(app: app)),
      };

  @override
  Widget build(BuildContext context) {
    final (icon, body) = _view;
    return Scaffold(
      body: Row(children: [
        Container(
          width: 232, color: Z8.sbBg,
          child: Column(children: [
            Container(
              padding: const EdgeInsets.fromLTRB(16, 18, 16, 16), decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: Color(0x1AFFFFFF)))),
              child: Row(children: [
                Container(width: 42, height: 42, padding: const EdgeInsets.all(6), color: const Color(0x1AFFFFFF), child: Image.asset('assets/images/logo-white.png')),
                const SizedBox(width: 12),
                Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('مصدر الزيوت', style: tx(Fs.lg, w: 800, color: Colors.white)),
                  Text(app.branch?.name ?? '', style: tx(Fs.xs, color: Z8.sbText2)),
                ])),
              ]),
            ),
            const SizedBox(height: 10),
            Container(height: 46, color: Z8.sbActive, padding: const EdgeInsets.symmetric(horizontal: 18), child: Row(children: [
              Icon(icon, size: 22, color: Colors.white), const SizedBox(width: 12),
              Expanded(child: Text(app.sectionLabel ?? '', style: tx(Fs.md, w: 800, color: Colors.white))),
            ])),
            const Spacer(),
            Padding(padding: const EdgeInsets.all(14), child: Z8Button('خروج', icon: Icons.logout_rounded, variant: BtnVariant.ghost, expand: true, height: 42, size: Fs.sm, onTap: app.logout)),
          ]),
        ),
        Expanded(child: Column(children: [
          Container(
            height: 60, padding: const EdgeInsets.symmetric(horizontal: 20), alignment: AlignmentDirectional.centerStart,
            decoration: const BoxDecoration(color: Z8.ink2, border: Border(bottom: BorderSide(color: Z8.line))),
            child: Text(app.sectionLabel ?? '', style: tx(Fs.xl, w: 800)),
          ),
          Expanded(child: Container(color: Z8.ink, child: body)),
        ])),
      ]),
    );
  }
}
