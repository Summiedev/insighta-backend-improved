# Contributing Guide (Stage 3)

## Branching Strategy

- `main`: production-ready code only
- `develop`: integration branch for upcoming release
- Feature branches: `feature/<repo>-<short-description>`
- Fix branches: `fix/<repo>-<short-description>`
- Hotfix branches: `hotfix/<repo>-<short-description>`

Examples:
- `feature/backend-rate-limiter`
- `feature/cli-login-improvements`
- `fix/portal-csrf-logout`

## Pull Request Conventions

- Open PRs into `develop` for normal work
- Open PRs into `main` only for release/hotfix
- Keep PRs focused to one repo concern (backend, cli, or portal)
- Require passing CI (lint, test, build) before merge
- At least one reviewer approval required
- Use PR template and include verification notes

## Commit Standards

Use Conventional Commits:
- `feat:` new feature
- `fix:` bug fix
- `refactor:` non-behavioral code changes
- `docs:` documentation only
- `chore:` maintenance/config updates
- `test:` tests only

Examples:
- `feat(backend): add redis-first rate limiter middleware`
- `fix(cli): refresh token retry on 401`
- `docs(portal): add auth flow diagram`

## CI/CD Workflow

### Backend (Vercel)

- Workflow: `.github/workflows/backend-ci-cd.yml`
- Runs on PR/push: lint -> test -> build
- Deploys to Vercel on push to `main`
- Required secrets:
  - `VERCEL_TOKEN`
  - `VERCEL_ORG_ID`
  - `VERCEL_PROJECT_ID`

### CLI (npm package)

- Workflow template for CLI repo: `.github/workflows/cli-ci-cd.yml`
- Runs on PR/push: lint -> test -> build
- Publishes to npm when tag starts with `v` (e.g. `v1.2.0`)
- Required secret:
  - `NPM_TOKEN`

### Web Portal (Vercel)

- Workflow template for portal repo: `.github/workflows/portal-ci-cd.yml`
- Runs on PR/push: lint -> test -> build
- Deploys to Vercel on push to `main`
- Required secrets:
  - `VERCEL_TOKEN`
  - `VERCEL_ORG_ID`
  - `VERCEL_PROJECT_ID`

## Deployment Rules

- Merge to `main` only when all checks are green
- Tag CLI releases with semantic version tags: `vMAJOR.MINOR.PATCH`
- Backend and portal production deploy from `main`
- Rollback via previous Vercel deployment or git revert

## Grading Readiness

Each repository README should include:
- System architecture summary
- Setup and environment variables
- API/command/page usage examples
- Auth and security model
- Testing/verification steps
- CI/CD pipeline description and required secrets
- Deployment URLs and release workflow