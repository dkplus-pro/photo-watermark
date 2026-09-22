#!/usr/bin/env bash
# Shared helpers for repository CI/CD scripts.

set -Eeuo pipefail

repo_root() {
  git rev-parse --show-toplevel 2>/dev/null || pwd
}

ci_group() {
  local title="$1"
  if [[ "${GITHUB_ACTIONS:-}" == "true" ]]; then
    printf '::group::%s\n' "$title"
  else
    printf '\n==> %s\n' "$title"
  fi
}

ci_endgroup() {
  if [[ "${GITHUB_ACTIONS:-}" == "true" ]]; then
    printf '::endgroup::\n'
  fi
}

ci_notice() {
  local message="$1"
  if [[ "${GITHUB_ACTIONS:-}" == "true" ]]; then
    printf '::notice::%s\n' "$message"
  else
    printf 'NOTICE: %s\n' "$message"
  fi
}

ci_error() {
  local message="$1"
  if [[ "${GITHUB_ACTIONS:-}" == "true" ]]; then
    printf '::error::%s\n' "$message" >&2
  else
    printf 'ERROR: %s\n' "$message" >&2
  fi
}

has_command() {
  command -v "$1" >/dev/null 2>&1
}

detect_package_manager() {
  if [[ -f pnpm-lock.yaml ]]; then
    printf 'pnpm\n'
  elif [[ -f yarn.lock ]]; then
    printf 'yarn\n'
  elif [[ -f package-lock.json || -f npm-shrinkwrap.json ]]; then
    printf 'npm\n'
  elif [[ -f package.json ]]; then
    printf 'npm\n'
  else
    printf 'none\n'
  fi
}

package_script_exists() {
  local script_name="$1"
  [[ -f package.json ]] || return 1
  node -e '
    const fs = require("fs");
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
    process.exit(pkg.scripts && Object.prototype.hasOwnProperty.call(pkg.scripts, process.argv[1]) ? 0 : 1);
  ' "$script_name"
}

install_dependencies() {
  local pm="$1"
  case "$pm" in
    pnpm)
      has_command corepack && corepack enable >/dev/null 2>&1 || true
      pnpm install --frozen-lockfile
      ;;
    yarn)
      has_command corepack && corepack enable >/dev/null 2>&1 || true
      yarn install --immutable
      ;;
    npm)
      if [[ -f package-lock.json || -f npm-shrinkwrap.json ]]; then
        npm ci
      else
        npm install
      fi
      ;;
    none)
      ci_notice "No package manifest or lockfile found; skipping dependency install."
      ;;
    *)
      ci_error "Unsupported package manager: $pm"
      return 1
      ;;
  esac
}

run_package_script_if_present() {
  local pm="$1"
  local script_name="$2"

  if [[ "$pm" == "none" ]]; then
    ci_notice "Skipping '$script_name' because no package manager was detected."
    return 0
  fi

  if ! package_script_exists "$script_name"; then
    ci_notice "Skipping '$script_name' because package.json does not define it."
    return 0
  fi

  case "$pm" in
    pnpm) pnpm --config.verify-deps-before-run=false run "$script_name" ;;
    yarn) yarn run "$script_name" ;;
    npm) npm run "$script_name" ;;
    *)
      ci_error "Unsupported package manager: $pm"
      return 1
      ;;
  esac
}
