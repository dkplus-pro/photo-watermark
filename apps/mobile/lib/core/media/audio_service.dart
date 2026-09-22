import 'package:just_audio/just_audio.dart';

/// 音频播放薄壳:包装 just_audio AudioPlayer(setUrl/play/pause/seek/dispose + playing 状态流);
/// 业务面向本类,不直接 import just_audio。
class AppAudioPlayer {
  AppAudioPlayer() : _player = AudioPlayer();

  final AudioPlayer _player;

  Future<void> setUrl(String url) => _player.setUrl(url);

  Future<void> play() => _player.play();

  Future<void> pause() => _player.pause();

  Future<void> seek(Duration position) => _player.seek(position);

  Stream<bool> get playingStream => _player.playingStream;

  bool get isPlaying => _player.playing;

  Future<void> dispose() => _player.dispose();
}
