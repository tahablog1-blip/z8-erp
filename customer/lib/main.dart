import 'package:flutter/material.dart';
import 'app.dart';
import 'core/api.dart';
import 'core/store.dart';
import 'state/app_state.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  final state = AppState(api: Api(), store: const SecureStore())..init();
  runApp(CustomerApp(state: state));
}
