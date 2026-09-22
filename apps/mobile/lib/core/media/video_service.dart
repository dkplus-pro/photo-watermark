import 'package:video_player/video_player.dart';

/// 视频播放薄壳:包装 VideoPlayerController 生命周期(initialize/play/pause/seekTo/dispose);
/// 不抽纯逻辑(播放器无决策逻辑),业务面向本类,不直接 import video_player。
class AppVideoPlayer {
  AppVideoPlayer.network(String url)
      : _controller = VideoPlayerController.networkUrl(Uri.parse(url));

  final VideoPlayerController _controller;

  Future<void> initialize() => _controller.initialize();

  Future<void> play() => _controller.play();

  Future<void> pause() => _controller.pause();

  Future<void> seekTo(Duration position) => _controller.seekTo(position);

  Duration get position => _controller.value.position;

  bool get isPlaying => _controller.value.isPlaying;

  bool get isInitialized => _controller.value.isInitialized;

  Future<void> dispose() => _controller.dispose();
}
