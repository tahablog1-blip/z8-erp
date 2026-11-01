import 'dart:async';
import 'package:flutter/material.dart';
import '../core/api.dart';
import '../core/theme.dart';
import '../core/widgets.dart';
import '../models.dart';
import '../state/app_state.dart';

/// محادثة العميل مع فريق الفرع (نصية) + ملاحظات الخدمة المرئية له
class ChatScreen extends StatefulWidget {
  const ChatScreen({super.key, required this.state, required this.bookingId});
  final AppState state;
  final String bookingId;
  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  final input = TextEditingController(), scroll = ScrollController();
  String? token, err;
  List<ChatMessage> msgs = const [];
  List<ServiceNote> notes = const [];
  Timer? _t;
  bool sending = false;

  @override
  void initState() {
    super.initState();
    _open();
  }

  @override
  void dispose() { _t?.cancel(); super.dispose(); }

  Future<void> _open() async {
    try {
      token = await widget.state.api.chatToken(widget.bookingId);
      await _load();
      _t = Timer.periodic(const Duration(seconds: 8), (_) => _load());
    } on ApiException catch (e) {
      if (mounted) setState(() => err = e.message);
    }
  }

  Future<void> _load() async {
    if (token == null) return;
    try {
      final d = await widget.state.api.chatMessages(token!);
      final m = d['messages'], n = d['notes'];
      final list = m is List ? m.whereType<Map>().map((e) => ChatMessage.fromJson(Map<String, dynamic>.from(e))).toList() : <ChatMessage>[];
      final nl = n is List ? n.whereType<Map>().map((e) => ServiceNote.fromJson(Map<String, dynamic>.from(e))).toList() : <ServiceNote>[];
      if (!mounted) return;
      final grew = list.length != msgs.length;
      setState(() { msgs = list; notes = nl; err = null; });
      if (grew) WidgetsBinding.instance.addPostFrameCallback((_) { if (scroll.hasClients) scroll.jumpTo(scroll.position.maxScrollExtent); });
    } on ApiException catch (e) {
      if (mounted) setState(() => err = e.message);
    }
  }

  Future<void> _send() async {
    final t = input.text.trim();
    if (t.isEmpty || token == null || sending) return;
    setState(() { sending = true; err = null; });
    try {
      await widget.state.api.chatSend(token!, t);
      input.clear();
      await _load();
    } on ApiException catch (e) {
      if (mounted) setState(() => err = e.message);
    }
    if (mounted) setState(() => sending = false);
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: Text('محادثة الفرع', style: tx(Fs.lg, w: 900)), backgroundColor: Z8.ink2, surfaceTintColor: Colors.transparent),
        body: SafeArea(
          child: Column(children: [
            if (err != null) ErrorBar(err!),
            Expanded(
              child: token == null && err == null
                  ? const Center(child: CircularProgressIndicator())
                  : ListView(controller: scroll, padding: const EdgeInsets.all(12), children: [
                      for (final n in notes)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 8),
                          child: Panel(color: Z8.brassSoft, pad: 10, child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Text('ملاحظة #${n.number}${n.title.isEmpty ? '' : ' — ${n.title}'}', style: tx(Fs.sm, w: 900)),
                            if (n.description.isNotEmpty) Text(n.description, style: tx(Fs.sm)),
                          ])),
                        ),
                      for (final m in msgs) _Bubble(m),
                      if (msgs.isEmpty && notes.isEmpty && err == null)
                        Padding(padding: const EdgeInsets.all(24), child: Text('اكتب رسالتك وسيرد عليك فريق الفرع', textAlign: TextAlign.center, style: tx(Fs.sm, color: Z8.textDim))),
                    ]),
            ),
            Container(
              padding: const EdgeInsets.all(8),
              decoration: const BoxDecoration(color: Z8.ink2, border: Border(top: BorderSide(color: Z8.line))),
              child: Row(children: [
                Expanded(child: TextField(controller: input, minLines: 1, maxLines: 4, maxLength: 2000, style: tx(Fs.md, w: 600), decoration: InputDecoration(hintText: 'اكتب رسالة…', counterText: '', hintStyle: tx(Fs.md, color: Z8.textDim)))),
                const SizedBox(width: 8),
                IconButton.filled(onPressed: sending ? null : _send, style: IconButton.styleFrom(backgroundColor: Z8.petrol, shape: const RoundedRectangleBorder()), icon: const Icon(Icons.send, color: Colors.white)),
              ]),
            ),
          ]),
        ),
      );
}

class _Bubble extends StatelessWidget {
  const _Bubble(this.m);
  final ChatMessage m;
  @override
  Widget build(BuildContext context) => Align(
        alignment: m.fromCustomer ? AlignmentDirectional.centerStart : AlignmentDirectional.centerEnd,
        child: Container(
          margin: const EdgeInsets.only(bottom: 8),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * .78),
          color: m.fromCustomer ? Z8.petrolSoft : Z8.ink2,
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(m.fromCustomer ? 'أنت' : 'الفرع', style: tx(Fs.xs, w: 800, color: Z8.textDim)),
            Text(m.text, style: tx(Fs.md, w: 600)),
          ]),
        ),
      );
}
