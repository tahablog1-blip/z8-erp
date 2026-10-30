// lib/screens/sections/notes_view.dart — ملاحظات الخدمة: المحادثات مع العملاء + قائمة الملاحظات وتغيير حالتها + ملاحظة جديدة
import 'package:flutter/material.dart';
import '../../core/api.dart';
import '../../core/theme.dart';
import '../../core/z8_widgets.dart';
import '../../state/app_state.dart';

const noteTypes = {
  'out_of_stock': 'منتج غير متوفر', 'low_stock': 'كمية المنتج غير كافية', 'needs_replacement': 'منتج يحتاج إلى تغيير', 'part_replacement': 'قطعة تحتاج إلى تغيير',
  'technical': 'مشكلة فنية', 'car_note': 'ملاحظة على السيارة', 'extra_service': 'خدمة إضافية مقترحة', 'customer_declined': 'العميل رفض خدمة', 'operational': 'مشكلة تشغيلية', 'other': 'أخرى',
};
const noteStatuses = {
  'new': 'جديدة', 'in_progress': 'قيد المتابعة', 'awaiting_customer': 'بانتظار رد العميل', 'awaiting_management': 'بانتظار الإدارة', 'handled': 'تم التعامل معها', 'closed': 'مغلقة', 'rejected': 'مرفوضة',
};
const priorities = {'low': 'منخفضة', 'normal': 'عادية', 'high': 'عالية', 'urgent': 'عاجلة'};

class NotesView extends StatefulWidget {
  const NotesView({super.key, required this.app});
  final AppState app;
  @override
  State<NotesView> createState() => _NotesViewState();
}

