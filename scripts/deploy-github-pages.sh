#!/usr/bin/env bash
# Build and validate the admin app artifact that GitHub Pages uploads.

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/ci-common.sh
source "$SCRIPT_DIR/lib/ci-common.sh"

ROOT="$(repo_root)"
cd "$ROOT"

PM="$(detect_package_manager)"
APP_FILTER="${GITHUB_PAGES_APP_FILTER:-@monorepo-template/admin}"
APP_DIR="${GITHUB_PAGES_APP_DIR:-apps/admin}"
ARTIFACT_DIR="${GITHUB_PAGES_ARTIFACT_DIR:-$APP_DIR/dist}"

if [[ -z "${GITHUB_PAGES_BASE_PATH:-}" && -n "${GITHUB_REPOSITORY:-}" ]]; then
  export GITHUB_PAGES_BASE_PATH="/${GITHUB_REPOSITORY##*/}"
fi

ci_notice "GitHub Pages base path: ${GITHUB_PAGES_BASE_PATH:-/}"

ci_group "Build $APP_FILTER for GitHub Pages"
case "$PM" in
  pnpm) pnpm --config.verify-deps-before-run=false --filter "$APP_FILTER" run build:github-pages ;;
  yarn) yarn workspace "$APP_FILTER" build:github-pages ;;
  npm) npm run --workspace "$APP_DIR" build:github-pages ;;
  *)
    ci_error "Unsupported or missing package manager for GitHub Pages build: $PM"
    exit 1
    ;;
esac
ci_endgroup

if [[ ! -d "$ARTIFACT_DIR" ]]; then
  ci_error "GitHub Pages artifact directory '$ARTIFACT_DIR' does not exist after build."
  exit 1
fi

if [[ ! -f "$ARTIFACT_DIR/index.html" ]]; then
  ci_error "GitHub Pages artifact '$ARTIFACT_DIR' must contain index.html at its root."
  exit 1
fi

ci_notice "GitHub Pages artifact ready: $ARTIFACT_DIR"
