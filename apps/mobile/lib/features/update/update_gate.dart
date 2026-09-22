import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/update/update_checker.dart';
import '../../app_providers.dart';

/// 更新门禁(卡 7.4):包裹落地页;首帧后触发一次检查,按决策弹更新对话框。
/// 每页面实例只查一次(State 守卫);失败静默(UpdateChecker 已降级)。
class UpdateGate extends ConsumerStatefulWidget {
  const UpdateGate({super.key, required this.child});

  final Widget child;

  @override
  ConsumerState<UpdateGate> createState() => _UpdateGateState();
}

class _UpdateGateState extends ConsumerState<UpdateGate> {
  bool _checked = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _check());
  }

  Future<void> _check() async {
    if (_checked || !mounted) {
      return;
    }
    _checked = true;
    final UpdateDecision decision =
        await ref.read(updateCheckerProvider).check();
    if (!mounted || decision.action == UpdateAction.none) {
      return;
    }
    showDialog<void>(
      context: context,
      barrierDismissible: decision.action != UpdateAction.force,
      builder: (_) => UpdateDialog(decision: decision),
    );
  }

  @override
  Widget build(BuildContext context) => widget.child;
}

/// 更新对话框(中文文案锁定):
/// 标题 force「重要更新」/ optional「发现新版本 V`<latestVersion>`」;
/// force 内容固定文案 + releaseNotes(空则只固定文案),optional releaseNotes
/// 空回退「建议更新到最新版本以获得更好体验。」;
/// 按钮 optional [稍后再说, 立即更新],force 仅 [立即更新](不可关闭);
/// 「立即更新」:downloadUrl 空 → 置灰;非空 → 外部浏览器打开。
class UpdateDialog extends StatelessWidget {
  const UpdateDialog({super.key, required this.decision});

  final UpdateDecision decision;

  bool get _isForce => decision.action == UpdateAction.force;

  @override
  Widget build(BuildContext context) {
    final bool canUpdate = decision.downloadUrl.isNotEmpty;
    return PopScope(
      canPop: !_isForce,
      child: AlertDialog(
        title: Text(
          _isForce ? '重要更新' : '发现新版本 V${decision.latestVersion}',
        ),
        content: Text(_contentText()),
        actions: <Widget>[
          if (!_isForce)
            TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('稍后再说'),
            ),
          FilledButton(
            onPressed: canUpdate
                ? () async {
                    final Uri url = Uri.parse(decision.downloadUrl);
                    await launchUrl(url, mode: LaunchMode.externalApplication);
                  }
                : null,
            child: const Text('立即更新'),
          ),
        ],
      ),
    );
  }

  String _contentText() {
    if (_isForce) {
      const String fixed = '当前版本已停止服务,请更新后继续使用。';
      return decision.releaseNotes.isEmpty
          ? fixed
          : '$fixed\n${decision.releaseNotes}';
    }
    return decision.releaseNotes.isEmpty
        ? '建议更新到最新版本以获得更好体验。'
        : decision.releaseNotes;
  }
}
