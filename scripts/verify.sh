#!/usr/bin/env bash
# Fast local verification that mirrors CI checks without forcing dependency install.

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/ci-common.sh
source "$SCRIPT_DIR/lib/ci-common.sh"

ROOT="$(repo_root)"
cd "$ROOT"

PM="$(detect_package_manager)"
ci_notice "Detected package manager: $PM"

for script in lint typecheck test; do
  ci_group "Run $script"
  run_package_script_if_present "$PM" "$script"
  ci_endgroup
done

ci_group "Run desktop e2e (apps/desktop)"
if [ "$PM" = pnpm ]; then
  (cd apps/desktop && pnpm run build && pnpm run test:e2e)
fi
ci_endgroup

ci_group "Run miniapp size gate (apps/miniapp)"
(cd apps/miniapp && node scripts/check-size.mjs)
ci_endgroup

ci_group "Run flutter checks (apps/mobile)"
if has_command flutter; then
  (cd apps/mobile && flutter pub get && flutter analyze && flutter test --coverage)
else
  ci_notice "flutter SDK 未安装,跳过 apps/mobile 校验(CI 由 flutter.yml 覆盖)"
fi
ci_endgroup
