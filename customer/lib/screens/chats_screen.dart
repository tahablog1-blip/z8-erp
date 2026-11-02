import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../core/i18n.dart';
import '../core/theme.dart';
import '../core/widgets.dart';
import '../state/app_state.dart';
import 'chat_screen.dart';

/// المحادثات: الرسائل بين العميل والفرع (محادثة لكل زيارة)
class ChatsScreen extends StatefulWidget {
  const ChatsScreen({super.key, required this.state});
  final AppState state;
  @override
  State<ChatsScreen> createState() => _ChatsScreenState();
}

class _ChatsScreenState extends State<ChatsScreen> {
  @override
  void initState() {
    super.initState();
    widget.state.refreshInbox();
  }

  @override
  Widget build(BuildContext context) {
    final s = widget.state;
    return ListenableBuilder(
      listenable: s,
      builder: (context, _) => Scaffold(
        appBar: AppBar(title: Text(tr('المحادثات'), style: tx(Fs.lg, w: 900)), backgroundColor: Z8.ink2, surfaceTintColor: Colors.transparent),
        body: SafeArea(
          child: RefreshIndicator(
            onRefresh: s.refreshInbox,
            child: ListView(padding: const EdgeInsets.all(16), children: [
              if (s.chats.isEmpty)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 32),
                  child: Text(tr('لا توجد محادثات بعد — ستظهر هنا رسائل الفرع عند التواصل معك'), textAlign: TextAlign.center, style: tx(Fs.md, w: 700, color: Z8.textDim)),
                ),
              for (final c in s.chats)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: InkWell(
                    onTap: () async {
                      await Navigator.of(context).push(MaterialPageRoute(builder: (_) => ChatScreen(state: s, bookingId: c.bookingId)));
                      s.refreshInbox();
                    },
                    child: Panel(child: Row(children: [
                      const Icon(Icons.forum_outlined, color: Z8.petrol),
                      const SizedBox(width: 12),
                      Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text([if (c.carLabel.isNotEmpty) c.carLabel, c.plate].where((e) => e.isNotEmpty).join(' · '), style: tx(Fs.md, w: 800)),
                        Text(c.branchName, style: tx(Fs.xs, w: 700, color: Z8.textDim)),
                        const SizedBox(height: 2),
                        Text('${c.lastFromCustomer ? '${tr('أنت')}: ' : ''}${c.lastMessage}', maxLines: 2, overflow: TextOverflow.ellipsis, style: tx(Fs.sm, w: c.unread > 0 ? 800 : 500)),
                      ])),
                      const SizedBox(width: 8),
                      Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                        if (c.lastAt != null) Text(DateFormat('d/M HH:mm').format(c.lastAt!), style: tx(Fs.xs, color: Z8.textDim, tnum: true)),
                        if (c.unread > 0) Container(margin: const EdgeInsets.only(top: 4), padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2), color: Z8.ember, child: Text('${c.unread}', style: tx(Fs.xs, w: 900, color: Colors.white))),
                      ]),
                    ])),
                  ),
                ),
            ]),
          ),
        ),
      ),
    );
  }
}
