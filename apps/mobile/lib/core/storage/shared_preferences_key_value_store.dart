import 'package:shared_preferences/shared_preferences.dart';

import 'key_value_store.dart';

/// KeyValueStore 的 SharedPreferences 实现:业务不直接依赖 shared_preferences 包,
/// 一切读写经本抽象(M2.C/M3 装配注入),替换实现(如 mmkv)零业务改动。
class SharedPreferencesKeyValueStore implements KeyValueStore {
  SharedPreferencesKeyValueStore({SharedPreferences? prefs}) : _prefs = prefs;

  /// 首次调用前需由装配方完成初始化(SharedPreferences.getInstance 是异步);
  /// 延迟加载避免构造期 async。
  Future<SharedPreferences> _instance() async {
    return _prefs ??= await SharedPreferences.getInstance();
  }

  SharedPreferences? _prefs;

  @override
  Future<bool> containsKey(String key) async {
    return (await _instance()).containsKey(key);
  }

  @override
  Future<String?> getString(String key) async {
    return (await _instance()).getString(key);
  }

  @override
  Future<void> remove(String key) async {
    await (await _instance()).remove(key);
  }

  @override
  Future<void> setString(String key, String value) async {
    await (await _instance()).setString(key, value);
  }
}