class _NotesViewState extends State<NotesView> {
  int tab = 0;
  bool loading = true;
  String? error;
  List<Map> conversations = [], notes = [];
  String status = '';
  final q = TextEditingController();

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    setState(() { loading = true; error = null; });
    try {
      final api = widget.app.api;
      final r = await Future.wait([
        api.get('/service-notes/conversations').catchError((_) => <dynamic>[]),
        api.get('/service-notes', query: {if (status.isNotEmpty) 'status': status, if (q.text.trim().isNotEmpty) 'q': q.text.trim()}),
      ]);
      conversations = [for (final c in (r[0] as List)) c as Map];
      notes = [for (final n in (r[1] as List)) n as Map];
    } on ApiException catch (e) { error = e.message; }
    if (mounted) setState(() => loading = false);
  }

  @override
  Widget build(BuildContext context) {
    final canCreate = widget.app.user?.has('service_notes.create') ?? false;
    return Padding(padding: const EdgeInsets.all(16), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Row(children: [
        _TabBtn('المحادثات (${conversations.where((c) => (c['unread'] ?? 0) != 0).length})', tab == 0, () => setState(() => tab = 0)),
        const SizedBox(width: 8),
        _TabBtn('الملاحظات (${notes.length})', tab == 1, () => setState(() => tab = 1)),
        const Spacer(),
        if (canCreate) Z8Button('ملاحظة جديدة', icon: Icons.add_rounded, onTap: () async { if (await showDialog<bool>(context: context, builder: (c) => _NewNoteDialog(app: widget.app)) == true) _load(); }),
        const SizedBox(width: 8),
        Z8Button('', icon: Icons.refresh_rounded, variant: BtnVariant.ghost, onTap: _load),
      ]),
      const SizedBox(height: 12),
      if (tab == 1) Row(children: [
        Expanded(child: TextField(controller: q, onSubmitted: (_) => _load(), style: tx(Fs.md, w: 600), decoration: InputDecoration(prefixIcon: const Icon(Icons.search_rounded), hintText: 'بحث: عميل / جوال / لوحة / منتج', hintStyle: tx(Fs.md, color: Z8.textDim), filled: true, fillColor: Z8.ink2))),
        const SizedBox(width: 10),
        SizedBox(width: 220, child: DropdownButtonFormField<String>(
          initialValue: status, decoration: const InputDecoration(filled: true, fillColor: Z8.ink2),
          items: [DropdownMenuItem(value: '', child: Text('كل الحالات', style: tx(Fs.md))), for (final e in noteStatuses.entries) DropdownMenuItem(value: e.key, child: Text(e.value, style: tx(Fs.md)))],
          onChanged: (v) { status = v ?? ''; _load(); },
        )),
      ]),
      if (tab == 1) const SizedBox(height: 12),
      Expanded(child: loading
          ? const Center(child: CircularProgressIndicator(color: Z8.petrol))
          : error != null ? Center(child: Text(error!, style: tx(Fs.md, w: 700, color: Z8.ember)))
          : tab == 0 ? _conversations() : _notes()),
    ]));
  }

  Widget _conversations() => conversations.isEmpty
      ? Center(child: Text('لا توجد محادثات', style: tx(Fs.md, color: Z8.textDim)))
      : Z8Card(padding: EdgeInsets.zero, child: ListView.separated(
          itemCount: conversations.length, separatorBuilder: (_, _) => const Divider(height: 1, color: Z8.line),
          itemBuilder: (c, i) {
            final v = conversations[i];
            final unread = (v['unread'] as num?)?.toInt() ?? 0;
            return InkWell(
              onTap: () async { await showDialog<void>(context: context, builder: (c) => _ChatDialog(app: widget.app, workOrderId: '${v['work_order_id']}', title: '${v['plate'] ?? ''} — ${v['customer_name'] ?? ''}')); _load(); },
              child: Padding(padding: const EdgeInsets.all(14), child: Row(children: [
                Container(width: 44, height: 44, color: Z8.petrolSoft, alignment: Alignment.center, child: const Icon(Icons.chat_rounded, color: Z8.petrol)),
                const SizedBox(width: 12),
                Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('${v['plate'] ?? ''}  ·  ${v['customer_name'] ?? 'عميل'}', style: tx(Fs.md, w: 800)),
                  Text('${v['last_message'] ?? ''}', maxLines: 1, overflow: TextOverflow.ellipsis, style: tx(Fs.sm, color: Z8.textDim)),
                ])),
                if (unread > 0) Container(padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3), color: Z8.emerald, child: Text('$unread', style: tx(Fs.sm, w: 800, color: Colors.white))),
              ])),
            );
          },
        ));

  Widget _notes() => notes.isEmpty
      ? Center(child: Text('لا توجد ملاحظات', style: tx(Fs.md, color: Z8.textDim)))
      : Z8Card(padding: EdgeInsets.zero, child: ListView.separated(
          itemCount: notes.length, separatorBuilder: (_, _) => const Divider(height: 1, color: Z8.line),
          itemBuilder: (c, i) {
            final n = notes[i];
            return InkWell(
              onTap: () async { await showDialog<void>(context: context, builder: (c) => _NoteDialog(app: widget.app, note: n)); _load(); },
              child: Padding(padding: const EdgeInsets.all(14), child: Row(children: [
                SizedBox(width: 90, child: Text('${n['note_number'] ?? ''}', style: tx(Fs.sm, w: 800, tnum: true))),
                Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(noteTypes['${n['type']}'] ?? '${n['type']}', style: tx(Fs.md, w: 800)),
                  Text('${n['plate'] ?? ''}  ·  ${n['customer_name'] ?? ''}  ·  ${n['product_name'] ?? ''}', maxLines: 1, overflow: TextOverflow.ellipsis, style: tx(Fs.sm, color: Z8.textDim)),
                ])),
                Z8Badge(noteStatuses['${n['status']}'] ?? '${n['status']}'),
              ])),
            );
          },
        ));
}

class _TabBtn extends StatelessWidget {
  const _TabBtn(this.text, this.active, this.onTap);
  final String text;
  final bool active;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => Material(
        color: active ? Z8.petrol : Z8.ink2,
        shape: RoundedRectangleBorder(side: BorderSide(color: active ? Z8.petrol : Z8.line), borderRadius: BorderRadius.zero),
        child: InkWell(onTap: onTap, child: Padding(padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 12), child: Text(text, style: tx(Fs.md, w: 800, color: active ? Colors.white : Z8.text)))),
      );
}

class _ChatDialog extends StatefulWidget {
  const _ChatDialog({required this.app, required this.workOrderId, required this.title});
  final AppState app;
  final String workOrderId, title;
  @override
  State<_ChatDialog> createState() => _ChatDialogState();
}

