#!/usr/bin/env bash
# Run the full CI validation pipeline used by local development and GitHub Actions.

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/ci-common.sh
source "$SCRIPT_DIR/lib/ci-common.sh"

ROOT="$(repo_root)"
cd "$ROOT"

PM="$(detect_package_manager)"
ci_notice "Detected package manager: $PM"

ci_group "Install dependencies"
install_dependencies "$PM"
ci_endgroup

for script in lint typecheck test build; do
  ci_group "Run $script"
  run_package_script_if_present "$PM" "$script"
  ci_endgroup
done
