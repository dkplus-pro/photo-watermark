/// 本地键值存储抽象:SharedPreferences 实现(M2.B),业务不直接依赖实现包。
/// 仅存轻量键值;结构化/大量数据待业务出现后再评审新增抽象,不提前设计。
abstract interface class KeyValueStore {
  Future<String?> getString(String key);

  Future<void> setString(String key, String value);

  Future<void> remove(String key);

  Future<bool> containsKey(String key);
}
