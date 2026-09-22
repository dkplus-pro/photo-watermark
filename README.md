# Monorepo Template

A pnpm + Turborepo monorepo template with an OpenAPI-driven stack: a Go API server, a Modern.js React admin app built on Arco Design, shared configuration packages, CI scripts, tests, and GitHub Pages deployment.

## GitHub Pages

- admin URL template: [https://OWNER.github.io/REPOSITORY/](https://OWNER.github.io/REPOSITORY/)
- After creating your GitHub repository, replace `OWNER` and `REPOSITORY` with your real GitHub org/user and repo name.
- Enable **Settings → Pages → Build and deployment → Source: GitHub Actions**. The workflow in `.github/workflows/pages.yml` builds `apps/admin` and deploys `apps/admin/dist`.

## What's included

```text
apps/
  admin/                  Modern.js React + Arco Design admin app
  server/                 Go API server (oapi-codegen + GORM)
  site/                   Modern.js SSR public website
  h5/                     Modern.js SSR campaign H5 (audience: h5)
  desktop/                electron-vite + React desktop app (audience: app)
  miniapp/                Taro 4 + React WeChat mini program (audience: app)
  mobile/                 Flutter app placeholder (audience: app; not in pnpm workspace)
openapi/                  API contracts, one per audience (admin.yaml, site.yaml single files; app/, h5/ multi-file skeletons)
docs/                     Development docs (dev guide, MVP plan, database design)
packages/
  tsconfig/              Shared TypeScript presets
  eslint-config/         Shared ESLint flat config
  prettier-config/       Shared Prettier config
  commitlint-config/     Shared Commitlint config
scripts/
  ci.sh                  Full CI pipeline helper
  verify.sh              Fast local verification helper
  deploy-github-pages.sh Build and validate Pages artifact
.github/workflows/
  ci.yml                 Lint, typecheck, test, build
  pages.yml              GitHub Pages deployment
tests/
  jest/                  Repository and script unit tests
  playwright/            admin app browser smoke test
```

## Requirements

- Node.js `>=20.19.5` (Node 22 LTS recommended; `.nvmrc` uses `lts/jod`)
- pnpm via Corepack (`packageManager` pins pnpm)
- Go `>=1.24` (for `apps/server`; uses the `go tool` directive for oapi-codegen)
- Flutter SDK (stable) only for `apps/mobile` (optional locally; CI runs its checks via flutter-action)

```bash
corepack enable
node --version
pnpm --version
```

## Install

```bash
pnpm install
```

## Start in development

```bash
pnpm dev
```

One command starts the workspaces via Turborepo (persistent dev tasks run in parallel):

- admin at <http://localhost:8081/> (dev-proxies `/api` to the server)
- Go server at <http://localhost:8080/> (Swagger UI at <http://localhost:8080/swagger/>)
- site at <http://localhost:8082/>
- h5 at <http://localhost:18082/>
- desktop (Electron window; renderer dev server at <http://localhost:18083/>)
- miniapp (Taro weapp watch build into `apps/miniapp/dist`, preview via WeChat DevTools)
- mobile is a Flutter app outside the pnpm workspace — run it from `apps/mobile` with the Flutter SDK (see its README)

Default admin account: `admin` / `admin123` (change it via the avatar menu after first login).

To run only one workspace:

```bash
pnpm --filter @monorepo-template/admin run dev
pnpm --filter @monorepo-template/server run dev
```

## API contract workflow

`openapi/` is the single source of truth for API contracts — one per audience (`admin.yaml`, `site.yaml` as single files; `app/`, `h5/` as multi-file skeleton directories; see `docs/multi-audience-contracts.md`). After changing a contract, regenerate all sides:

```bash
pnpm gen:api   # server: apps/server/gen (oapi-codegen; app/h5 bundled via redocly first); JS apps via orval (admin, site, h5, desktop, miniapp)
```

Generated files must never be hand-edited. See `docs/development.md` for the full convention.

## Development commands

```bash
pnpm lint          # Turbo workspace lint + root ESLint
pnpm typecheck     # TypeScript checks across workspaces
pnpm test          # Jest + workspace tests + Playwright smoke test
pnpm build         # Build all buildable workspaces
pnpm format        # Check Prettier formatting
pnpm format:write  # Fix Prettier formatting
pnpm gen:api       # Regenerate API types/code from openapi/ contracts
pnpm verify        # Fast local verification helper
pnpm ci            # CI helper: install + lint + typecheck + test + build
```

## Git hooks and commits

Husky is installed through the root `prepare` script.

- `pre-commit`: runs `lint-staged`
- `commit-msg`: runs Commitlint using the shared conventional commit config

Use conventional commit messages such as:

```bash
git commit -m "feat: add shared ui package"
```

## Tests

- Jest unit tests live in `tests/jest`.
- Playwright E2E tests live in `tests/playwright` and start the Modern.js admin automatically.
- The app also has a lightweight Node test under `apps/admin/tests`.

For a first Playwright run locally, install the Chromium browser:

```bash
pnpm exec playwright install chromium
pnpm run test:e2e
```

## GitHub Pages deployment

Local artifact build:

```bash
GITHUB_PAGES_BASE_PATH=/REPOSITORY pnpm run build:pages
```

This builds `apps/admin/dist` and verifies that `index.html` is at the artifact root. In GitHub Actions, `pages.yml` sets `GITHUB_PAGES_BASE_PATH` from the repository name and uploads `apps/admin/dist` with the official Pages artifact action.

## Adding more workspaces

- Add applications under `apps/*`.
- Add shared packages under `packages/*`.
- Add package-level scripts named `build`, `lint`, `typecheck`, and `test` so Turborepo can schedule them.