class _ChatDialogState extends State<_ChatDialog> {
  List<Map> msgs = [];
  final text = TextEditingController();
  String? err;

  @override
  void initState() { super.initState(); _load(); }
  Future<void> _load() async {
    try { msgs = [for (final m in (await widget.app.api.get('/service-notes/messages/${widget.workOrderId}') as List)) m as Map]; } on ApiException catch (e) { err = e.message; }
    if (mounted) setState(() {});
  }
  Future<void> _send() async {
    final t = text.text.trim();
    if (t.isEmpty) return;
    try { await widget.app.api.post('/service-notes/messages/${widget.workOrderId}', body: {'message': t, 'messageType': 'text'}); text.clear(); await _load(); } on ApiException catch (e) { setState(() => err = e.message); }
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
        title: Text(widget.title, style: tx(Fs.lg, w: 800)),
        content: SizedBox(width: 520, height: 420, child: Column(children: [
          Expanded(child: ListView(children: [
            for (final m in msgs) Align(
              alignment: m['sender_type'] == 'employee' ? AlignmentDirectional.centerStart : AlignmentDirectional.centerEnd,
              child: Container(
                margin: const EdgeInsets.symmetric(vertical: 4), padding: const EdgeInsets.all(10), constraints: const BoxConstraints(maxWidth: 360),
                color: m['sender_type'] == 'employee' ? Z8.petrolSoft : Z8.ink3,
                child: Text('${m['message'] ?? ''}', style: tx(Fs.md)),
              ),
            ),
          ])),
          if (err != null) Text(err!, style: tx(Fs.sm, w: 700, color: Z8.ember)),
          Row(children: [
            Expanded(child: TextField(controller: text, onSubmitted: (_) => _send(), style: tx(Fs.md), decoration: InputDecoration(hintText: 'اكتب رسالة للعميل', hintStyle: tx(Fs.md, color: Z8.textDim), filled: true, fillColor: Z8.ink2))),
            const SizedBox(width: 8),
            Z8Button('إرسال', icon: Icons.send_rounded, onTap: _send),
          ]),
        ])),
        actions: [Z8Button('إغلاق', variant: BtnVariant.ghost, onTap: () => Navigator.pop(context))],
      );
}

class _NoteDialog extends StatefulWidget {
  const _NoteDialog({required this.app, required this.note});
  final AppState app;
  final Map note;
  @override
  State<_NoteDialog> createState() => _NoteDialogState();
}

class _NoteDialogState extends State<_NoteDialog> {
  String? err;
  bool busy = false;
  Future<void> _set(String s) async {
    setState(() { busy = true; err = null; });
    try { await widget.app.api.put('/service-notes/${widget.note['id']}/status', body: {'status': s}); if (mounted) Navigator.pop(context); } on ApiException catch (e) { if (mounted) setState(() { busy = false; err = e.message; }); }
  }
  @override
  Widget build(BuildContext context) {
    final n = widget.note;
    final canManage = widget.app.user?.has('service_notes.manage') ?? false;
    return AlertDialog(
      title: Text('${n['note_number'] ?? ''}  ·  ${noteTypes['${n['type']}'] ?? ''}', style: tx(Fs.lg, w: 800)),
      content: SizedBox(width: 480, child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('السيارة: ${n['plate'] ?? ''} ${n['brand'] ?? ''} ${n['car_name'] ?? ''}', style: tx(Fs.md)),
        Text('العميل: ${n['customer_name'] ?? ''}  ${n['customer_phone'] ?? ''}', style: tx(Fs.md)),
        if (n['product_name'] != null) Text('المنتج: ${n['product_name']}', style: tx(Fs.md)),
        const SizedBox(height: 8),
        if ('${n['description'] ?? ''}'.isNotEmpty) Container(width: double.infinity, padding: const EdgeInsets.all(10), color: Z8.ink3, child: Text('${n['description']}', style: tx(Fs.md, h: 1.5))),
        const SizedBox(height: 10),
        Row(children: [Text('الحالة: ', style: tx(Fs.md, w: 700)), Z8Badge(noteStatuses['${n['status']}'] ?? '${n['status']}')]),
        if (canManage) ...[
          const SizedBox(height: 12),
          Wrap(spacing: 8, runSpacing: 8, children: [for (final e in noteStatuses.entries) if (e.key != n['status']) Z8Button(e.value, variant: BtnVariant.ghost, height: 38, size: Fs.sm, onTap: busy ? null : () => _set(e.key))]),
        ],
        if (err != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(err!, style: tx(Fs.sm, w: 700, color: Z8.ember))),
      ])),
      actions: [Z8Button('إغلاق', variant: BtnVariant.ghost, onTap: () => Navigator.pop(context))],
    );
  }
}

