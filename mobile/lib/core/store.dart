// lib/core/store.dart — تخزين آمن لمعرّف الجهاز وتوكن التفعيل (Keystore على أندرويد)
import 'dart:math';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

abstract class KeyValueStore {
  Future<String?> read(String k);
  Future<void> write(String k, String v);
  Future<void> delete(String k);
}

class SecureStore implements KeyValueStore {
  const SecureStore();
  static const _s = FlutterSecureStorage();
  @override
  Future<String?> read(String k) => _s.read(key: k);
  @override
  Future<void> write(String k, String v) => _s.write(key: k, value: v);
  @override
  Future<void> delete(String k) => _s.delete(key: k);
}

class MemoryStore implements KeyValueStore {
  final Map<String, String> m = {};
  @override
  Future<String?> read(String k) async => m[k];
  @override
  Future<void> write(String k, String v) async => m[k] = v;
  @override
  Future<void> delete(String k) async => m.remove(k);
}

String randomDeviceKey() {
  final r = Random.secure();
  return List.generate(32, (_) => r.nextInt(16).toRadixString(16)).join();
}