class _NewNoteDialog extends StatefulWidget {
  const _NewNoteDialog({required this.app});
  final AppState app;
  @override
  State<_NewNoteDialog> createState() => _NewNoteDialogState();
}

class _NewNoteDialogState extends State<_NewNoteDialog> {
  List<Map> cars = [];
  String? carId, err;
  String type = 'car_note', priority = 'normal';
  final desc = TextEditingController(), find = TextEditingController();
  bool busy = false;

  @override
  void initState() { super.initState(); _loadCars(); }
  Future<void> _loadCars() async {
    try { cars = [for (final c in (await widget.app.api.get('/cars', query: {'activeOnly': true}) as List)) c as Map]; } on ApiException catch (e) { err = e.message; }
    if (mounted) setState(() {});
  }
  Future<void> _save() async {
    if (carId == null) { setState(() => err = 'اختر السيارة'); return; }
    setState(() { busy = true; err = null; });
    try { await widget.app.api.post('/service-notes', body: {'workOrderId': carId, 'type': type, 'description': desc.text.trim(), 'priority': priority}); if (mounted) Navigator.pop(context, true); } on ApiException catch (e) { if (mounted) setState(() { busy = false; err = e.message; }); }
  }

  @override
  Widget build(BuildContext context) {
    final q = find.text.trim().toLowerCase();
    final shown = cars.where((c) => q.isEmpty || '${c['plate']}${c['customer_name']}${c['brand']}${c['name']}'.toLowerCase().contains(q)).take(30).toList();
    return AlertDialog(
      title: Text('ملاحظة جديدة', style: tx(Fs.lg, w: 800)),
      content: SizedBox(width: 520, child: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Z8Field(label: 'السيارة (ابحث باللوحة أو العميل)', controller: find, onChanged: (_) => setState(() {})),
        const SizedBox(height: 6),
        SizedBox(height: 150, child: ListView(children: [for (final c in shown) ListTile(dense: true, selected: carId == c['id'], selectedTileColor: Z8.petrolSoft, title: Text('${c['plate'] ?? ''}  ${c['brand'] ?? ''} ${c['name'] ?? ''}', style: tx(Fs.md, w: 700)), subtitle: Text('${c['customer_name'] ?? ''}', style: tx(Fs.sm, color: Z8.textDim)), onTap: () => setState(() => carId = '${c['id']}'))])),
        const SizedBox(height: 10),
        Row(children: [
          Expanded(child: DropdownButtonFormField<String>(initialValue: type, decoration: const InputDecoration(labelText: 'النوع'), items: [for (final e in noteTypes.entries) DropdownMenuItem(value: e.key, child: Text(e.value, style: tx(Fs.md)))], onChanged: (v) => type = v ?? type)),
          const SizedBox(width: 10),
          Expanded(child: DropdownButtonFormField<String>(initialValue: priority, decoration: const InputDecoration(labelText: 'الأولوية'), items: [for (final e in priorities.entries) DropdownMenuItem(value: e.key, child: Text(e.value, style: tx(Fs.md)))], onChanged: (v) => priority = v ?? priority)),
        ]),
        const SizedBox(height: 10),
        Z8Field(label: 'التفاصيل', controller: desc, maxLines: 3),
        if (err != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(err!, style: tx(Fs.sm, w: 700, color: Z8.ember))),
      ]))),
      actions: [Z8Button('إلغاء', variant: BtnVariant.ghost, onTap: () => Navigator.pop(context)), Z8Button('حفظ', busy: busy, onTap: _save)],
    );
  }
}
